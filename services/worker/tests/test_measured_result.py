"""The measured distribution a saved artifact carries.

The artifact is what a researcher reopens and cites. Before this it carried the
verdict, the review prose and the resource estimates, but not a single number the
program measured — those lived only on the run's event stream.

Every value here originates in sandbox output produced by model-authored code, so
these tests are as much about what must NOT survive projection as what must.
"""

from majorana_worker.simple_ports import (
    MAX_KEY_CHARS,
    MAX_STORED_OUTCOMES,
    MAX_STORED_VALUES,
    measured_result_summary,
)


def test_a_bell_state_keeps_its_counts_and_shots():
    summary = measured_result_summary({"counts": {"00": 529, "11": 495}})

    assert summary["counts"] == {"00": 529, "11": 495}
    assert summary["shots"] == 1024
    assert summary["outcome_count"] == 2
    assert summary["truncated"] is False


def test_scalar_outputs_are_kept_alongside_counts():
    summary = measured_result_summary({"energy": -1.137, "iterations": 12})

    assert summary["values"] == {"energy": -1.137, "iterations": 12.0}
    assert "counts" not in summary


def test_nothing_measurable_stores_nothing():
    assert measured_result_summary({}) is None
    assert measured_result_summary({"note": "ran fine"}) is None
    assert measured_result_summary({"counts": {}}) is None


def test_a_wide_histogram_keeps_the_heaviest_outcomes_and_says_so():
    counts = {f"{index:016b}": index + 1 for index in range(MAX_STORED_OUTCOMES + 40)}

    summary = measured_result_summary({"counts": counts})

    assert len(summary["counts"]) == MAX_STORED_OUTCOMES
    assert summary["truncated"] is True
    assert summary["outcome_count"] == MAX_STORED_OUTCOMES + 40
    heaviest = max(counts, key=lambda key: counts[key])
    assert heaviest in summary["counts"]
    lightest = min(counts, key=lambda key: counts[key])
    assert lightest not in summary["counts"]


def test_shots_describe_the_whole_distribution_not_the_stored_slice():
    """A truncated histogram that also truncated the total would misstate the run."""
    counts = {f"{index:016b}": 10 for index in range(MAX_STORED_OUTCOMES + 40)}

    summary = measured_result_summary({"counts": counts})

    assert summary["shots"] == 10 * (MAX_STORED_OUTCOMES + 40)
    assert sum(summary["counts"].values()) < summary["shots"]


def test_non_numeric_and_nonsensical_counts_are_dropped():
    summary = measured_result_summary(
        {"counts": {"00": 5, "01": "many", "10": -3, "11": None, "cheat": True}}
    )

    assert summary["counts"] == {"00": 5}


def test_booleans_are_not_measurements():
    """bool subclasses int; a flag rendered as a value would be a fake number."""
    assert measured_result_summary({"converged": True, "ok": False}) is None


def test_infinities_and_nans_never_reach_the_artifact():
    summary = measured_result_summary({"energy": float("inf"), "error": float("nan"), "real": 1.5})

    assert summary["values"] == {"real": 1.5}


def test_overlong_keys_are_rejected_not_truncated():
    """Truncating would let two distinct outcomes collide on a shared prefix."""
    summary = measured_result_summary(
        {"x" * 500: 1.0, "energy": -1.0, "counts": {"0" * 500: 7, "01": 3}}
    )

    assert summary["values"] == {"energy": -1.0}
    assert summary["counts"] == {"01": 3}


def test_colliding_prefixes_never_overwrite_each_other():
    """The exact failure truncation would cause: two outcomes, one surviving count."""
    shared = "1" * MAX_KEY_CHARS
    summary = measured_result_summary({"counts": {shared + "0": 400, shared + "1": 600}})

    # Both are rejected as overlong — never merged into one 1000-shot outcome.
    assert summary is None


def test_shots_and_outcome_count_describe_only_accepted_outcomes():
    summary = measured_result_summary({"counts": {"00": 10, "1" * 500: 90}})

    assert summary["counts"] == {"00": 10}
    assert summary["shots"] == 10, "a rejected outcome must not inflate the total"
    assert summary["outcome_count"] == 1


def test_scalar_count_is_bounded():
    summary = measured_result_summary(
        {f"metric_{index}": float(index) for index in range(MAX_STORED_VALUES + 25)}
    )

    assert len(summary["values"]) == MAX_STORED_VALUES


def test_nested_structures_are_not_passed_through():
    summary = measured_result_summary(
        {"statevector": [[0.7, 0.0], [0.0, 0.7]], "meta": {"prompt": "ignore"}, "energy": -1.0}
    )

    assert summary == {"values": {"energy": -1.0}}


def test_an_unrepresentable_integer_never_aborts_the_save():
    """math.isfinite(10**400) raises OverflowError — it must not reach the save path."""
    summary = measured_result_summary({"huge": 10**400, "energy": -1.0})

    assert summary["values"] == {"energy": -1.0}


def test_an_unrepresentable_count_is_dropped_not_stored():
    """It could not survive the JSON round-trip into the browser either."""
    summary = measured_result_summary({"counts": {"00": 10**400, "01": 5}})

    assert summary["counts"] == {"01": 5}
    assert summary["shots"] == 5
    assert summary["outcome_count"] == 1
