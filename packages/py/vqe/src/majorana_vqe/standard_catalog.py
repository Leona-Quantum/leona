"""Canonical standard-component catalog for the component-first VQE MVP.

Definitions describe scientific meaning. Implementations bind one definition
to a pinned provider/runtime. Configurations remain workflow-specific. Source
URLs are provenance only and never executable identities.
"""

from __future__ import annotations

import dataclasses
import re
from enum import Enum

from .models import ComponentType

CATALOG_SCHEMA_VERSION = "1.1.0"
COMPATIBILITY_CONTRACT_VERSION = "2.0.0"
_PORT_TOKEN = re.compile(r"^[a-z][a-z0-9_]*:[a-z0-9_.-]+$")


class ComponentGroup(str, Enum):
    PROBLEMS_DATASETS = "problems_datasets"
    REPRESENTATION = "representation"
    STATES_ANSATZE = "states_ansatze"
    OPERATOR_POOLS = "operator_pools"
    SEARCH_GROWTH = "search_growth"
    OPTIMIZERS = "optimizers"
    COMPRESSION = "compression"
    MEASUREMENT = "measurement"
    EVALUATION_EXECUTION = "evaluation_execution"


class CapabilityStatus(str, Enum):
    """Legacy seed-construction state.

    This is intentionally not serialized on a Component Definition.  It
    remains only to keep the bounded seed declarations readable while S2
    migrates their semantic payloads to the typed executable schema.
    """

    EXECUTABLE = "executable"
    STRUCTURED = "structured"
    EXPERIMENTAL = "experimental"
    DEFERRED = "deferred"


class DefinitionMaturity(str, Enum):
    DRAFT = "draft"
    STRUCTURED = "structured"
    REVIEWED = "reviewed"


class CatalogState(str, Enum):
    ACTIVE = "active"
    EXPERIMENTAL = "experimental"
    DEFERRED = "deferred"


class EvidenceLevel(str, Enum):
    DOCUMENTED = "documented"
    ADAPTER_TESTED = "adapter_tested"
    RUNTIME_QUALIFIED = "runtime_qualified"


class BindingKind(str, Enum):
    PROVIDER_NATIVE = "provider_native"
    ATLAS_ADAPTER = "atlas_adapter"
    NEUTRAL_PROTOCOL = "neutral_protocol"
    DATASET_SNAPSHOT = "dataset_snapshot"
    RUNTIME_OBSERVED = "runtime_observed"
    DOCUMENTED_ONLY = "documented_only"


class WorkflowStatus(str, Enum):
    STRUCTURED = "structured"
    COMPATIBLE = "compatible"
    EXECUTABLE = "executable"
    EXECUTED = "executed"


class RoleApplicability(str, Enum):
    REQUIRED = "required"
    OPTIONAL = "optional"
    NOT_APPLICABLE = "not_applicable"
    FORBIDDEN = "forbidden"


@dataclasses.dataclass(frozen=True, order=True)
class ContractPort:
    name: str
    value: str


def _port(token: str) -> ContractPort:
    if not _PORT_TOKEN.fullmatch(token):
        raise ValueError(f"invalid compatibility port token: {token!r}")
    name, value = token.split(":", 1)
    return ContractPort(name=name, value=value)


@dataclasses.dataclass(frozen=True)
class CanonicalComponentDefinition:
    semantic_key: str
    definition_version: str
    display_name: str
    component_type: ComponentType
    group: ComponentGroup
    semantic_definition: str
    maturity: DefinitionMaturity
    catalog_state: CatalogState
    requires: tuple[ContractPort, ...]
    provides: tuple[ContractPort, ...]
    source_locators: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class ComponentImplementationBinding:
    binding_key: str
    component_semantic_key: str
    provider: str
    package: str
    package_version: str
    binding_kind: BindingKind
    runtime_profile_id: str | None
    adapter_release_id: str | None
    evidence_level: EvidenceLevel
    evidence_locators: tuple[str, ...]
    supported_configuration_fields: tuple[str, ...] = ()
    known_incompatibilities: tuple[str, ...] = ()


@dataclasses.dataclass(frozen=True)
class WorkflowComponentSelection:
    role: ComponentType
    component_semantic_key: str | None
    applicability: RoleApplicability = RoleApplicability.REQUIRED
    configuration: tuple[tuple[str, str], ...] = ()
    bound_contracts: tuple[ContractPort, ...] = ()


@dataclasses.dataclass(frozen=True)
class StandardWorkflowTemplate:
    workflow_key: str
    display_name: str
    status: WorkflowStatus
    selections: tuple[WorkflowComponentSelection, ...]
    supported_evaluator_providers: tuple[str, ...]
    registry_semantic_key: str | None = None


@dataclasses.dataclass(frozen=True)
class CompatibilityIssue:
    code: str
    component_semantic_key: str
    missing_contract: str | None = None


@dataclasses.dataclass(frozen=True)
class CompatibilityResult:
    compatible: bool
    contract_version: str
    issues: tuple[CompatibilityIssue, ...]
    accumulated_contracts: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class ControlledComparisonSpec:
    comparison_key: str
    baseline_workflow_key: str
    candidate_workflow_key: str
    changed_role: ComponentType
    baseline_component_key: str
    candidate_component_key: str


