"""Canonical circuit IR — a small, static interchange format so imports from
different frameworks converge on deterministic JSON (ir_spec.md). Ported from the
quepo `qhte.ir` engine; v1 circuits stay valid, later versions are additive.

The IR is deliberately narrow (CAPABILITY_MATRIX.md): terminal measurement only,
no mid-circuit feed-forward, no arbitrary multi-controlled gates or pulse
schedules. Those limits are what export classification cites when a target
cannot be represented faithfully (JC-5: blame the IR layer, not the format)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator

IR_VERSION = 3
# String tag stored on ArtifactVersion.ir_version (contracts model uses str).
IR_VERSION_TAG = "ir-v1"

SINGLE_QUBIT_GATES = {"x", "y", "z", "h", "s", "t", "rx", "ry", "rz", "u", "reset"}
TWO_QUBIT_GATES = {"cx", "cz", "swap", "cp"}
THREE_QUBIT_GATES = {"ccx", "cswap"}
PARAMETERIZED_GATES = {"rx", "ry", "rz", "cp", "u"}
ZERO_OR_MORE_QUBIT_GATES = {"barrier"}
SUPPORTED_GATES = (
    SINGLE_QUBIT_GATES
    | TWO_QUBIT_GATES
    | THREE_QUBIT_GATES
    | ZERO_OR_MORE_QUBIT_GATES
    | {"measure"}
)


class ParameterValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["numeric", "symbol", "expression"]
    value: float | str
    symbols: list[str] = Field(default_factory=list)


class Register(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    size: int = Field(ge=1)
    offset: int = Field(ge=0)


class MeasurementSemantics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    basis: Literal["X", "Y", "Z"] = "Z"
    register_name: str | None = None


class DecompositionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_ir_hash: str
    to_ir_hash: str
    method: str
    tool_versions: dict[str, str] = Field(default_factory=dict)


class GateDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    arity: int = Field(ge=1)
    parameter_names: list[str] = Field(default_factory=list)
    decomposition: list[dict[str, Any]] = Field(default_factory=list)


class Operation(BaseModel):
    """Canonical operation model for static circuits."""

    model_config = ConfigDict(extra="forbid")

    gate: str
    qubits: list[int] = Field(default_factory=list)
    params: list[float | str] = Field(default_factory=list)
    typed_params: list[ParameterValue] = Field(default_factory=list)
    clbits: list[int] = Field(default_factory=list)
    condition: None = None
    measurement: MeasurementSemantics | None = None
    annotation: dict[str, Any] | None = None

    @field_validator("gate")
    @classmethod
    def normalize_gate(cls, value: str) -> str:
        gate = value.lower().strip()
        if gate not in SUPPORTED_GATES:
            raise ValueError(f"unsupported gate '{value}'")
        return gate

    @field_validator("qubits", "clbits")
    @classmethod
    def indexes_are_non_negative(cls, values: list[int], info: ValidationInfo) -> list[int]:
        if any(index < 0 for index in values):
            raise ValueError(f"{info.field_name} must contain non-negative indexes")
        return values

    @model_validator(mode="after")
    def validate_shape(self) -> Operation:
        if self.typed_params and len(self.typed_params) != len(self.params):
            raise ValueError("typed_params must align one-to-one with params")
        if self.gate == "measure":
            if len(self.qubits) != 1 or len(self.clbits) != 1:
                raise ValueError("measure operations require one qubit and one classical bit")
            if self.params:
                raise ValueError("measure operations cannot have params")
            return self

        if self.clbits:
            raise ValueError("gate operations cannot include clbits")
        if self.gate == "barrier":
            if not self.qubits:
                raise ValueError("barrier requires at least one qubit")
            if self.params:
                raise ValueError("barrier does not accept parameters")
            return self
        if self.gate in SINGLE_QUBIT_GATES and len(self.qubits) != 1:
            raise ValueError(f"{self.gate} requires exactly one qubit")
        if self.gate in TWO_QUBIT_GATES and len(self.qubits) != 2:
            raise ValueError(f"{self.gate} requires exactly two qubits")
        if self.gate in THREE_QUBIT_GATES and len(self.qubits) != 3:
            raise ValueError(f"{self.gate} requires exactly three qubits")
        if self.gate in {"rx", "ry", "rz", "cp"} and len(self.params) != 1:
            raise ValueError(f"{self.gate} requires exactly one parameter")
        if self.gate == "u" and len(self.params) != 3:
            raise ValueError("u requires exactly three parameters")
        if self.gate not in PARAMETERIZED_GATES and self.params:
            raise ValueError(f"{self.gate} does not accept parameters")
        return self


class Circuit(BaseModel):
    """Versioned canonical IR circuit. v1 circuits remain valid; later versions
    add controlled/general gates without breaking older ones."""

    model_config = ConfigDict(extra="forbid")

    ir_version: Literal[1, 2, 3] = IR_VERSION
    qubits: int = Field(ge=1)
    classical_bits: int = Field(ge=0)
    operations: list[Operation] = Field(default_factory=list)
    quantum_registers: list[Register] = Field(default_factory=list)
    classical_registers: list[Register] = Field(default_factory=list)
    gate_definitions: list[GateDefinition] = Field(default_factory=list)
    decomposition_applied: DecompositionRecord | None = None
    objective_functions: list[dict[str, Any]] = Field(default_factory=list)
    noise_model_annotations: dict[str, Any] = Field(default_factory=dict)
    annotations: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_indexes(self) -> Circuit:
        if (
            self.quantum_registers
            and sum(register.size for register in self.quantum_registers) != self.qubits
        ):
            raise ValueError("quantum register sizes must equal qubits")
        if (
            self.classical_registers
            and sum(register.size for register in self.classical_registers) != self.classical_bits
        ):
            raise ValueError("classical register sizes must equal classical_bits")
        for position, operation in enumerate(self.operations):
            for qubit in operation.qubits:
                if qubit >= self.qubits:
                    raise ValueError(f"operation {position} references missing qubit {qubit}")
            for clbit in operation.clbits:
                if clbit >= self.classical_bits:
                    raise ValueError(
                        f"operation {position} references missing classical bit {clbit}"
                    )
        return self


class ValidationResult(BaseModel):
    validation_version: str = "v1"
    passed: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def validate_circuit(circuit: Circuit) -> ValidationResult:
    """Structural + IR-capability validation. The measurement checks encode the
    terminal-measurement limit that export classification cites (JC-5)."""
    errors: list[str] = []
    warnings: list[str] = []
    measured_qubits: set[int] = set()
    measured_clbits: set[int] = set()
    measurement_started = False

    for index, operation in enumerate(circuit.operations):
        if operation.gate == "measure":
            measurement_started = True
            qubit = operation.qubits[0]
            clbit = operation.clbits[0]
            if qubit in measured_qubits:
                errors.append(f"operation {index}: qubit {qubit} is measured more than once")
            if clbit in measured_clbits:
                errors.append(f"operation {index}: classical bit {clbit} is written more than once")
            measured_qubits.add(qubit)
            measured_clbits.add(clbit)
            continue

        if measurement_started:
            errors.append(
                f"operation {index}: static IR cannot apply gates after measurement "
                "(terminal-measurement limit)"
            )

    if circuit.classical_bits == 0 and any(op.gate == "measure" for op in circuit.operations):
        errors.append("circuit contains measurements but has zero classical bits")

    if circuit.classical_bits > 0 and not measured_clbits:
        warnings.append("circuit allocates classical bits but does not measure into them")

    return ValidationResult(passed=not errors, errors=errors, warnings=warnings)


def parameter_value(value: float | str) -> ParameterValue:
    if isinstance(value, int | float):
        return ParameterValue(kind="numeric", value=float(value))
    expression = str(value).strip()
    symbols = sorted(
        {
            token
            for token in expression.replace("*", " ")
            .replace("/", " ")
            .replace("+", " ")
            .replace("-", " ")
            .split()
            if token.isidentifier() and token != "pi"
        }
    )
    kind = "symbol" if expression.isidentifier() else "expression"
    return ParameterValue(kind=kind, value=expression, symbols=symbols)


def upgrade_to_v3(circuit: Circuit) -> Circuit:
    operations = [
        operation.model_copy(
            update={
                "typed_params": operation.typed_params
                or [parameter_value(value) for value in operation.params],
                "measurement": operation.measurement
                or (MeasurementSemantics() if operation.gate == "measure" else None),
            }
        )
        for operation in circuit.operations
    ]
    return circuit.model_copy(
        update={
            "ir_version": 3,
            "operations": operations,
            "quantum_registers": circuit.quantum_registers
            or [Register(name="q", size=circuit.qubits, offset=0)],
            "classical_registers": circuit.classical_registers
            or (
                [Register(name="c", size=circuit.classical_bits, offset=0)]
                if circuit.classical_bits
                else []
            ),
        }
    )
