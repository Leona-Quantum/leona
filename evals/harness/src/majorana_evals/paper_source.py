"""Retrieve the full text of an arXiv paper, and refuse to hand over mathematics
that did not survive the retrieval.

WHY THIS IS NOT A "PDF FALLBACK". G1 (docs/gates/G1-results.md §1) recorded that 2
of 12 cited papers could not be read as full text, and concluded a PDF path was
needed. Measured 2026-08-06, that framing is wrong in both directions:

  * `2305.04908` never needed a PDF. Its arXiv e-print IS a LaTeX tarball, so the
    paper that defeated ar5iv's HTML converter is fully readable from source, with
    the mathematics arriving as literal `\\sqrt{N}` rather than as glyphs.

  * For `quant-ph/9605043` (Grover) a PDF is retrievable and is WORSE THAN NOTHING.
    The e-print is 1996 FrameMaker PostScript, so there is no LaTeX path, and the
    PDF's fonts carry no ToUnicode CMap. Three independent extractors — poppler,
    pdfminer and PyMuPDF — produce ZERO U+221A characters in the whole document,
    while the other mathematical glyphs it uses survive. The abstract's "in only
    O(sqrt(N)) steps" extracts as "O ( N )". Handing that to an extraction prompt
    asserts that Grover's algorithm has no quantum speedup — turning a correct
    refusal on the complexity field into a confident, sourced-looking miss.

So the order is by MATH FIDELITY, not by availability:

    e-print LaTeX  ->  ar5iv HTML  ->  PDF text

and the arXiv API abstract is fetched every time, as an independent witness of what
the paper's mathematics is supposed to contain. A document that carries
complexity-shaped tokens but no radical anywhere, while the abstract for the same id
does carry one, is `MATH_UNRELIABLE` and the fields that read mathematics are forced
to refuse. An honest refusal beats a confident fill — the same rule as the block
repository's "a block may ship with a hole; it may never ship with a guess in the
hole" (leona-block-repository-roadmap.md §3.6).

The network layer here is deliberately thin and untested in CI. The guard is pure
and is tested, because the guard is the part that decides what reaches a model.
"""

from __future__ import annotations

import gzip
import io
import re
import tarfile
from dataclasses import dataclass, field
from typing import Literal
from xml.etree import ElementTree

__all__ = [
    "MATH_READING_FIELDS",
    "MathIntegrity",
    "PaperText",
    "SourceKind",
    "assess_math_integrity",
    "fetch_paper",
    "latex_from_eprint",
    "text_from_ar5iv_html",
    "text_from_pdf_bytes",
]

SourceKind = Literal["latex", "ar5iv", "pdf"]
MathVerdict = Literal["reliable", "unreliable", "unchecked"]

EPRINT_URL = "https://export.arxiv.org/e-print/{arxiv_id}"
AR5IV_URL = "https://ar5iv.labs.arxiv.org/html/{arxiv_id}"
PDF_URL = "https://arxiv.org/pdf/{arxiv_id}"
# https, not http: the http form of this endpoint returns an empty body.
API_URL = "https://export.arxiv.org/api/query?id_list={arxiv_id}"

# ar5iv serves this instead of a paper body. It is a 200, so it must be detected by
# content or it passes silently as an eight-field paper that "states nothing".
AR5IV_FATAL = "Conversion to HTML had a Fatal error"

# The extraction fields whose answer is read off mathematics, and which are therefore
# the ones a lost radical corrupts. Numbering follows G1-preregistration.md §3.
MATH_READING_FIELDS: tuple[int, ...] = (5, 7, 8)

# Anything that means "there is a root here", in any of the three encodings a
# retrieved document can use.
_RADICAL_MARKERS = ("√", "\\sqrt", "sqrt", "½-power")

# Complexity-shaped tokens. Their presence is what makes a missing radical dangerous
# rather than merely absent: a paper with no asymptotic claim has no asymptotic claim
# to corrupt.
_COMPLEXITY_MARKERS = ("O(", "O (", "Ω(", "Ω (", "Θ(", "Θ (", "\U0001d4aa(", "poly(")