@dataclasses.dataclass(frozen=True)
class ConfigurationMigrationResult:
    migrated: tuple[tuple[str, str], ...]
    dropped: tuple[tuple[str, str], ...]
    requires_explicit_acceptance: bool


def _definition(
    semantic_key: str,
    display_name: str,
    component_type: ComponentType,
    group: ComponentGroup,
    definition: str,
    status: CapabilityStatus,
    *,
    requires: tuple[str, ...] = (),
    provides: tuple[str, ...] = (),
    sources: tuple[str, ...] = (),
) -> CanonicalComponentDefinition:
    maturity = (
        DefinitionMaturity.STRUCTURED
        if status in (CapabilityStatus.EXECUTABLE, CapabilityStatus.STRUCTURED)
        else DefinitionMaturity.DRAFT
    )
    catalog_state = {
        CapabilityStatus.EXECUTABLE: CatalogState.ACTIVE,
        CapabilityStatus.STRUCTURED: CatalogState.ACTIVE,
        CapabilityStatus.EXPERIMENTAL: CatalogState.EXPERIMENTAL,
        CapabilityStatus.DEFERRED: CatalogState.DEFERRED,
    }[status]
    return CanonicalComponentDefinition(
        semantic_key=semantic_key,
        definition_version="1.0.0",
        display_name=display_name,
        component_type=component_type,
        group=group,
        semantic_definition=definition,
        maturity=maturity,
        catalog_state=catalog_state,
        requires=tuple(_port(item) for item in requires),
        provides=tuple(_port(item) for item in provides),
        source_locators=sources,
    )


QISKIT_NATURE_CIRCUIT_DOCS = (
    "https://qiskit-community.github.io/qiskit-nature/apidocs/"
    "qiskit_nature.second_q.circuit.library.html"
)
QISKIT_ADAPT_DOCS = "https://qiskit-community.github.io/qiskit-nature/howtos/adapt_vqe.html"
PENNYLANE_QCHEM_DOCS = (
    "https://docs.pennylane.ai/en/stable/code/api/pennylane.qchem.molecular_hamiltonian.html"
)
PENNYLANE_UCCSD_DOCS = "https://docs.pennylane.ai/en/stable/code/api/pennylane.UCCSD.html"
OPENFERMION_SOURCE = "https://github.com/quantumlib/OpenFermion"
HAMLIB_DATASET = "https://portal.nersc.gov/cfs/m888/dcamps/hamlib/"


