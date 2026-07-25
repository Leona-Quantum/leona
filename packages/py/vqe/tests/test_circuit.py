from majorana_vqe.circuit import build_canonical_h2_double_excitation


EXPECTED_CIRCUIT_SHA256 = "a95f4a8e8749e361c85df00b9bf42d9cea407a048840bc8e58f7e5c9920be3b1"
EXPECTED_PROTOCOL_SHA256 = "4e949fdc81f6e4c0416b95eee2bb71d521216db8705bcd948320ddd83ae52acb"


def test_canonical_h2_circuit_is_deterministic() -> None:
    first = build_canonical_h2_double_excitation()
    second = build_canonical_h2_double_excitation()

    assert first == second
    assert first.canonical_circuit_sha256 == EXPECTED_CIRCUIT_SHA256
    assert first.compilation_protocol_sha256 == EXPECTED_PROTOCOL_SHA256


def test_canonical_h2_resource_protocol_is_explicit() -> None:
    circuit = build_canonical_h2_double_excitation()

    assert circuit.common_basis_metrics.model_dump() == {
        "depth": 83,
        "gate_count": 152,
        "cnot_count": 48,
        "parameter_count": 1,
    }
    assert circuit.compilation_protocol.allowed_primary_stages == [
        "canonical_logical",
        "common_basis_compiled",
    ]
    assert circuit.compilation_protocol.diagnostic_stage == "provider_native_diagnostic"


def test_generator_and_rotation_sign_conventions_are_locked() -> None:
    circuit = build_canonical_h2_double_excitation()

    assert [
        (
            rotation.pauli_qubit0_first,
            rotation.generator_imaginary_coefficient_numerator,
            rotation.rz_angle_theta_numerator,
        )
        for rotation in circuit.logical_rotations
    ] == [
        ("XXXY", -1, 1),
        ("XXYX", 1, -1),
        ("XYXX", -1, 1),
        ("XYYY", -1, 1),
        ("YXXX", 1, -1),
        ("YXYY", 1, -1),
        ("YYXY", -1, 1),
        ("YYYX", 1, -1),
    ]