# Mathematical glyphs that are NOT the radical. If these survive extraction and the
# radical does not, the document is not "a paper without maths" — it is a paper whose
# maths was partly destroyed, which is the Grover fingerprint. Evidence, not verdict.
_OTHER_MATH_GLYPHS = "∑≠≡≥≤⋅∆πανφ∫∞⊗"


@dataclass(frozen=True)
class MathIntegrity:
    """Whether the mathematics in a retrieved document can be trusted.

    Three-valued on purpose. `unchecked` is not a synonym for `reliable`: it means
    the independent witness (the arXiv abstract) could not be fetched, so nothing
    contradicts the document and nothing corroborates it either. Both `unreliable`
    and `unchecked` force a refusal, because the failure this guard exists to stop
    is silent and confident.
    """

    verdict: MathVerdict
    reason: str
    radicals_in_text: int
    radicals_in_abstract: int
    complexity_markers: int
    other_math_glyphs: int

    @property
    def trustworthy(self) -> bool:
        return self.verdict == "reliable"

    @property
    def fields_to_refuse(self) -> tuple[int, ...]:
        """Extraction fields that must be forced to NOT_STATED for this document."""
        return () if self.trustworthy else MATH_READING_FIELDS


@dataclass(frozen=True)
class PaperText:
    arxiv_id: str
    text: str
    source_kind: SourceKind
    abstract: str | None
    math: MathIntegrity
    attempts: list[str] = field(default_factory=list)

    @property
    def math_reliable(self) -> bool:
        return self.math.trustworthy


def _count_any(haystack: str, needles) -> int:
    lowered = haystack.lower()
    return sum(lowered.count(n.lower()) for n in needles)


def assess_math_integrity(
    text: str,
    abstract: str | None,
    *,
    source_kind: SourceKind,
) -> MathIntegrity:
    """Decide whether `text` can be trusted to carry the paper's mathematics.

    Pure. No network. This is the load-bearing function in the module: everything
    else moves bytes around, and this is what stands between a broken glyph map and
    a confident wrong answer.
    """
    radicals = _count_any(text, _RADICAL_MARKERS)
    abstract_radicals = _count_any(abstract or "", _RADICAL_MARKERS)
    complexity = _count_any(text, _COMPLEXITY_MARKERS)
    other_glyphs = sum(text.count(g) for g in _OTHER_MATH_GLYPHS)

    def verdict(v: MathVerdict, reason: str) -> MathIntegrity:
        return MathIntegrity(
            verdict=v,
            reason=reason,
            radicals_in_text=radicals,
            radicals_in_abstract=abstract_radicals,
            complexity_markers=complexity,
            other_math_glyphs=other_glyphs,
        )

    # LaTeX source is the paper's own markup. A radical is `\sqrt{...}` and cannot be
    # lost to a font mapping, because there is no font.
    if source_kind == "latex":
        return verdict("reliable", "LaTeX source: mathematics is markup, not glyphs")

    if radicals:
        return verdict("reliable", f"{radicals} radical marker(s) survived extraction")

    # No witness. Nothing contradicts the document and nothing corroborates it, so it
    # is `unchecked` rather than clean — including when it looks maths-free, because
    # "this paper has no mathematics" and "the mathematics was deleted" are the same
    # document without something to compare against.
    if abstract is None:
        return verdict(
            "unchecked",
            "no radical in the text and the arXiv abstract could not be fetched to "
            "cross-check — treated as unusable rather than as clean",
        )

    abstract_complexity = _count_any(abstract, _COMPLEXITY_MARKERS)

    # The narrow failure: the radical specifically was lost. Poppler's shape on the
    # 1996 Grover PDF — "O(√N)" comes out as "O ( N )", so the asymptotic claim is
    # still visibly there and reads as the wrong bound.
    if abstract_radicals and complexity:
        detail = (
            f"the arXiv abstract carries {abstract_radicals} radical marker(s) and the "
            f"extracted text carries none, across {complexity} complexity-shaped token(s) "
            "— the bound survived and its root did not"
        )
        if other_glyphs:
            detail += (
                f"; {other_glyphs} other mathematical glyph(s) DID survive, so this is a "
                "partly-destroyed glyph map rather than a paper without mathematics"
            )
        return verdict("unreliable", detail)

    # The wider failure, and the one measured against the real paper: the mathematics
    # is not corrupted, it is GONE. pypdf on the same Grover PDF leaves grammatically
    # intact prose with holes — "with a probability of , any classical algorithm …
    # will need to look at a minimum of  names" — so there is no complexity token left
    # to notice. The witness is what catches it: the abstract states mathematics the
    # document does not contain anywhere.
    if (abstract_radicals or abstract_complexity) and not (radicals or complexity):
        return verdict(
            "unreliable",
            f"the arXiv abstract states mathematics ({abstract_radicals} radical, "
            f"{abstract_complexity} complexity marker(s)) that appears nowhere in the "
            f"extracted text, which carries {other_glyphs} other mathematical glyph(s) "
            "— the extraction dropped the mathematics rather than mangling it",
        )

    return verdict(
        "reliable",
        "no radical in the text, and the abstract states none either — the two sources agree",
    )