STANDARD_COMPONENTS: tuple[CanonicalComponentDefinition, ...] = (
    _definition(
        "problem.h2.sto3g.v1",
        "H₂ / STO-3G",
        ComponentType.PROBLEM,
        ComponentGroup.PROBLEMS_DATASETS,
        "Neutral H₂ electronic-structure problem in the STO-3G basis.",
        CapabilityStatus.EXECUTABLE,
        provides=("problem:electronic_structure", "molecule:h2", "electrons:2", "spin_orbitals:4"),
    ),
    _definition(
        "problem.lih.sto3g.v1",
        "LiH / STO-3G",
        ComponentType.PROBLEM,
        ComponentGroup.PROBLEMS_DATASETS,
        "Neutral LiH electronic-structure problem in the STO-3G basis.",
        CapabilityStatus.STRUCTURED,
        provides=("problem:electronic_structure", "molecule:lih"),
    ),
    _definition(
        "dataset.hamlib.small.v1",
        "HamLib small instances",
        ComponentType.PROBLEM,
        ComponentGroup.PROBLEMS_DATASETS,
        "A bounded selection of Hamiltonian instances from HamLib.",
        CapabilityStatus.STRUCTURED,
        provides=("problem:qubit_hamiltonian", "dataset:hamlib"),
        sources=(HAMLIB_DATASET,),
    ),
    _definition(
        "preparation.pyscf.rhf.v1",
        "PySCF canonical RHF preparation",
        ComponentType.PROBLEM_PREPARATION,
        ComponentGroup.PROBLEMS_DATASETS,
        "Restricted Hartree–Fock integral and orbital preparation with pinned conventions.",
        CapabilityStatus.EXECUTABLE,
        requires=("problem:electronic_structure",),
        provides=("prepared:electronic_structure",),
    ),
    _definition(
        "mapping.jordan_wigner.v1",
        "Jordan–Wigner",
        ComponentType.REPRESENTATION,
        ComponentGroup.REPRESENTATION,
        "Jordan–Wigner fermion-to-qubit mapping.",
        CapabilityStatus.EXECUTABLE,
        requires=("prepared:electronic_structure",),
        provides=("operator:qubit", "mapping:jordan_wigner"),
        sources=(QISKIT_NATURE_CIRCUIT_DOCS, PENNYLANE_QCHEM_DOCS, OPENFERMION_SOURCE),
    ),
    _definition(
        "mapping.parity.v1",
        "Parity mapping",
        ComponentType.REPRESENTATION,
        ComponentGroup.REPRESENTATION,
        "Parity fermion-to-qubit mapping without implicit tapering.",
        CapabilityStatus.STRUCTURED,
        requires=("prepared:electronic_structure",),
        provides=("operator:qubit", "mapping:parity"),
        sources=(PENNYLANE_QCHEM_DOCS,),
    ),
    _definition(
        "mapping.bravyi_kitaev.v1",
        "Bravyi–Kitaev",
        ComponentType.REPRESENTATION,
        ComponentGroup.REPRESENTATION,
        "Bravyi–Kitaev fermion-to-qubit mapping.",
        CapabilityStatus.STRUCTURED,
        requires=("prepared:electronic_structure",),
        provides=("operator:qubit", "mapping:bravyi_kitaev"),
        sources=(PENNYLANE_QCHEM_DOCS, OPENFERMION_SOURCE),
    ),
    _definition(
        "reference.hartree_fock.v1",
        "Hartree–Fock reference",
        ComponentType.REFERENCE_STATE,
        ComponentGroup.STATES_ANSATZE,
        "Computational-basis Hartree–Fock occupation state.",
        CapabilityStatus.EXECUTABLE,
        requires=("qubits:4", "electrons:2"),
        provides=("state:reference",),
        sources=(QISKIT_NATURE_CIRCUIT_DOCS, PENNYLANE_UCCSD_DOCS),
    ),
    _definition(
        "ansatz.h2.fixed_excitation.v1",
        "Fixed one-parameter H₂ excitation",
        ComponentType.ANSATZ,
        ComponentGroup.STATES_ANSATZE,
        "One canonical anti-Hermitian double-excitation block for four-qubit H₂.",
        CapabilityStatus.EXECUTABLE,
        requires=("state:reference", "mapping:jordan_wigner", "qubits:4"),
        provides=("state:parametric", "parameters:1"),
    ),
    _definition(
        "ansatz.uccsd.v1",
        "UCCSD",
        ComponentType.ANSATZ,
        ComponentGroup.STATES_ANSATZE,
        "Unitary coupled-cluster ansatz with single and double excitations.",
        CapabilityStatus.STRUCTURED,
        requires=("state:reference", "operator:qubit"),
        provides=("state:parametric", "ansatz:uccsd"),
        sources=(QISKIT_NATURE_CIRCUIT_DOCS, PENNYLANE_UCCSD_DOCS),
    ),
    _definition(
        "ansatz.hardware_efficient_ry_cx.v1",
        "Hardware-efficient RY–CX",
        ComponentType.ANSATZ,
        ComponentGroup.STATES_ANSATZE,
        "Layered RY rotations and CX entanglers with explicit topology and depth.",
        CapabilityStatus.STRUCTURED,
        requires=("state:reference", "operator:qubit"),
        provides=("state:parametric", "ansatz:hardware_efficient"),
    ),
    _definition(
        "pool.h2.singleton_double.v1",
        "H₂ singleton double pool",
        ComponentType.OPERATOR_POOL,
        ComponentGroup.OPERATOR_POOLS,
        "The single canonical H₂ double-excitation generator.",
        CapabilityStatus.EXECUTABLE,
        requires=("mapping:jordan_wigner", "qubits:4"),
        provides=("pool:operators", "pool:singleton"),
    ),
    _definition(
        "pool.uccsd.singles_doubles.v1",
        "UCCSD singles/doubles pool",
        ComponentType.OPERATOR_POOL,
        ComponentGroup.OPERATOR_POOLS,
        "Occupied-to-virtual single and double excitation generators.",
        CapabilityStatus.STRUCTURED,
        requires=("prepared:electronic_structure",),
        provides=("pool:operators", "pool:uccsd"),
    ),
    _definition(
        "pool.fermionic.singles_doubles.v1",
        "Fermionic singles/doubles pool",
        ComponentType.OPERATOR_POOL,
        ComponentGroup.OPERATOR_POOLS,
        "Spin-orbital fermionic single and double excitation generators.",
        CapabilityStatus.STRUCTURED,
        requires=("prepared:electronic_structure",),
        provides=("pool:operators", "pool:fermionic_sd"),
    ),
    _definition(
        "pool.generalized.singles_doubles.v1",
        "Generalized singles/doubles pool",
        ComponentType.OPERATOR_POOL,
        ComponentGroup.OPERATOR_POOLS,
        "Generalized single and double excitations over the active spin orbitals.",
        CapabilityStatus.STRUCTURED,
        requires=("prepared:electronic_structure",),
        provides=("pool:operators", "pool:generalized_sd"),
    ),
    _definition(
        "search.fixed.none.v1",
        "Fixed ansatz / no adaptive search",
        ComponentType.SEARCH_SELECTION,
        ComponentGroup.SEARCH_GROWTH,
        "No adaptive ranking; use the fixed operator sequence.",
        CapabilityStatus.EXECUTABLE,
        requires=("pool:operators",),
        provides=("selection:fixed",),
    ),
    _definition(
        "search.gradient_top1.v1",
        "Gradient top-1 selection",
        ComponentType.SEARCH_SELECTION,
        ComponentGroup.SEARCH_GROWTH,
        "Select one pool member with the largest absolute energy gradient.",
        CapabilityStatus.STRUCTURED,
        requires=("pool:operators", "operator:qubit", "state:parametric"),
        provides=("selection:gradient_top1",),
        sources=(QISKIT_ADAPT_DOCS,),
    ),
    _definition(
        "growth.single_operator.v1",
        "Single-operator growth",
        ComponentType.GROWTH_BATCHING,
        ComponentGroup.SEARCH_GROWTH,
        "Append exactly one selected operator per adaptive iteration.",
        CapabilityStatus.STRUCTURED,
        requires=("selection:gradient_top1",),
        provides=("growth:single",),
        sources=(QISKIT_ADAPT_DOCS,),
    ),
    _definition(
        "growth.fixed_singleton.v1",
        "Fixed singleton growth",
        ComponentType.GROWTH_BATCHING,
        ComponentGroup.SEARCH_GROWTH,
        "Materialize the one fixed H₂ pool member once.",
        CapabilityStatus.EXECUTABLE,
        requires=("selection:fixed", "pool:singleton"),
        provides=("state:parametric", "growth:fixed"),
    ),
    _definition(
        "optimizer.scipy_bounded_scalar.v1",
        "SciPy bounded scalar optimizer",
        ComponentType.PARAMETER_OPTIMIZER,
        ComponentGroup.OPTIMIZERS,
        "Deterministic bounded scalar minimization for the one-parameter H₂ workflow.",
        CapabilityStatus.EXECUTABLE,
        requires=("state:parametric", "parameters:1"),
        provides=("parameters:optimized",),
    ),
    _definition(
        "optimizer.slsqp.v1",
        "SLSQP",
        ComponentType.PARAMETER_OPTIMIZER,
        ComponentGroup.OPTIMIZERS,
        "Sequential least-squares programming with explicit tolerances and bounds.",
        CapabilityStatus.EXPERIMENTAL,
        requires=("state:parametric",),
        provides=("parameters:optimized", "optimizer:slsqp"),
    ),
    _definition(
        "optimizer.cobyla.v1",
        "COBYLA",
        ComponentType.PARAMETER_OPTIMIZER,
        ComponentGroup.OPTIMIZERS,
        "Derivative-free constrained optimization with explicit stopping settings.",
        CapabilityStatus.STRUCTURED,
        requires=("state:parametric",),
        provides=("parameters:optimized", "optimizer:cobyla"),
    ),
    _definition(
        "compression.none.v1",
        "No compression",
        ComponentType.COMPRESSION,
        ComponentGroup.COMPRESSION,
        "Identity compression policy that preserves the complete ansatz.",
        CapabilityStatus.EXECUTABLE,
        requires=("state:parametric",),
        provides=("compression:none",),
    ),
    _definition(
        "measurement.exact_statevector.v1",
        "Exact statevector estimator",
        ComponentType.MEASUREMENT,
        ComponentGroup.MEASUREMENT,
        "Deterministic exact expectation of the qubit Hamiltonian; shots are absent.",
        CapabilityStatus.EXECUTABLE,
        requires=("operator:qubit", "state:parametric"),
        provides=("observation:energy_exact",),
    ),
    _definition(
        "measurement.finite_shot.v1",
        "Finite-shot estimator",
        ComponentType.MEASUREMENT,
        ComponentGroup.MEASUREMENT,
        "Shot-based energy estimation with explicit shot count and random seed.",
        CapabilityStatus.EXPERIMENTAL,
        requires=("operator:qubit", "state:parametric"),
        provides=("observation:energy_sampled",),
    ),
    _definition(
        "mitigation.none.v1",
        "No error mitigation",
        ComponentType.ERROR_MITIGATION,
        ComponentGroup.MEASUREMENT,
        "Identity mitigation policy.",
        CapabilityStatus.STRUCTURED,
        provides=("mitigation:none",),
    ),
    _definition(
        "evaluation.exact_reference.v1",
        "Exact reference comparison",
        ComponentType.EVALUATION_PROTOCOL,
        ComponentGroup.EVALUATION_EXECUTION,
        "Absolute total-energy error against a fixed offline exact reference.",
        CapabilityStatus.EXECUTABLE,
        requires=("observation:energy_exact",),
        provides=("evaluation:absolute_error",),
    ),
    _definition(
        "stopping.optimizer_convergence.v1",
        "Optimizer convergence stopping",
        ComponentType.STOPPING_PROTOCOL,
        ComponentGroup.EVALUATION_EXECUTION,
        "Stop according to the optimizer tolerance and function-evaluation cap.",
        CapabilityStatus.EXECUTABLE,
        requires=("parameters:optimized",),
        provides=("stopping:optimizer_convergence",),
    ),
    _definition(
        "compilation.canonical_logical.v2",
        "Canonical logical resource protocol",
        ComponentType.COMPILATION_BACKEND,
        ComponentGroup.EVALUATION_EXECUTION,
        "Framework-neutral logical CNOT/depth protocol with fixed basis and topology.",
        CapabilityStatus.EXECUTABLE,
        requires=("state:parametric",),
        provides=("metrics:cnot_depth",),
    ),
)


