"""The MCP server: three read-only tools over the public Atlas, on stdio.

Run it as `leona-mcp`. It speaks MCP over stdin and stdout, opens no port, and
makes no network call except to the public catalog endpoint in `client.py`.
Logging goes to stderr, because stdout carries the protocol.
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import Field

from . import __version__
from .atlas import (
    DEFAULT_RESULTS,
    MAX_RESULTS,
    SearchLimits,
    method_detail,
    normalize_slug,
    problem_area_counts,
    resolve_problem_area,
    search,
    similar_slugs,
)
from .client import CatalogClient

SERVER_NAME = "leona-atlas"

INSTRUCTIONS = (
    "This server reads the Quantum Atlas, the public catalog of quantum algorithms, gates, "
    "states and benchmark circuits at leonaqt.com. It reads Leona's public, read-only API "
    "and nothing else. Every answer comes from a published record and carries that record's "
    "page URL; get_method also returns the papers the record cites. A record is a claim from "
    "its cited sources, not a result this server checked or ran, so quote it as the record's "
    "claim. When a record does not carry a field, the answer says 'not stated in the record' "
    "rather than filling it in. Nothing here runs code, submits jobs, spends money or needs "
    "an account. A good order: list_problem_areas or search_methods to find candidates, then "
    "get_method on a slug for the full record."
)

SEARCH_DESCRIPTION = (
    "Find Atlas records that fit a problem and some hard limits. The limits work like the "
    "method finder on leonaqt.com: a record is dropped only when it states a value that "
    "breaks a limit. A record that does not state its qubits or depth, or states them in a "
    "form that is not a single number (for example 'n + 1'), stays in the results with the "
    "verdict 'not-stated' for that limit, so check those yourself. "
    "'query' matches any of its words, or all of them with match_all=true, anywhere in a "
    "record's title, description, algorithm family, framework, provenance or tags, ignoring "
    "case. Common words such as 'quantum' match most records. "
    "Results are unranked candidates, sorted by slug: judge relevance yourself, and use "
    "offset to page when total_matches is more than came back. excluded_by_only counts, for "
    "each limit you set, the records that fail only that limit. "
    "hardware='nisq' keeps records that publish a runnable circuit. hardware='fault-tolerant' "
    "never drops a record here, because this server does not read the cost estimator; it "
    "only marks records that say they need fault tolerance."
)

GET_DESCRIPTION = (
    "Read one Atlas record in full: description, introduction and explanation; the cost the "
    "record states; its speedup class and whether that class was checked against the "
    "record's own primary paper; its verification tier, methods and caveat; the literature "
    "it cites (title, authors, year, link); its resource rows; and the OpenQASM 3 of its "
    "circuit when it has one. Any field the record does not carry reads 'not stated in the "
    "record'. Nothing is estimated or filled in. Accepts a slug or a record URL."
)

LIST_DESCRIPTION = (
    "List the problem areas the Atlas tags records with (chemistry, optimization, finance "
    "and so on), each with its definition and how many records carry it. A record can carry "
    "more than one. Pass an id to search_methods as problem_area."
)

_READ_ONLY = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=True,
)


def build_server(client: CatalogClient | None = None) -> FastMCP:
    """The server with its three tools. Tests pass a client with a mock transport."""
    catalog = client or CatalogClient()
    # WARNING, not the SDK's INFO default: INFO logs every request and every HTTP call
    # to stderr, which an MCP client shows its user as noise.
    server = FastMCP(SERVER_NAME, instructions=INSTRUCTIONS, log_level="WARNING")

    @server.tool(
        name="search_methods",
        title="Search the Atlas",
        description=SEARCH_DESCRIPTION,
        annotations=_READ_ONLY,
    )
    async def search_methods(
        query: Annotated[
            str,
            Field(description="Words to look for. Empty means no text filter."),
        ] = "",
        problem_area: Annotated[
            str | None,
            Field(
                description=(
                    "A problem area id from list_problem_areas, such as 'chemistry' or "
                    "'linear-algebra'. Its label also works."
                )
            ),
        ] = None,
        max_qubits: Annotated[
            int | None,
            Field(ge=0, description="Drop records that state more qubits than this."),
        ] = None,
        max_depth: Annotated[
            int | None,
            Field(ge=0, description="Drop records that state a greater depth than this."),
        ] = None,
        hardware: Annotated[
            Literal["any", "nisq", "fault-tolerant"],
            Field(description="'nisq' keeps records with a runnable circuit. See above."),
        ] = "any",
        match_all: Annotated[
            bool,
            Field(description="Require every query word, not just one."),
        ] = False,
        limit: Annotated[
            int,
            Field(ge=1, le=MAX_RESULTS, description=f"Rows to return, at most {MAX_RESULTS}."),
        ] = DEFAULT_RESULTS,
        offset: Annotated[
            int,
            Field(ge=0, description="Rows to skip, for paging."),
        ] = 0,
    ) -> dict[str, Any]:
        area = resolve_problem_area(problem_area).id if problem_area else None
        limits = SearchLimits(
            query=query,
            match_all=match_all,
            problem_area=area,
            max_qubits=max_qubits,
            max_depth=max_depth,
            hardware=hardware,
        )
        return search(await catalog.rows(), limits, max_results=limit, offset=offset)

    @server.tool(
        name="get_method",
        title="Read one Atlas record",
        description=GET_DESCRIPTION,
        annotations=_READ_ONLY,
    )
    async def get_method(
        slug: Annotated[
            str,
            Field(
                description=(
                    "The record's slug, as search_methods returns it, or its "
                    "https://leonaqt.com/repository/<slug> URL."
                )
            ),
        ],
    ) -> dict[str, Any]:
        wanted = normalize_slug(slug)
        rows = await catalog.rows()
        for row in rows:
            if row.slug == wanted:
                return method_detail(row)
        hint = similar_slugs(rows, wanted)
        suffix = f" Slugs containing that text: {', '.join(hint)}." if hint else ""
        raise ValueError(
            f"No published Atlas record has the slug {wanted!r}.{suffix} "
            "search_methods finds slugs."
        )

    @server.tool(
        name="list_problem_areas",
        title="List problem areas",
        description=LIST_DESCRIPTION,
        annotations=_READ_ONLY,
    )
    async def list_problem_areas() -> dict[str, Any]:
        rows = await catalog.rows()
        return {"problem_areas": problem_area_counts(rows), "records_in_atlas": len(rows)}

    return server


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="leona-mcp",
        description=(
            "A read-only MCP server over the public Quantum Atlas at leonaqt.com, on stdio. "
            "Set LEONA_API_URL to read a different Leona API."
        ),
    )
    parser.add_argument("--version", action="version", version=f"leona-mcp {__version__}")
    parser.parse_args(argv)
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.WARNING,
        format="leona-mcp: %(levelname)s %(message)s",
    )
    build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