def latex_from_eprint(payload: bytes) -> str | None:
    """Concatenate the `.tex` files out of an arXiv e-print payload.

    The payload is gzip; underneath it is usually a tar of the submission, and
    occasionally a single bare `.tex`. Returns None when it is neither — a 1996
    PostScript submission lands here, and returning None is what sends the caller
    down to the PDF path with the guard armed.
    """
    try:
        raw = gzip.decompress(payload)
    except (OSError, EOFError):
        raw = payload

    try:
        with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
            members = [m for m in archive.getmembers() if m.isfile() and m.name.endswith(".tex")]
            if not members:
                return None
            # Deterministic order: the same submission must produce the same text on
            # every run, or two extractions of one paper are not comparable.
            members.sort(key=lambda m: m.name)
            parts = []
            for member in members:
                handle = archive.extractfile(member)
                if handle is None:
                    continue
                parts.append(handle.read().decode("utf-8", errors="replace"))
            return "\n\n".join(parts) or None
    except tarfile.TarError:
        pass

    decoded = raw.decode("utf-8", errors="replace")
    return decoded if "\\documentclass" in decoded or "\\begin{document}" in decoded else None


_TAG = re.compile(r"<[^>]+>")
_SCRIPT_OR_STYLE = re.compile(r"<(script|style)\b.*?</\1>", re.DOTALL | re.IGNORECASE)
_WHITESPACE = re.compile(r"[ \t]*\n[ \t]*")


def text_from_ar5iv_html(html: str) -> str | None:
    """Strip ar5iv HTML to text, or None if ar5iv served its own failure page."""
    if AR5IV_FATAL in html:
        return None
    body = _SCRIPT_OR_STYLE.sub(" ", html)
    body = _TAG.sub(" ", body)
    body = (
        body.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#8730;", "√")
        .replace("&radic;", "√")
    )
    body = _WHITESPACE.sub("\n", body)
    body = re.sub(r"[ \t]{2,}", " ", body)
    return body.strip() or None


def text_from_pdf_bytes(payload: bytes) -> str:
    """Extract the PDF's text layer.

    `pypdf` rather than PyMuPDF: PyMuPDF is AGPL, and every engine tested loses the
    same glyphs, so the choice is licence and install weight rather than quality.
    Imported lazily and declared as the `pdf` extra, because the LaTeX and ar5iv
    paths — which is most papers — need no PDF library at all.
    """
    try:
        from pypdf import PdfReader
    except ModuleNotFoundError as exc:  # pragma: no cover - depends on the extra
        raise ModuleNotFoundError(
            "PDF extraction needs the `pdf` extra: uv sync --package majorana-evals --extra pdf"
        ) from exc

    reader = PdfReader(io.BytesIO(payload))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages)