def _binding(
    component: str,
    provider: str,
    package: str,
    version: str,
    binding_kind: BindingKind,
    evidence_level: EvidenceLevel,
    *,
    runtime: str | None = None,
    adapter: str | None = None,
    evidence: tuple[str, ...] = (),
    supported_configuration_fields: tuple[str, ...] = (),
    known_incompatibilities: tuple[str, ...] = (),
) -> ComponentImplementationBinding:
    return ComponentImplementationBinding(
        binding_key=f"{component}:{provider}:{version}",
        component_semantic_key=component,
        provider=provider,
        package=package,
        package_version=version,
        binding_kind=binding_kind,
        runtime_profile_id=runtime,
        adapter_release_id=adapter,
        evidence_level=evidence_level,
        evidence_locators=evidence,
        supported_configuration_fields=supported_configuration_fields,
        known_incompatibilities=known_incompatibilities,
    )


_H2_EXECUTABLE_COMPONENTS = (
    "problem.h2.sto3g.v1",
    "preparation.pyscf.rhf.v1",
    "mapping.jordan_wigner.v1",
    "reference.hartree_fock.v1",
    "ansatz.h2.fixed_excitation.v1",
    "pool.h2.singleton_double.v1",
    "search.fixed.none.v1",
    "growth.fixed_singleton.v1",
    "optimizer.scipy_bounded_scalar.v1",
    "compression.none.v1",
    "measurement.exact_statevector.v1",
    "evaluation.exact_reference.v1",
    "stopping.optimizer_convergence.v1",
    "compilation.canonical_logical.v2",
)

