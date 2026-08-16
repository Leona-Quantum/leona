"""The guard is the thing under test.

Everything network-facing in `paper_source` moves bytes; `assess_math_integrity` is
what decides whether a document reaches a model, so it is what is pinned here.

The fixtures are synthetic and reproduce the measured failure rather than embedding
the papers themselves. The real-paper claim is pinned separately by
`test_live_grover_pdf_is_math_unreliable`, which needs the network and the `pdf`
extra and is skipped unless MAJORANA_RUN_LIVE_PAPERS=1 — the same shape as the
repo's other `*_live` tests. Committing a third party's paper into this repo to
assert a fact about font maps is not a trade worth making.
"""

from __future__ import annotations

import gzip
import io
import os
import tarfile

import pytest

from majorana_evals.paper_source import (
    MATH_READING_FIELDS,
    abstract_from_api,
    assess_math_integrity,
    latex_from_eprint,
    text_from_ar5iv_html,
)

# Reproduces what poppler, pdfminer and PyMuPDF all produce from the 1996 Grover
# PDF: the radical is gone from an asymptotic claim, and the OTHER mathematical
# glyphs survive. That second half is what makes it a broken glyph map rather than
# a paper without mathematics.
GROVER_PDF_TEXT_SHAPE = """
A fast quantum mechanical algorithm for database search

An unsorted database of N items is searched. Classically this needs O ( N )
steps. The quantum mechanical algorithm presented here needs O ( N ) steps.

The state is ∑ ai |Si⟩ with ∆ the diffusion transform, π/2 rotations, and the
condition ≥ 1/2 on the amplitude. Note α ≠ ν throughout.
"""

# The same claim as arXiv's own metadata carries it.
GROVER_ABSTRACT = (
    "An unsorted database with N records requires O(sqrt(N)) quantum mechanical steps, "
    "which is a quadratic improvement on the classical O(N)."
)

MODERN_PDF_TEXT = """
Tight bounds for quantum phase estimation. We show a lower bound of Ω(1/ε) and an
upper bound of O(√(N) log N) for the number of queries required.
"""

MODERN_ABSTRACT = "We give tight bounds, showing Θ(sqrt(N)) queries suffice."


def test_lost_radical_with_a_witness_is_unreliable():
    verdict = assess_math_integrity(GROVER_PDF_TEXT_SHAPE, GROVER_ABSTRACT, source_kind="pdf")
    assert verdict.verdict == "unreliable"
    assert not verdict.trustworthy
    assert verdict.radicals_in_text == 0
    assert verdict.radicals_in_abstract >= 1
    assert verdict.complexity_markers >= 1
    # The distinguishing evidence: other maths came through.
    assert verdict.other_math_glyphs >= 5
    assert "partly-destroyed glyph map" in verdict.reason


def test_an_unreliable_document_refuses_exactly_the_math_reading_fields():
    verdict = assess_math_integrity(GROVER_PDF_TEXT_SHAPE, GROVER_ABSTRACT, source_kind="pdf")
    assert verdict.fields_to_refuse == MATH_READING_FIELDS == (5, 7, 8)


def test_surviving_radical_is_reliable():
    verdict = assess_math_integrity(MODERN_PDF_TEXT, MODERN_ABSTRACT, source_kind="pdf")
    assert verdict.verdict == "reliable"
    assert verdict.fields_to_refuse == ()


def test_latex_source_is_reliable_even_with_no_glyph():
    # `\\sqrt{N}` is markup. There is no font to lose it to — and the counter proves
    # the point: this text contains the marker as source, not as a character.
    latex = r"The algorithm runs in $O(\sqrt{N})$ time."
    verdict = assess_math_integrity(latex, None, source_kind="latex")
    assert verdict.verdict == "reliable"
    assert "markup" in verdict.reason


def test_latex_is_reliable_even_when_the_abstract_is_unavailable():
    verdict = assess_math_integrity("no maths here at all", None, source_kind="latex")
    assert verdict.verdict == "reliable"


def test_no_maths_in_either_source_is_reliable():
    verdict = assess_math_integrity(
        "We prepared a Bell state on two qubits and measured it.",
        "We prepared a Bell state.",
        source_kind="pdf",
    )
    assert verdict.verdict == "reliable"
    assert "the two sources agree" in verdict.reason


# What pypdf actually produces from the 1996 Grover PDF: the mathematics is not
# mangled, it is DELETED, and the prose closes over the hole. There is no complexity
# token left to notice — which is why the guard cannot key on one.
GROVER_PDF_TEXT_DELETED = """
Summary
Imagine a phone directory containing N names arranged in completely random order.
In order to find someone's phone number with a probability of , any classical
algorithm (whether deterministic or probabilistic) will need to look at a minimum
of  names. Quantum mechanical systems can be in a superposition of states.

The transform ∑ over ∆ with π/2 phases, α ≠ ν, and ≥ amplitude.
"""


def test_deleted_mathematics_is_caught_by_the_witness_not_by_a_token():
    """The failure the module was built for, in the shape the real extractor produces.

    A detector keyed on "has a complexity token but no radical" returns RELIABLE here
    and hands a model a paper whose central claim has been silently removed.
    """
    verdict = assess_math_integrity(GROVER_PDF_TEXT_DELETED, GROVER_ABSTRACT, source_kind="pdf")
    assert verdict.verdict == "unreliable", verdict
    assert verdict.complexity_markers == 0, "there is no token to key on — that is the point"
    assert verdict.other_math_glyphs >= 5
    assert "dropped the mathematics" in verdict.reason
    assert verdict.fields_to_refuse == MATH_READING_FIELDS