def abstract_from_api(xml: str) -> str | None:
    """Pull `<summary>` out of an arXiv API response."""
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError:
        return None
    for summary in root.iter("{http://www.w3.org/2005/Atom}summary"):
        if summary.text:
            return summary.text.strip()
    return None


def fetch_paper(arxiv_id: str, *, timeout: float = 30.0, allow_pdf: bool = True) -> PaperText:
    """Resolve one arXiv id to text, best mathematical fidelity first.

    Network-facing and not exercised in CI. Every step it takes is recorded in
    `attempts`, so a paper that came back thin can be told apart from a paper that
    is thin — the distinction G1 §1 had to make by hand.
    """
    import httpx

    attempts: list[str] = []

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:

        def get(url: str, *, follow_redirects: bool = True) -> httpx.Response | None:
            try:
                response = client.get(url, follow_redirects=follow_redirects)
            except httpx.HTTPError as exc:
                attempts.append(f"{url} -> transport error: {exc.__class__.__name__}")
                return None
            attempts.append(f"{url} -> {response.status_code}")
            return response if response.status_code == 200 else None

        # Fetched first and always: it is the independent witness the guard needs,
        # and fetching it only on failure would mean the guard is armed only when
        # something else already went wrong.
        api = get(API_URL.format(arxiv_id=arxiv_id))
        abstract = abstract_from_api(api.text) if api is not None else None

        eprint = get(EPRINT_URL.format(arxiv_id=arxiv_id))
        if eprint is not None:
            latex = latex_from_eprint(eprint.content)
            if latex:
                attempts.append("e-print: LaTeX source found")
                return PaperText(
                    arxiv_id=arxiv_id,
                    text=latex,
                    source_kind="latex",
                    abstract=abstract,
                    math=assess_math_integrity(latex, abstract, source_kind="latex"),
                    attempts=attempts,
                )
            attempts.append("e-print: no .tex in payload (pre-LaTeX submission or PDF-only)")

        # NOT followed. ar5iv answers an id it has no HTML for with a 307 back to the
        # arXiv *abstract page* — a 200, full of text, and not the paper. Following it
        # produces a document that looks like a paper stating almost nothing, which is
        # the retrieval being silent wearing the costume of the paper being silent
        # (G1-results.md §1). A redirect off ar5iv means "no ar5iv HTML", full stop.
        ar5iv = get(AR5IV_URL.format(arxiv_id=arxiv_id), follow_redirects=False)
        if ar5iv is not None:
            body = text_from_ar5iv_html(ar5iv.text)
            if body:
                return PaperText(
                    arxiv_id=arxiv_id,
                    text=body,
                    source_kind="ar5iv",
                    abstract=abstract,
                    math=assess_math_integrity(body, abstract, source_kind="ar5iv"),
                    attempts=attempts,
                )
            attempts.append(f"ar5iv: {AR5IV_FATAL!r} — no paper body")

        if not allow_pdf:
            raise PaperUnavailable(arxiv_id, attempts)

        pdf = get(PDF_URL.format(arxiv_id=arxiv_id))
        if pdf is None:
            raise PaperUnavailable(arxiv_id, attempts)

        body = text_from_pdf_bytes(pdf.content)
        return PaperText(
            arxiv_id=arxiv_id,
            text=body,
            source_kind="pdf",
            abstract=abstract,
            math=assess_math_integrity(body, abstract, source_kind="pdf"),
            attempts=attempts,
        )


class PaperUnavailable(RuntimeError):
    def __init__(self, arxiv_id: str, attempts: list[str]) -> None:
        super().__init__(f"no readable source for {arxiv_id}: " + "; ".join(attempts))
        self.arxiv_id = arxiv_id
        self.attempts = attempts