_RUNTIME_EVIDENCE = ("docs/atlas/evidence/phase5b_h2_runtime_qualification_2026-07-26.json",)
_FIXTURE_EVIDENCE = (
    "docs/atlas/fixtures/h2_sto3g/manifest.json",
    "docs/atlas/fixtures/h2_sto3g/executable_components_v0.2.json",
)
_CIRCUIT_EVIDENCE = (
    "docs/atlas/fixtures/h2_sto3g/canonical_double_excitation_v0.2.json",
    *_RUNTIME_EVIDENCE,
)

_CONFIGURATION_FIELDS_BY_COMPONENT: dict[str, frozenset[str]] = {
    "optimizer.scipy_bounded_scalar.v1": frozenset(
        {
            "initial_point_float64_hex",
            "lower_bound_float64_hex",
            "upper_bound_float64_hex",
            "energy_tolerance_float64_hex",
            "max_objective_evaluations",
            "max_wall_time_seconds",
        }
    ),
    "optimizer.slsqp.v1": frozenset(
        {
            "initial_point_float64_hex",
            "lower_bound_float64_hex",
            "upper_bound_float64_hex",
            "energy_tolerance_float64_hex",
            "max_objective_evaluations",
            "max_wall_time_seconds",
        }
    ),
    "optimizer.cobyla.v1": frozenset(
        {
            "initial_point_float64_hex",
            "lower_bound_float64_hex",
            "upper_bound_float64_hex",
            "energy_tolerance_float64_hex",
            "max_objective_evaluations",
            "max_wall_time_seconds",
            "initial_trust_region_radius_float64_hex",
            "final_trust_region_radius_float64_hex",
            "constraint_tolerance_float64_hex",
        }
    ),
}

