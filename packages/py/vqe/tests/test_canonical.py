"""Plan Part IV Phase 1 Tests: serialization round-trip, key-order-independent
digest, coefficient normalization, qubit permutation fixture, Qiskit/PennyLane
fixture parity, scientific spec hash unchanged across framework bindings."""

from __future__ import annotations

import json
import math
from uuid import uuid4

import pytest

from majorana_vqe.canonical import (
    CanonicalHamiltonian,
    H2Sto3gFixture,
    HamiltonianIdentityContext,
    PauliTerm,
    RepoFixtureNotFoundError,
    canonicalize_hamiltonian,
    compute_idempotency_key,
    hamiltonian_digest,
    hamiltonian_exact_content_digest,
    load_h2_sto3g_fixture,
    scientific_experiment_spec_digest,
)
from majorana_vqe.models import ScientificExperimentSpec


def _make_spec(**overrides) -> ScientificExperimentSpec:
    kwargs = dict(
        problem_version_id=uuid4(),
        representation_version_id=uuid4(),
        reference_state_version_id=uuid4(),
        ansatz_version_id=uuid4(),
        operator_pool_version_id=uuid4(),
        selection_version_id=uuid4(),
        growth_version_id=uuid4(),
        optimizer_version_id=uuid4(),
        compression_version_id=uuid4(),
        measurement_protocol_version_id=uuid4(),
        evaluation_protocol_version_id=uuid4(),
        initial_parameters=[0.0, 0.0],
        seed=42,
        stopping_protocol_version_id=uuid4(),
    )
    kwargs.update(overrides)
    return ScientificExperimentSpec(**kwargs)


class TestSerializationRoundTrip:
    def test_component_spec_json_round_trip(self):
        original = CanonicalHamiltonian(
            num_qubits=2,
            terms=[
                PauliTerm(pauli_qubit0_first="II", coeff_re=-0.5, coeff_im=0.0),
                PauliTerm(pauli_qubit0_first="ZZ", coeff_re=0.25, coeff_im=0.0),
            ],
        )
        dumped = original.model_dump_json()
        restored = CanonicalHamiltonian.model_validate_json(dumped)
        assert restored == original

    def test_scientific_experiment_spec_round_trip(self):
        original = _make_spec()
        restored = ScientificExperimentSpec.model_validate_json(original.model_dump_json())
        assert restored == original


class TestKeyOrderIndependentDigest:
    def test_hamiltonian_digest_is_independent_of_input_term_order(self):
        terms_a = [
            PauliTerm(pauli_qubit0_first="II", coeff_re=-0.5),
            PauliTerm(pauli_qubit0_first="ZZ", coeff_re=0.25),
            PauliTerm(pauli_qubit0_first="XX", coeff_re=0.1),
        ]
        terms_b = list(reversed(terms_a))

        h_a = CanonicalHamiltonian(num_qubits=2, terms=terms_a)
        h_b = CanonicalHamiltonian(num_qubits=2, terms=terms_b)

        assert hamiltonian_digest(h_a) == hamiltonian_digest(h_b)

    def test_exact_digest_includes_conventions_and_binary64_content(self):
        hamiltonian = CanonicalHamiltonian(
            num_qubits=1,
            terms=[PauliTerm(pauli_qubit0_first="Z", coeff_re=0.1)],
        )
        context = HamiltonianIdentityContext(
            mapping_convention="jordan_wigner",
            qubit_order_convention="canonical_qubit0_first_alpha_then_beta",
            identity_offset_convention="electronic_only_nuclear_repulsion_separate",
            zero_threshold_float64_hex="0000000000000000",
        )

        baseline = hamiltonian_exact_content_digest(hamiltonian, context=context)
        mapping_changed = hamiltonian_exact_content_digest(
            hamiltonian,
            context=context.model_copy(update={"mapping_convention": "parity"}),
        )
        adjacent_float = hamiltonian_exact_content_digest(
            CanonicalHamiltonian(
                num_qubits=1,
                terms=[
                    PauliTerm(
                        pauli_qubit0_first="Z",
                        coeff_re=math.nextafter(0.1, math.inf),
                    )
                ],
            ),
            context=context,
        )

        assert baseline != mapping_changed
        assert baseline != adjacent_float

    def test_scientific_spec_digest_is_independent_of_json_key_order(self):
        spec = _make_spec()
        digest_from_model = scientific_experiment_spec_digest(spec)

        # Simulate a differently-key-ordered JSON encoding of the same logical
        # object round-tripping through the model -- the digest must not care.
        as_dict = json.loads(spec.model_dump_json())
        reordered = dict(reversed(list(as_dict.items())))
        rebuilt = ScientificExperimentSpec.model_validate(reordered)

        assert scientific_experiment_spec_digest(rebuilt) == digest_from_model


