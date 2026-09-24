"""`leona_notebooks.error_hints.hints_for`, one test per entry it exists to answer.

Each error text below is copied verbatim from a real sandbox run (the eval rounds behind
the "Qiskit 2 traps" lane, `/packages/py/notebooks/src/leona_notebooks/error_hints.py`'s
own module docstring names where each entry was probed), not paraphrased — a hint keyed
to a paraphrase can pass this test and still miss the actual exception text.
"""

from __future__ import annotations

from leona_notebooks.error_hints import hints_for


def test_c_if_removed() -> None:
    hints = hints_for("AttributeError", "'InstructionSet' object has no attribute 'c_if'")
    assert any("if_test" in hint for hint in hints)
    assert any("AerSimulator" in hint for hint in hints)
    # The generic InstructionSet hint also applies (its real methods are add, cargs,
    # instructions, inverse and qargs); both being true at once is by design.
    assert any("cargs" in hint for hint in hints)


def test_control_flow_op_names_the_downstream_trap_too() -> None:
    # A repair that already swapped `.c_if` for `if_test` and is now failing one step
    # later, on the SAMPLER rather than the attribute, must still be pointed at
    # AerSimulator -- this is the "trades one failure for the next" case the c_if hint's
    # own docstring probe exists for.
    hints = hints_for("QiskitError", "StatevectorSampler cannot handle ControlFlowOp")
    assert any("AerSimulator" in hint and "if_test" in hint for hint in hints)


def test_databin_meas_without_measure_all() -> None:
    hints = hints_for("AttributeError", "'DataBin' object has no attribute 'meas'")
    assert any('"c"' in hint and "measure_all" in hint for hint in hints)


def test_instructionset_num_qubits() -> None:
    hints = hints_for("AttributeError", "'InstructionSet' object has no attribute 'num_qubits'")
    assert any("qargs" in hint for hint in hints)
    assert any("InstructionSet" in hint for hint in hints)


def test_qftgate_invalid_keyword() -> None:
    hints = hints_for(
        "TypeError", "QFTGate.__init__() got an unexpected keyword argument 'inverse'"
    )
    assert any("num_qubits" in hint and "QFTGate(n).inverse()" in hint for hint in hints)
    assert any("deprecated" in hint for hint in hints)


def test_qft_construction_mismatch_matches_every_observed_wording() -> None:
    # The repair loop's own assertion messages vary notebook to notebook (they are
    # generated text, not a fixed Qiskit exception) -- these three are the distinct
    # wordings the real-model eval rounds actually produced (eval-r1..r3.json).
    wordings = (
        "Expected the hand-built QFT to match QFTGate up to global phase, but max "
        "difference was 4.90e-01",
        "The constructed QFT circuit does not match Qiskit's QFTGate.",
        "Expected the QFT circuits to match within 1e-10, but got max_diff = 4.90e-01",
        "The unitaries are not equal up to global phase. Check the controlled phase "
        "angles and the swap block.",
        "The constructed QFT does not match QFTGate up to global phase. Check the "
        "rotation angles and the final SWAP layer.",
    )
    for evalue in wordings:
        hints = hints_for("AssertionError", evalue)
        assert any("reversed(range(n))" in hint for hint in hints), evalue
        assert any("n - 1 - i" in hint for hint in hints), evalue


def test_qft_hint_does_not_fire_on_an_unrelated_assertion() -> None:
    # A false trigger here only adds an irrelevant paragraph to the repair prompt (unlike
    # a lint false positive, which spends a repair on correct code), but the hint's own
    # docstring rule is that it stays keyed to what is actually true -- an assertion with
    # no QFT-shaped wording at all should not pull in a QFT-specific essay.
    assert hints_for("AssertionError", "expected 500 got 300") == ()
    assert (
        hints_for(
            "AssertionError", "Expected the marked state |101> with high probability, got 0.2"
        )
        == ()
    )