STANDARD_IMPLEMENTATIONS: tuple[ComponentImplementationBinding, ...] = (
    _binding(
        "problem.h2.sto3g.v1",
        "atlas",
        "atlas-h2-fixture",
        "0.2.0",
        BindingKind.DATASET_SNAPSHOT,
        EvidenceLevel.RUNTIME_QUALIFIED,
        evidence=_FIXTURE_EVIDENCE,
    ),
    _binding(
        "preparation.pyscf.rhf.v1",
        "pyscf",
        "pyscf",
        "2.14.0",
        BindingKind.RUNTIME_OBSERVED,
        EvidenceLevel.ADAPTER_TESTED,
        evidence=_FIXTURE_EVIDENCE,
    ),
    _binding(
        "mapping.jordan_wigner.v1",
        "atlas",
        "atlas-h2-fixture",
        "0.2.0",
        BindingKind.DATASET_SNAPSHOT,
        EvidenceLevel.ADAPTER_TESTED,
        evidence=_FIXTURE_EVIDENCE,
    ),
    _binding(
        "reference.hartree_fock.v1",
        "qiskit",
        "qiskit",
        "1.4.6",
        BindingKind.ATLAS_ADAPTER,
        EvidenceLevel.RUNTIME_QUALIFIED,
        runtime="h2-qiskit-linux-x86_64-candidate-v1",
        adapter="majorana-h2-qiskit-adapter-0.2.0",
        evidence=_RUNTIME_EVIDENCE,
    ),
    _binding(
        "reference.hartree_fock.v1",
        "pennylane",
        "pennylane",
        "0.45.1",
        BindingKind.ATLAS_ADAPTER,
        EvidenceLevel.RUNTIME_QUALIFIED,
        runtime="h2-pennylane-linux-x86_64-candidate-v1",
        adapter="majorana-h2-pennylane-adapter-0.2.0",
        evidence=_RUNTIME_EVIDENCE,
    ),
    _binding(
        "ansatz.h2.fixed_excitation.v1",
        "qiskit",
        "qiskit",
        "1.4.6",
        BindingKind.ATLAS_ADAPTER,
        EvidenceLevel.RUNTIME_QUALIFIED,
        runtime="h2-qiskit-linux-x86_64-candidate-v1",
        adapter="majorana-h2-qiskit-adapter-0.2.0",
        evidence=_CIRCUIT_EVIDENCE,
    ),
    _binding(
        "ansatz.h2.fixed_excitation.v1",
        "pennylane",
        "pennylane",
        "0.45.1",
        BindingKind.ATLAS_ADAPTER,
        EvidenceLevel.RUNTIME_QUALIFIED,
        runtime="h2-pennylane-linux-x86_64-candidate-v1",
        adapter="majorana-h2-pennylane-adapter-0.2.0",
        evidence=_CIRCUIT_EVIDENCE,
    ),
    *(
        _binding(
            component,
            "atlas",
            "majorana-vqe",
            "0.1.0",
            BindingKind.NEUTRAL_PROTOCOL,
            EvidenceLevel.ADAPTER_TESTED,
            evidence=_FIXTURE_EVIDENCE,
        )
        for component in (
            "pool.h2.singleton_double.v1",
            "search.fixed.none.v1",
            "growth.fixed_singleton.v1",
            "compression.none.v1",
            "evaluation.exact_reference.v1",
            "stopping.optimizer_convergence.v1",
            "compilation.canonical_logical.v2",
        )
    ),
    _binding(
        "optimizer.scipy_bounded_scalar.v1",
        "scipy",
        "scipy",
        "1.18.0",
        BindingKind.PROVIDER_NATIVE,
        EvidenceLevel.RUNTIME_QUALIFIED,
        evidence=_RUNTIME_EVIDENCE,
        supported_configuration_fields=tuple(
            sorted(_CONFIGURATION_FIELDS_BY_COMPONENT["optimizer.scipy_bounded_scalar.v1"])
        ),
    ),
    _binding(
        "optimizer.slsqp.v1",
        "scipy",
        "scipy",
        "1.18.0",
        BindingKind.PROVIDER_NATIVE,
        EvidenceLevel.ADAPTER_TESTED,
        evidence=(
            "https://docs.scipy.org/doc/scipy/reference/optimize.minimize-slsqp.html",
            "docs/atlas/evidence/phase76/qiskit_slsqp_local.json",
            "docs/atlas/evidence/phase76/pennylane_slsqp_local.json",
        ),
        supported_configuration_fields=tuple(
            sorted(_CONFIGURATION_FIELDS_BY_COMPONENT["optimizer.slsqp.v1"])
        ),
        known_incompatibilities=("no_runtime_qualified_phase76_adapter",),
    ),
    _binding(
        "optimizer.cobyla.v1",
        "scipy",
        "scipy",
        "1.18.0",
        BindingKind.PROVIDER_NATIVE,
        EvidenceLevel.RUNTIME_QUALIFIED,
        evidence=(
            "https://docs.scipy.org/doc/scipy/reference/optimize.minimize-cobyla.html",
            "docs/atlas/evidence/phase78/qiskit_cobyla_local.json",
            "docs/atlas/evidence/phase78/pennylane_cobyla_local.json",
            "docs/atlas/evidence/phase78/qiskit_oci_publish.json",
            "docs/atlas/evidence/phase78/pennylane_oci_publish.json",
            "docs/atlas/evidence/phase78/s6_private_oci_e2e.json",
        ),
        supported_configuration_fields=tuple(
            sorted(_CONFIGURATION_FIELDS_BY_COMPONENT["optimizer.cobyla.v1"])
        ),
    ),
    _binding(
        "measurement.exact_statevector.v1",
        "qiskit",
        "qiskit",
        "1.4.6",
        BindingKind.PROVIDER_NATIVE,
        EvidenceLevel.RUNTIME_QUALIFIED,
        runtime="h2-qiskit-linux-x86_64-candidate-v1",
        adapter="majorana-h2-qiskit-adapter-0.2.0",
        evidence=_RUNTIME_EVIDENCE,
    ),
    _binding(
        "measurement.exact_statevector.v1",
        "pennylane",
        "pennylane",
        "0.45.1",
        BindingKind.PROVIDER_NATIVE,
        EvidenceLevel.RUNTIME_QUALIFIED,
        runtime="h2-pennylane-linux-x86_64-candidate-v1",
        adapter="majorana-h2-pennylane-adapter-0.2.0",
        evidence=_RUNTIME_EVIDENCE,
    ),
)