class TestCoefficientNormalization:
    @pytest.mark.parametrize("invalid", [float("nan"), float("inf"), float("-inf")])
    def test_hamiltonian_rejects_non_finite_coefficients(self, invalid):
        with pytest.raises(Exception):  # noqa: B017 -- pydantic ValidationError
            PauliTerm(pauli_qubit0_first="Z", coeff_re=invalid)

    def test_canonicalization_rounds_to_configured_precision(self):
        h = CanonicalHamiltonian(
            num_qubits=1,
            terms=[PauliTerm(pauli_qubit0_first="Z", coeff_re=0.123456789012345, coeff_im=0.0)],
            coefficient_rounding_decimals=6,
        )
        canonical = canonicalize_hamiltonian(h)
        assert canonical.terms[0].coeff_re == pytest.approx(0.123457, abs=1e-9)

    def test_canonicalization_is_idempotent(self):
        h = CanonicalHamiltonian(
            num_qubits=1, terms=[PauliTerm(pauli_qubit0_first="X", coeff_re=0.1)]
        )
        once = canonicalize_hamiltonian(h)
        twice = canonicalize_hamiltonian(once)
        assert once == twice

    def test_scf_jitter_level_differences_collapse_to_the_same_digest(self):
        """Two 'runs' whose coefficients differ only in the 13th decimal place
        (SCF-convergence-level float jitter, per docs/atlas/fixtures/h2_sto3g/)
        must canonicalize to the identical digest."""
        h1 = CanonicalHamiltonian(
            num_qubits=1, terms=[PauliTerm(pauli_qubit0_first="Z", coeff_re=0.1721839326000001)]
        )
        h2 = CanonicalHamiltonian(
            num_qubits=1, terms=[PauliTerm(pauli_qubit0_first="Z", coeff_re=0.1721839325999998)]
        )
        assert hamiltonian_digest(canonicalize_hamiltonian(h1)) == hamiltonian_digest(
            canonicalize_hamiltonian(h2)
        )


class TestQubitPermutationFixture:
    def test_permuted_term_labels_canonicalize_to_the_same_sorted_order(self):
        # A deliberately out-of-order set of 2-qubit terms; canonicalization
        # must sort them into the same deterministic order regardless of the
        # order supplied.
        h = CanonicalHamiltonian(
            num_qubits=2,
            terms=[
                PauliTerm(pauli_qubit0_first="ZI", coeff_re=0.1),
                PauliTerm(pauli_qubit0_first="IZ", coeff_re=0.2),
                PauliTerm(pauli_qubit0_first="II", coeff_re=-0.3),
            ],
        )
        canonical = canonicalize_hamiltonian(h)
        assert [t.pauli_qubit0_first for t in canonical.terms] == ["II", "IZ", "ZI"]

    def test_duplicate_term_after_hypothetical_permutation_is_rejected(self):
        with pytest.raises(Exception):  # noqa: B017 -- pydantic ValidationError
            CanonicalHamiltonian(
                num_qubits=1,
                terms=[
                    PauliTerm(pauli_qubit0_first="Z", coeff_re=0.1),
                    PauliTerm(pauli_qubit0_first="Z", coeff_re=0.2),
                ],
            )

    def test_term_width_must_match_num_qubits(self):
        with pytest.raises(Exception):  # noqa: B017 -- pydantic ValidationError
            CanonicalHamiltonian(
                num_qubits=2, terms=[PauliTerm(pauli_qubit0_first="ZZZ", coeff_re=0.1)]
            )


