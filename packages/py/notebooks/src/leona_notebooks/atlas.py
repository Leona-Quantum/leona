"""Seed a notebook from an Atlas record.

An Atlas record (`GET /v1/catalog/entries/{slug}`) carries what a walkthrough needs:
`codeVariants` (complete scripts ending in `FINAL_CIRCUIT = qc` or binding `RESULT`),
`explanationMd` (real Markdown with KaTeX), `literature` (title/authors/year/url) and
`title`. This module turns one into seed material the outline and draft prompts quote,
plus the verbatim `role=run` cell a walkthrough must start from.

Two prose conventions coexist in the corpus and this file keeps them apart:
`explanationMd` is Markdown and passes through; layer-graph fields (`cost`, `conditions`,
`hops[].theory`) are NOT Markdown — `$…$` is maths and every other character is
literal, so `corpus_prose_to_markdown` escapes rather than interprets them.
"""

from __future__ import annotations

import re
from typing import Any

from leona_notebooks.spec import Reference, Seed

_TOKEN = re.compile(
    r"\[\[(?P<mark>approximation|assumption):\s*(?P<body>[^\]]*)\]\]|(?P<math>\$[^$\n]+\$)"
)


def corpus_prose_to_markdown(text: str) -> str:
    """Escape corpus prose so Markdown renders it as the corpus meant it: `$…$` kept as
    maths, `|`, `_`, `*`, `` ` `` and `\\` escaped outside maths, theory marks shown as
    bold callouts (their bodies converted the same way)."""
    out: list[str] = []
    position = 0
    for match in _TOKEN.finditer(text):
        out.append(_escape_markdown(text[position : match.start()]))
        if match.group("math"):
            out.append(match.group("math"))
        else:
            out.append(
                f"**{match.group('mark')}:** {corpus_prose_to_markdown(match.group('body').strip())}"
            )
        position = match.end()
    out.append(_escape_markdown(text[position:]))
    return "".join(out)


def _escape_markdown(fragment: str) -> str:
    return re.sub(r"([\\`*_|<>\[\]#])", r"\\\1", fragment)


def _pick_variant(record: dict[str, Any], framework: str) -> dict[str, Any] | None:
    variants = list(record.get("codeVariants") or [])
    for extra in record.get("extraVariants") or []:
        variants.append(extra)
    wanted = framework.lower()
    for variant in variants:
        name = str(variant.get("framework") or "").lower()
        if wanted in name:
            return variant
    return variants[0] if variants else None


def _run_cell_source(code: str) -> str:
    """The record's script, followed by the lines that show its result. A circuit-shaped
    record binds `FINAL_CIRCUIT`; an operator/state record binds `RESULT`."""
    body = code.rstrip() + "\n"
    if "FINAL_CIRCUIT" in body:
        body += "\nprint(FINAL_CIRCUIT.draw('text'))\n"
    if "RESULT" in body:
        body += "\nRESULT\n"
    return body


def seed_from_record(
    record: dict[str, Any], *, framework: str = "qiskit"
) -> tuple[Seed, str, str, list[Reference]]:
    """Returns (seed, seed_material_text, verbatim_run_cell_source, references).

    `record` is the JSON of `GET /v1/catalog/entries/{slug}` (or a `PublicRepositoryEntry`
    dumped to JSON). Raises `KeyError` if it has no slug and `ValueError` if it has no code."""
    slug = str(record["slug"])
    title = str(record.get("title") or slug)
    variant = _pick_variant(record, framework)
    if variant is None or not str(variant.get("code") or "").strip():
        raise ValueError(f"Atlas record {slug!r} has no code variant to seed from")
    code = str(variant["code"])
    explanation = str(record.get("explanationMd") or record.get("explanation") or "")
    references = [
        Reference(
            title=str(cite.get("title") or ""),
            authors=str(cite.get("authors") or ""),
            year=cite.get("year") if isinstance(cite.get("year"), int) else None,
            url=str(cite.get("url") or ""),
            note=str(cite.get("relevance") or ""),
        )
        for cite in (record.get("literature") or [])
        if cite.get("title")
    ]
    lines = [
        f"ATLAS RECORD: {title} (slug: {slug}, category: {record.get('category', '?')}, family: {record.get('algorithmFamily', '?')})",
        f"FRAMEWORK OF THE CODE: {variant.get('framework', framework)}",
        "CODE (verbatim; the walkthrough runs this first, unchanged):",
        code.rstrip(),
    ]
    if explanation.strip():
        lines += ["EXPLANATION (Markdown, from the record):", explanation.strip()]
    if references:
        lines.append("CITATIONS (use these; do not add others):")
        lines += [
            f"- {r.title} — {r.authors} ({r.year or 'n.d.'}) {r.url}".rstrip() for r in references
        ]
    for key in ("sourceCoverage", "knownGaps"):
        if record.get(key):
            lines.append(f"{key}: {record[key]}")
    seed = Seed(kind="atlas-record", ref=slug, note=title)
    return seed, "\n".join(lines), _run_cell_source(code), references