def test_missing_witness_is_unchecked_and_still_refuses():
    """`unchecked` must not collapse into `reliable`.

    If the abstract could not be fetched there is no independent witness, so the
    document is neither corroborated nor contradicted. It still refuses, because the
    failure mode this guard exists for is silent and confident.
    """
    verdict = assess_math_integrity(GROVER_PDF_TEXT_SHAPE, None, source_kind="pdf")
    assert verdict.verdict == "unchecked"
    assert not verdict.trustworthy
    assert verdict.fields_to_refuse == MATH_READING_FIELDS


def test_agreeing_sources_with_no_radical_are_reliable():
    """A paper that genuinely has no root must not be flagged.

    Without this the guard would refuse the complexity field on every asymptotic
    paper whose bounds happen to be linear or logarithmic — a false positive rate
    that would get the guard switched off.
    """
    text = "The circuit uses O(n log n) gates and O(n) qubits."
    verdict = assess_math_integrity(text, "We give an O(n log n) construction.", source_kind="pdf")
    assert verdict.verdict == "reliable"
    assert "the two sources agree" in verdict.reason


def _tarball(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name, body in files.items():
            payload = body.encode()
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
    return gzip.compress(buffer.getvalue())


def test_eprint_tarball_yields_concatenated_tex_in_a_stable_order():
    payload = _tarball(
        {
            "b.tex": r"\section{Second}",
            "a.tex": r"\section{First}",
            "figure.pdf": "not tex",
        }
    )
    text = latex_from_eprint(payload)
    assert text is not None
    assert text.index("First") < text.index("Second"), "order must be deterministic"
    assert "not tex" not in text


def test_eprint_bare_tex_is_accepted():
    payload = gzip.compress(rb"\documentclass{article}\begin{document}hi\end{document}")
    assert latex_from_eprint(payload) is not None


def test_eprint_postscript_submission_yields_none():
    """A 1996 FrameMaker submission has no .tex. Returning None is what sends the
    caller to the PDF path *with the guard armed*, which is the whole point."""
    payload = _tarball({"database.mod.ps": "%!PS-Adobe-2.0"})
    assert latex_from_eprint(payload) is None


def test_ar5iv_fatal_error_page_is_not_a_paper():
    html = (
        "<html><body><p>Conversion to HTML had a Fatal error and exited abruptly</p></body></html>"
    )
    assert text_from_ar5iv_html(html) is None


def test_ar5iv_html_keeps_the_radical_entity():
    html = "<html><body><p>runs in O(&#8730;N) time</p><script>x=1</script></body></html>"
    text = text_from_ar5iv_html(html)
    assert text is not None
    assert "√" in text
    assert "x=1" not in text


def test_api_summary_is_read():
    xml = (
        '<feed xmlns="http://www.w3.org/2005/Atom"><entry>'
        "<summary>O(sqrt(N)) steps</summary></entry></feed>"
    )
    assert abstract_from_api(xml) == "O(sqrt(N)) steps"


def test_api_garbage_does_not_raise():
    assert abstract_from_api("<not xml") is None


# --- live, opt-in -----------------------------------------------------------

requires_live_papers = pytest.mark.skipif(
    os.getenv("MAJORANA_RUN_LIVE_PAPERS") != "1",
    reason="set MAJORANA_RUN_LIVE_PAPERS=1 (needs network and the `pdf` extra)",
)


@requires_live_papers
def test_live_grover_pdf_is_math_unreliable():
    """The claim the whole module exists for, against the real paper."""
    from majorana_evals.paper_source import fetch_paper

    paper = fetch_paper("quant-ph/9605043")
    assert paper.source_kind == "pdf", paper.attempts
    assert paper.math.verdict == "unreliable", paper.math
    assert paper.math.radicals_in_text == 0


@requires_live_papers
def test_live_phase_estimation_resolves_to_latex_not_pdf():
    """The paper G1 recorded as unreadable. It needs no PDF at all."""
    from majorana_evals.paper_source import fetch_paper

    paper = fetch_paper("2305.04908")
    assert paper.source_kind == "latex", paper.attempts
    assert paper.math.trustworthy


def test_abstract_from_api_returns_none_for_a_document_defusedxml_refuses() -> None:
    """A refusal must look like a failed fetch, not like an exception.

    `DefusedXmlException` is not a subclass of `ParseError`, so the original
    `except ElementTree.ParseError` did not catch it and a hostile body raised
    straight out of this function. That matters more than it looks: the abstract
    is the independent witness `assess_math_integrity` cross-checks the document
    against, and its contract is that an abstract which could not be fetched
    returns None so the verdict degrades to `unchecked`. An escaping exception
    takes the whole retrieval down instead of degrading it.
    """
    bomb = """<?xml version="1.0"?>
<!DOCTYPE feed [
  <!ENTITY a "AAAAAAAAAA">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
]>
<feed xmlns="http://www.w3.org/2005/Atom"><entry><summary>&b;</summary></entry></feed>"""
    assert abstract_from_api(bomb) is None

    with_dtd = """<?xml version="1.0"?>
<!DOCTYPE feed SYSTEM "feed.dtd">
<feed xmlns="http://www.w3.org/2005/Atom"></feed>"""
    assert abstract_from_api(with_dtd) is None