class TestQiskitPennyLaneFixtureParity:
    """Loads the ACTUAL Phase 0B fixture (docs/atlas/fixtures/h2_sto3g/) --
    real numbers from a real cross-framework run, not synthetic data."""

    def test_h2_fixture_loads_and_round_trips(self):
        fixture = load_h2_sto3g_fixture()
        assert isinstance(fixture, H2Sto3gFixture)
        assert fixture.canonical_hamiltonian.num_qubits == 4
        assert fixture.canonical_hamiltonian.terms  # non-empty

    def test_h2_fixture_recomputed_digest_matches_stored_digest(self):
        """The digest recorded by generate_fixture.py (from the real Qiskit
        vs PennyLane cross-check) must be reproducible purely from the
        canonical terms stored alongside it -- proving this pure-Python
        package agrees with the framework-backed spike, without importing
        either framework."""
        fixture = load_h2_sto3g_fixture()
        recomputed = hamiltonian_digest(fixture.canonical_hamiltonian)
        assert recomputed == fixture.hamiltonian_digest_sha256

    def test_h2_fixture_energies_are_physically_sane(self):
        fixture = load_h2_sto3g_fixture()
        # H2/STO-3G ground state is a small negative number of Hartree
        # (electronic + nuclear repulsion); a wildly different value would
        # indicate the loader mis-parsed the manifest.
        assert -2.0 < fixture.independent_direct_fci_reference_ha < -1.0
        assert 0.0 < fixture.nuclear_repulsion_ha < 2.0

    def test_h2_fixture_review_status_is_reported_honestly(self):
        fixture = load_h2_sto3g_fixture()
        assert "PENDING" in fixture.human_or_owner_review_status

    def test_missing_manifest_raises_a_clear_error(self, tmp_path):
        with pytest.raises(RepoFixtureNotFoundError):
            load_h2_sto3g_fixture(tmp_path / "does_not_exist.json")


class TestScientificSpecHashUnchangedAcrossFrameworkBindings:
    def test_digest_does_not_depend_on_any_framework_choice(self):
        """ScientificExperimentSpec structurally never contains a framework
        field (ADR-0024) -- this test guards the invariant against a future
        regression that accidentally adds one."""
        spec = _make_spec()
        assert "framework" not in ScientificExperimentSpec.model_fields
        assert "runtime_profile_id" not in ScientificExperimentSpec.model_fields
        assert "provider_versions" not in ScientificExperimentSpec.model_fields

        digest_1 = scientific_experiment_spec_digest(spec)
        digest_2 = scientific_experiment_spec_digest(spec)
        assert digest_1 == digest_2

    def test_idempotency_key_changes_when_binding_dimensions_change_but_spec_does_not(self):
        spec = _make_spec()
        spec_digest = scientific_experiment_spec_digest(spec)

        key_qiskit = compute_idempotency_key(
            scientific_spec_sha256=spec_digest,
            runtime_profile_id="qiskit-current-v1",
            adapter_release_id="adapter-2026-07-24",
            dataset_snapshot_id=None,
            protocol_version="0.1.0",
        )
        key_pennylane = compute_idempotency_key(
            scientific_spec_sha256=spec_digest,
            runtime_profile_id="pennylane-current-v1",
            adapter_release_id="adapter-2026-07-24",
            dataset_snapshot_id=None,
            protocol_version="0.1.0",
        )
        # Same science, different binding -> different idempotency identity,
        # but the underlying scientific_spec_sha256 they both carry is equal.
        assert key_qiskit != key_pennylane

    def test_idempotency_key_is_deterministic(self):
        kwargs = dict(
            scientific_spec_sha256="a" * 64,
            runtime_profile_id="qiskit-current-v1",
            adapter_release_id="adapter-2026-07-24",
            dataset_snapshot_id=None,
            protocol_version="0.1.0",
        )
        assert compute_idempotency_key(**kwargs) == compute_idempotency_key(**kwargs)
