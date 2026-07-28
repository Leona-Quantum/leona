from __future__ import annotations

import pytest
from pydantic import ValidationError

from majorana_vqe.canonical import (
    CanonicalHamiltonian,
    HamiltonianIdentityContext,
    PauliTerm,
    hamiltonian_exact_content_digest,
)
from majorana_vqe.interchange import (
    CanonicalBasisState,
    CanonicalFermionOperator,
    CanonicalFermionTerm,
    CanonicalParameterSlot,
    CanonicalParametricCircuit,
    CanonicalQubitOperator,
    ConversionEdge,
    ConversionEvidence,
    ConversionEvidenceBundle,
    ConversionGraph,
    ConversionRole,
    ConversionVerification,
    InterchangeRepresentation,
    LadderAction,
    LadderOperator,
    SymbolicPauliRotation,
    canonical_basis_state_digest,
    canonical_fermion_operator_digest,
    canonical_parametric_circuit_digest,
)
from majorana_vqe.portable import float_to_ieee754_hex


def _fermion_operator() -> CanonicalFermionOperator:
    zero = float_to_ieee754_hex(0.0)
    return CanonicalFermionOperator(
        num_spin_orbitals=4,
        spin_orbital_order_convention="canonical_rhf_alpha_then_beta",
        operator_product_convention="left_to_right",
        normal_order_convention="creation_before_annihilation_descending_index",
        coefficient_format="ieee754_binary64_big_endian",
        zero_threshold_float64_hex=float_to_ieee754_hex(1e-12),
        terms=[
            CanonicalFermionTerm(
                operators=[],
                coefficient_re_float64_hex=float_to_ieee754_hex(1.0),
                coefficient_im_float64_hex=zero,
            ),
            CanonicalFermionTerm(
                operators=[
                    LadderOperator(spin_orbital=1, action=LadderAction.CREATE),
                    LadderOperator(spin_orbital=0, action=LadderAction.ANNIHILATE),
                ],
                coefficient_re_float64_hex=float_to_ieee754_hex(-0.25),
                coefficient_im_float64_hex=zero,
            ),
        ],
    )


def test_canonical_fermion_digest_is_stable_after_json_round_trip():
    operator = _fermion_operator()
    restored = CanonicalFermionOperator.model_validate_json(operator.model_dump_json())
    assert canonical_fermion_operator_digest(restored) == canonical_fermion_operator_digest(
        operator
    )


def test_canonical_fermion_rejects_unsorted_duplicate_and_out_of_range_terms():
    valid = _fermion_operator()
    with pytest.raises(ValidationError, match="sorted"):
        CanonicalFermionOperator(**{**valid.model_dump(), "terms": list(reversed(valid.terms))})
    with pytest.raises(ValidationError, match="duplicate"):
        CanonicalFermionOperator(**{**valid.model_dump(), "terms": [valid.terms[0]] * 2})
    bad_term = CanonicalFermionTerm(
        operators=[LadderOperator(spin_orbital=4, action=LadderAction.CREATE)],
        coefficient_re_float64_hex=float_to_ieee754_hex(1.0),
        coefficient_im_float64_hex=float_to_ieee754_hex(0.0),
    )
    with pytest.raises(ValidationError, match="out-of-range"):
        CanonicalFermionOperator(**{**valid.model_dump(), "terms": [bad_term]})


def test_nonfinite_fermionic_coefficient_is_rejected():
    with pytest.raises(ValidationError, match="finite"):
        CanonicalFermionTerm(
            operators=[],
            coefficient_re_float64_hex="7ff0000000000000",
            coefficient_im_float64_hex=float_to_ieee754_hex(0.0),
        )


def test_fermionic_threshold_is_nonnegative_and_excludes_small_terms():
    valid = _fermion_operator()
    with pytest.raises(ValidationError, match="cannot be negative"):
        CanonicalFermionOperator(
            **{
                **valid.model_dump(),
                "zero_threshold_float64_hex": float_to_ieee754_hex(-1e-12),
            }
        )
    small_term = valid.terms[0].model_copy(
        update={"coefficient_re_float64_hex": float_to_ieee754_hex(1e-13)}
    )
    with pytest.raises(ValidationError, match="must exceed"):
        CanonicalFermionOperator(
            **{**valid.model_dump(), "terms": [small_term]}
        )