_H2_FIXED_SELECTIONS = tuple(
    WorkflowComponentSelection(
        role=next(
            item.component_type for item in STANDARD_COMPONENTS if item.semantic_key == semantic_key
        ),
        component_semantic_key=semantic_key,
        bound_contracts=(_port("qubits:4"),) if semantic_key == "mapping.jordan_wigner.v1" else (),
    )
    for semantic_key in _H2_EXECUTABLE_COMPONENTS
)


def _replace_selection(
    selections: tuple[WorkflowComponentSelection, ...],
    role: ComponentType,
    semantic_key: str | None,
    *,
    applicability: RoleApplicability = RoleApplicability.REQUIRED,
) -> tuple[WorkflowComponentSelection, ...]:
    return tuple(
        WorkflowComponentSelection(
            role=item.role,
            component_semantic_key=semantic_key,
            applicability=applicability,
        )
        if item.role is role
        else item
        for item in selections
    )


def _mark_not_applicable(
    selections: tuple[WorkflowComponentSelection, ...],
    *roles: ComponentType,
) -> tuple[WorkflowComponentSelection, ...]:
    result = selections
    for role in roles:
        result = _replace_selection(
            result,
            role,
            None,
            applicability=RoleApplicability.NOT_APPLICABLE,
        )
    return result


def migrate_selection_configuration(
    configuration: tuple[tuple[str, str], ...],
    *,
    candidate_component_key: str,
) -> ConfigurationMigrationResult:
    """Report incompatible configuration fields instead of silently dropping them."""

    allowed = _CONFIGURATION_FIELDS_BY_COMPONENT.get(candidate_component_key, frozenset())
    migrated = tuple(item for item in configuration if item[0] in allowed)
    dropped = tuple(item for item in configuration if item[0] not in allowed)
    return ConfigurationMigrationResult(
        migrated=migrated,
        dropped=dropped,
        requires_explicit_acceptance=bool(dropped),
    )


STANDARD_WORKFLOWS: tuple[StandardWorkflowTemplate, ...] = (
    StandardWorkflowTemplate(
        workflow_key="workflow.h2.fixed_excitation.v1",
        display_name="H₂ fixed-excitation VQE",
        status=WorkflowStatus.EXECUTABLE,
        selections=_H2_FIXED_SELECTIONS,
        supported_evaluator_providers=("qiskit", "pennylane"),
        registry_semantic_key="h2.sto3g.actual_vqe.workflow.v0_2",
    ),
    StandardWorkflowTemplate(
        workflow_key="workflow.h2.uccsd.v1",
        display_name="H₂ UCCSD VQE",
        status=WorkflowStatus.STRUCTURED,
        selections=_mark_not_applicable(
            _replace_selection(
                _H2_FIXED_SELECTIONS,
                ComponentType.ANSATZ,
                "ansatz.uccsd.v1",
            ),
            ComponentType.OPERATOR_POOL,
            ComponentType.SEARCH_SELECTION,
            ComponentType.GROWTH_BATCHING,
        ),
        supported_evaluator_providers=(),
    ),
    StandardWorkflowTemplate(
        workflow_key="workflow.h2.hardware_efficient.v1",
        display_name="H₂ hardware-efficient VQE",
        status=WorkflowStatus.STRUCTURED,
        selections=_mark_not_applicable(
            _replace_selection(
                _H2_FIXED_SELECTIONS,
                ComponentType.ANSATZ,
                "ansatz.hardware_efficient_ry_cx.v1",
            ),
            ComponentType.OPERATOR_POOL,
            ComponentType.SEARCH_SELECTION,
            ComponentType.GROWTH_BATCHING,
        ),
        supported_evaluator_providers=(),
    ),
    StandardWorkflowTemplate(
        workflow_key="workflow.h2.adapt.v1",
        display_name="H₂ standard ADAPT-VQE",
        status=WorkflowStatus.STRUCTURED,
        selections=_replace_selection(
            _replace_selection(
                _H2_FIXED_SELECTIONS,
                ComponentType.SEARCH_SELECTION,
                "search.gradient_top1.v1",
            ),
            ComponentType.GROWTH_BATCHING,
            "growth.single_operator.v1",
        ),
        supported_evaluator_providers=(),
    ),
    StandardWorkflowTemplate(
        workflow_key="workflow.lih.uccsd.v1",
        display_name="LiH UCCSD VQE",
        status=WorkflowStatus.STRUCTURED,
        selections=_replace_selection(
            _replace_selection(
                _H2_FIXED_SELECTIONS,
                ComponentType.PROBLEM,
                "problem.lih.sto3g.v1",
            ),
            ComponentType.ANSATZ,
            "ansatz.uccsd.v1",
        ),
        supported_evaluator_providers=(),
    ),
    StandardWorkflowTemplate(
        workflow_key="workflow.h2.fixed_excitation.slsqp.v1",
        display_name="H₂ fixed-excitation VQE with SLSQP",
        status=WorkflowStatus.STRUCTURED,
        selections=_replace_selection(
            _H2_FIXED_SELECTIONS,
            ComponentType.PARAMETER_OPTIMIZER,
            "optimizer.slsqp.v1",
        ),
        supported_evaluator_providers=(),
    ),
    StandardWorkflowTemplate(
        workflow_key="workflow.h2.fixed_excitation.cobyla.v1",
        display_name="H₂ fixed-excitation VQE with COBYLA",
        status=WorkflowStatus.STRUCTURED,
        selections=_replace_selection(
            _H2_FIXED_SELECTIONS,
            ComponentType.PARAMETER_OPTIMIZER,
            "optimizer.cobyla.v1",
        ),
        supported_evaluator_providers=(),
    ),
)


