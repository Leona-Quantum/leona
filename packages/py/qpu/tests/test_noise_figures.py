"""The published error figures behind Studio's pre-run noise estimate.

Two kinds of check. Coverage: every device on the rate card says what its
vendor published, including "nothing" and "not a gate device", so a device
added later without looking its figures up fails here instead of shipping a
preview with no provenance. Transcription: each stored value agrees with the
figure as the page printed it (`published_as`), so a slip between reading the
page and typing the number is caught by arithmetic, not by eye.
"""

import datetime as dt
import re

import pytest

from majorana_qpu import (
    ErrorStatistic,
    PublishedErrorFigure,
    backend_info,
    list_backends,
)


def _figures(backend):
    noise = backend.published_noise
    assert noise is not None
    for profile in noise.profiles:
        for field in ("one_qubit_gate_error", "two_qubit_gate_error", "readout_error"):
            figure = getattr(profile, field)
            if figure is not None:
                yield profile.machine, field, figure


def test_every_rate_card_device_records_its_published_noise():
    for backend in list_backends():
        noise = backend.published_noise
        assert noise is not None, f"{backend.device_id} has no published_noise entry"
        if noise.gate_model:
            assert noise.profiles, f"{backend.device_id}: a gate device needs at least one profile"
            assert any(profile.two_qubit_gate_error is not None for profile in noise.profiles), (
                f"{backend.device_id}: no two-qubit figure at all"
            )
        else:
            assert not noise.profiles, "a device that runs no gates has no gate-error profile"


def test_every_figure_names_an_https_source_and_a_real_date():
    for backend in list_backends():
        for machine, field, figure in _figures(backend):
            assert figure.source_url.startswith("https://"), (machine, field)
            dt.date.fromisoformat(figure.read_on)
            assert 0 < figure.value < 1, (machine, field, figure.value)


def _printed_error(figure: PublishedErrorFigure) -> float:
    """The error probability the page's own text states, parsed from
    `published_as`: a fidelity percentage, an error percentage, an
    `(a +/- b)E-n` form with a comma decimal (AQT), or a bare decimal (IBM's
    page data)."""
    text = figure.published_as
    exponent = re.search(r"\(\s*([0-9]+[.,][0-9]+)\s*\+/-\s*[0-9.,]+\s*\)\s*E(-?[0-9]+)", text)
    if exponent:
        return float(exponent.group(1).replace(",", ".")) * 10 ** int(exponent.group(2))
    percent = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*%", text)
    if percent:
        share = float(percent.group(1)) / 100
        return 1 - share if "fidelity" in text.lower() or share > 0.5 else share
    bare = re.search(r"\b(0\.[0-9]+)\b", text)
    assert bare, f"cannot read a number out of {text!r}"
    return float(bare.group(1))


def test_each_value_matches_the_figure_as_printed():
    checked = 0
    for backend in list_backends():
        for machine, field, figure in _figures(backend):
            assert _printed_error(figure) == pytest.approx(figure.value, rel=1e-9, abs=1e-12), (
                machine,
                field,
                figure.published_as,
                figure.value,
            )
            checked += 1
    # A parser that silently matched nothing would pass the loop above with
    # zero iterations; the count is the positive control.
    assert checked == 25


def test_the_printed_form_parser_can_fail():
    # Negative control for the transcription check: a fidelity typed as if it
    # were an error must disagree.
    wrong = PublishedErrorFigure(
        value=0.9951,
        statistic=ErrorStatistic.MEDIAN,
        published_as="median 2-qubit gate fidelity of 99.51%",
        source_url="https://example.invalid/",
        read_on="2026-09-22",
    )
    assert _printed_error(wrong) != pytest.approx(wrong.value)


def test_ibm_open_plan_lists_every_candidate_machine_because_ibm_picks_at_submit():
    noise = backend_info("ibm.open_plan").published_noise
    assert noise is not None and noise.gate_model
    assert noise.machine_chosen_at_submit
    assert len(noise.profiles) == 7
    for profile in noise.profiles:
        # IBM's public listing has no one-qubit figure; it must stay absent,
        # not be filled with a typical value.
        assert profile.one_qubit_gate_error is None
        assert profile.two_qubit_gate_error is not None
        assert profile.readout_error is not None
        assert profile.two_qubit_gate_error.statistic is ErrorStatistic.MEDIAN


def test_single_machine_devices_do_not_claim_a_submit_time_choice():
    for backend in list_backends():
        noise = backend.published_noise
        assert noise is not None
        if backend.device_id != "ibm.open_plan":
            assert not noise.machine_chosen_at_submit, backend.device_id
            assert len(noise.profiles) <= 1, backend.device_id


def test_aquila_is_not_a_gate_device():
    noise = backend_info("braket.quera.aquila").published_noise
    assert noise is not None
    assert noise.gate_model is False


def test_published_noise_serialises_through_the_backends_payload():
    payload = backend_info("braket.ionq.forte").model_dump(mode="json")
    profile = payload["published_noise"]["profiles"][0]
    assert profile["two_qubit_gate_error"]["value"] == pytest.approx(4e-3)
    assert profile["two_qubit_gate_error"]["statistic"] == "stated"
    assert profile["readout_error"]["published_as"] == "0.5% SPAM error"