def test_fermionic_term_must_match_declared_normal_order_convention():
    zero = float_to_ieee754_hex(0.0)
    common = {
        **_fermion_operator().model_dump(),
        "terms": [
            CanonicalFermionTerm(
                operators=[
                    LadderOperator(spin_orbital=0, action=LadderAction.ANNIHILATE),
                    LadderOperator(spin_orbital=1, action=LadderAction.CREATE),
                ],
                coefficient_re_float64_hex=float_to_ieee754_hex(1.0),
                coefficient_im_float64_hex=zero,
            )
        ],
    }
    with pytest.raises(ValidationError, match="creation operators must precede"):
        CanonicalFermionOperator(**common)

    common["terms"] = [
        CanonicalFermionTerm(
            operators=[
                LadderOperator(spin_orbital=0, action=LadderAction.CREATE),
                LadderOperator(spin_orbital=1, action=LadderAction.CREATE),
            ],
            coefficient_re_float64_hex=float_to_ieee754_hex(1.0),
            coefficient_im_float64_hex=zero,
        )
    ]
    with pytest.raises(ValidationError, match="descending indices"):
        CanonicalFermionOperator(**common)


def test_qubit_wrapper_reuses_exact_canonical_hamiltonian_identity():
    hamiltonian = CanonicalHamiltonian(
        num_qubits=2,
        terms=[PauliTerm(pauli_qubit0_first="ZI", coeff_re=0.5)],
    )
    context = HamiltonianIdentityContext(
        mapping_convention="jordan_wigner",
        qubit_order_convention="qubit0_first",
        identity_offset_convention="included",
        zero_threshold_float64_hex=float_to_ieee754_hex(1e-12),
    )
    digest = hamiltonian_exact_content_digest(hamiltonian, context=context)
    wrapped = CanonicalQubitOperator(
        hamiltonian=hamiltonian,
        identity_context=context,
        exact_content_sha256=digest,
    )
    assert wrapped.exact_content_sha256 == digest
    with pytest.raises(ValidationError, match="digest"):
        CanonicalQubitOperator(
            hamiltonian=hamiltonian,
            identity_context=context,
            exact_content_sha256="0" * 64,
        )


def test_basis_state_and_parametric_circuit_have_provider_neutral_digests():
    state = CanonicalBasisState(
        num_qubits=4,
        occupation_qubit0_first="1010",
        qubit_order_convention="canonical_qubit0_first_alpha_then_beta",
    )
    circuit = CanonicalParametricCircuit(
        num_qubits=4,
        qubit_order_convention="canonical_qubit0_first_alpha_then_beta",
        parameter_orientation="exp_theta_over_2_generator",
        parameter_slots=[
            CanonicalParameterSlot(
                slot_id="theta.double",
                initial_float64_hex=float_to_ieee754_hex(0.0),
            )
        ],
        rotations=[
            SymbolicPauliRotation(
                pauli_qubit0_first="XXXY",
                parameter_slot_id="theta.double",
                angle_multiplier_numerator=1,
                angle_multiplier_denominator=8,
            )
        ],
    )
    assert len(canonical_basis_state_digest(state)) == 64
    assert len(canonical_parametric_circuit_digest(circuit)) == 64


def test_parametric_circuit_rejects_unknown_slot_and_wrong_width():
    common = dict(
        num_qubits=4,
        qubit_order_convention="qubit0_first",
        parameter_orientation="exp_theta_over_2_generator",
        parameter_slots=[
            CanonicalParameterSlot(
                slot_id="theta",
                initial_float64_hex=float_to_ieee754_hex(0.0),
            )
        ],
    )
    with pytest.raises(ValidationError, match="unknown parameter slot"):
        CanonicalParametricCircuit(
            **common,
            rotations=[
                SymbolicPauliRotation(
                    pauli_qubit0_first="XXXX",
                    parameter_slot_id="other",
                    angle_multiplier_numerator=1,
                    angle_multiplier_denominator=8,
                )
            ],
        )
    with pytest.raises(ValidationError, match="all-identity"):
        CanonicalParametricCircuit(
            **common,
            rotations=[
                SymbolicPauliRotation(
                    pauli_qubit0_first="IIII",
                    parameter_slot_id="theta",
                    angle_multiplier_numerator=1,
                    angle_multiplier_denominator=8,
                )
            ],
        )
    with pytest.raises(ValidationError, match="width"):
        CanonicalParametricCircuit(
            **common,
            rotations=[
                SymbolicPauliRotation(
                    pauli_qubit0_first="XX",
                    parameter_slot_id="theta",
                    angle_multiplier_numerator=1,
                    angle_multiplier_denominator=8,
                )
            ],
        )