def component_by_key(semantic_key: str) -> CanonicalComponentDefinition:
    for component in STANDARD_COMPONENTS:
        if component.semantic_key == semantic_key:
            return component
    raise KeyError(semantic_key)


def workflow_by_key(workflow_key: str) -> StandardWorkflowTemplate:
    for workflow in STANDARD_WORKFLOWS:
        if workflow.workflow_key == workflow_key:
            return workflow
    raise KeyError(workflow_key)


def check_workflow_compatibility(
    workflow: StandardWorkflowTemplate,
) -> CompatibilityResult:
    available: set[ContractPort] = set()
    issues: list[CompatibilityIssue] = []
    seen_roles: set[ComponentType] = set()
    for selection in workflow.selections:
        if selection.role in seen_roles:
            issues.append(
                CompatibilityIssue(
                    code="duplicate_role",
                    component_semantic_key=selection.component_semantic_key,
                )
            )
            continue
        seen_roles.add(selection.role)
        if selection.applicability in (
            RoleApplicability.NOT_APPLICABLE,
            RoleApplicability.FORBIDDEN,
        ):
            if selection.component_semantic_key is not None:
                issues.append(
                    CompatibilityIssue(
                        code="component_present_for_inapplicable_role",
                        component_semantic_key=selection.component_semantic_key,
                    )
                )
            continue
        if selection.component_semantic_key is None:
            if selection.applicability is RoleApplicability.REQUIRED:
                issues.append(
                    CompatibilityIssue(
                        code="missing_required_role",
                        component_semantic_key=f"role:{selection.role.value}",
                    )
                )
            continue
        try:
            component = component_by_key(selection.component_semantic_key)
        except KeyError:
            issues.append(
                CompatibilityIssue(
                    code="unknown_component",
                    component_semantic_key=selection.component_semantic_key,
                )
            )
            continue
        if component.component_type is not selection.role:
            issues.append(
                CompatibilityIssue(
                    code="role_type_mismatch",
                    component_semantic_key=selection.component_semantic_key,
                )
            )
        for requirement in component.requires:
            if requirement not in available:
                issues.append(
                    CompatibilityIssue(
                        code="missing_contract",
                        component_semantic_key=component.semantic_key,
                        missing_contract=f"{requirement.name}:{requirement.value}",
                    )
                )
        available.update(component.provides)
        available.update(selection.bound_contracts)
    return CompatibilityResult(
        compatible=not issues,
        contract_version=COMPATIBILITY_CONTRACT_VERSION,
        issues=tuple(issues),
        accumulated_contracts=tuple(f"{port.name}:{port.value}" for port in sorted(available)),
    )


def build_controlled_comparison(
    comparison_key: str,
    baseline: StandardWorkflowTemplate,
    candidate: StandardWorkflowTemplate,
) -> ControlledComparisonSpec:
    baseline_by_role = {item.role: item for item in baseline.selections}
    candidate_by_role = {item.role: item for item in candidate.selections}
    if set(baseline_by_role) != set(candidate_by_role):
        raise ValueError("controlled comparison requires identical workflow roles")
    changes = [
        role for role in baseline_by_role if baseline_by_role[role] != candidate_by_role[role]
    ]
    if len(changes) != 1:
        raise ValueError("controlled comparison must change exactly one component")
    role = changes[0]
    return ControlledComparisonSpec(
        comparison_key=comparison_key,
        baseline_workflow_key=baseline.workflow_key,
        candidate_workflow_key=candidate.workflow_key,
        changed_role=role,
        baseline_component_key=baseline_by_role[role].component_semantic_key,
        candidate_component_key=candidate_by_role[role].component_semantic_key,
    )


CONTROLLED_COMPARISON_SPECS: tuple[ControlledComparisonSpec, ...] = (
    build_controlled_comparison(
        "comparison.h2.optimizer.slsqp_vs_cobyla.v1",
        workflow_by_key("workflow.h2.fixed_excitation.slsqp.v1"),
        workflow_by_key("workflow.h2.fixed_excitation.cobyla.v1"),
    ),
    build_controlled_comparison(
        "comparison.h2.ansatz.uccsd_vs_hardware_efficient.v1",
        workflow_by_key("workflow.h2.uccsd.v1"),
        workflow_by_key("workflow.h2.hardware_efficient.v1"),
    ),
)

# Historical import compatibility for the immutable Phase 7.6-S0 evidence
# generator. New public bundles use ``comparison_specs`` so an unevaluated
# comparison design cannot be mistaken for measured comparison results.
CONTROLLED_COMPARISONS = CONTROLLED_COMPARISON_SPECS
