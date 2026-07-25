from majorana_vqe.circuit import build_canonical_h2_double_excitation


EXPECTED_CIRCUIT_SHA256 = "f4fdb1ac3f041185fff63f6a7acb9d3ab1e9742131ed5bd3bb9ba2d99081a58c"
EXPECTED_PROTOCOL_SHA256 = "778fe0c7f3d361c54e9c41a0240ef31cc7926dacbe8fbc33ff96a57ee104393c"


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