def test_conversion_graph_resolves_only_one_role_specific_edge():
    edge = ConversionEdge(
        edge_key="canonical-qubit-to-qiskit-v1",
        role=ConversionRole.QUBIT_OPERATOR,
        source=InterchangeRepresentation.CANONICAL_QUBIT_OPERATOR,
        target=InterchangeRepresentation.QISKIT_SPARSE_PAULI_OP,
        adapter_release_id="majorana-qiskit-interchange-0.1.0",
        adapter_version="0.1.0",
    )
    graph = ConversionGraph(edges=[edge])
    assert (
        graph.resolve_direct(
            role=ConversionRole.QUBIT_OPERATOR,
            source=InterchangeRepresentation.CANONICAL_QUBIT_OPERATOR,
            target=InterchangeRepresentation.QISKIT_SPARSE_PAULI_OP,
        )
        == edge
    )
    with pytest.raises(ValueError, match="no direct"):
        graph.resolve_direct(
            role=ConversionRole.STATE_PREPARATION,
            source=InterchangeRepresentation.CANONICAL_BASIS_STATE,
            target=InterchangeRepresentation.QISKIT_QUANTUM_CIRCUIT,
        )


def test_execution_side_conversion_bundle_rejects_broken_digest_chain():
    edge_one = ConversionEdge(
        edge_key="openfermion-to-canonical-v1",
        role=ConversionRole.FERMIONIC_OPERATOR,
        source=InterchangeRepresentation.OPENFERMION_FERMION_OPERATOR,
        target=InterchangeRepresentation.CANONICAL_FERMION_OPERATOR,
        adapter_release_id="majorana-openfermion-interchange-0.1.0",
        adapter_version="0.1.0",
    )
    edge_two = ConversionEdge(
        edge_key="canonical-fermion-to-qubit-v1",
        role=ConversionRole.FERMIONIC_OPERATOR,
        source=InterchangeRepresentation.CANONICAL_FERMION_OPERATOR,
        target=InterchangeRepresentation.CANONICAL_QUBIT_OPERATOR,
        adapter_release_id="majorana-openfermion-jw-0.1.0",
        adapter_version="0.1.0",
    )
    evidence_one = ConversionEvidence(
        edge=edge_one,
        input_sha256="1" * 64,
        output_sha256="2" * 64,
        witness_sha256="3" * 64,
        verification=ConversionVerification.EXACT_RECONSTRUCTION,
        tolerance_float64_hex=float_to_ieee754_hex(0.0),
        verified=True,
    )
    evidence_two = ConversionEvidence(
        edge=edge_two,
        input_sha256="2" * 64,
        output_sha256="4" * 64,
        witness_sha256="5" * 64,
        verification=ConversionVerification.MATRIX_EQUIVALENCE,
        tolerance_float64_hex=float_to_ieee754_hex(2e-12),
        verified=True,
    )
    bundle = ConversionEvidenceBundle(
        scientific_spec_sha256="6" * 64,
        registry_resolution_sha256="7" * 64,
        evidence=[evidence_one, evidence_two],
    )
    assert len(bundle.evidence) == 2
    with pytest.raises(ValidationError, match="digest chain"):
        ConversionEvidenceBundle(
            scientific_spec_sha256="6" * 64,
            registry_resolution_sha256="7" * 64,
            evidence=[
                evidence_one,
                evidence_two.model_copy(update={"input_sha256": "8" * 64}),
            ],
        )


def test_exact_reconstruction_evidence_requires_zero_tolerance():
    edge = ConversionEdge(
        edge_key="canonical-qubit-to-qiskit-v1",
        role=ConversionRole.QUBIT_OPERATOR,
        source=InterchangeRepresentation.CANONICAL_QUBIT_OPERATOR,
        target=InterchangeRepresentation.QISKIT_SPARSE_PAULI_OP,
        adapter_release_id="majorana-qiskit-interchange-0.1.0",
        adapter_version="0.1.0",
    )
    with pytest.raises(ValidationError, match="zero tolerance"):
        ConversionEvidence(
            edge=edge,
            input_sha256="1" * 64,
            output_sha256="1" * 64,
            witness_sha256="2" * 64,
            verification=ConversionVerification.EXACT_RECONSTRUCTION,
            tolerance_float64_hex=float_to_ieee754_hex(1e-12),
            verified=True,
        )
