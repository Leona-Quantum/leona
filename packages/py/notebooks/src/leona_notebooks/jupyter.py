"""Nala inside the reader's own Jupyter: `%load_ext leona_notebooks.jupyter`.

    %nala new "<brief>" [--kind K] [--level L] [--no-analogies] [--math M] [--lang en|ja] [-o file.ipynb]
                                                                  ask Nala to build a notebook from scratch
    %nala pull <notebook_id> [--version N] [-o lesson.ipynb]   save a Leona notebook next to you
    %nala push <path.ipynb> [--title "…"]                       import your notebook into Leona
    %nala push <path.ipynb> --to <notebook_id> [--message "…"] [--no-run]
                                                                  push a new version of a notebook you own
    %nala link [<notebook_id>]                                    remember a notebook for this kernel;
                                                                    bare, prints the current link
    %nala versions [<notebook_id>]                                list a notebook's versions
    %nala status [<notebook_id>]                                   latest version's status and cell counts
    %nala fix [<notebook_id>]                                      explain the last traceback in this session
    %nala run [<file.ipynb>] [--to <notebook_id>] [--until <cell_id>]
                                                                  push (or re-run) and wait for the sandbox,
                                                                  printing a per-cell report
    %nala open [<notebook_id>]                                     print the notebook's leonaqt.com URL
    %%nala ask [<notebook_id>]                                    ask Nala about the cell body
    <question, then optionally --- and the code you mean>
    %%nala explain [<notebook_id>] [--level L]                    explain the cell body line by line

Everything goes through the same `/v1/notebooks` routes the web surface uses, so a
notebook edited here and one edited on leonaqt.com are the same object with the same
version history. Configuration is two environment variables — never a token in a cell:

    LEONA_API_URL    default https://majorana-api-nikekeixtq-uw.a.run.app
    LEONA_API_TOKEN  a bearer token for the control plane

`Client` (proposal 7 Phase D) is `leona_client.Client`, generalised out of this module
so `leona-mcp`'s acting tools and the `leona-notebooks` CLI share it too — this module
now only adds the one thing that's genuinely notebook-specific: rendering a version's
`.ipynb` from its stored `spec` when the API has not compiled one yet. IPython is
imported only when the extension is loaded; `Client` is usable without IPython at all.

`%nala link` (Bridge lane, ai-ops 362) is process-local state, not a server call: it
lets `ask`/`fix`/`status`/`versions`/`run`/`open` be typed without repeating a
notebook id every time in one Jupyter session — the common case once a reader is
iterating on one notebook. It is a plain module global rather than anything IPython
stores, so it survives whatever `%nala` command reads it next but never crosses a
kernel restart or a second kernel; there is deliberately no file it round-trips
through, which would risk one kernel's link leaking into an unrelated one opened in
the same directory.
"""

from __future__ import annotations

import json
import shlex
import sys
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import Any

from leona_client import Client as _BaseClient
from leona_client import LeonaClientError

#: `() -> (cell_source, traceback_text) | None` — how `%nala fix` reads the last
#: failure. `load_ipython_extension` binds this to the live shell; tests inject a
#: fake so the magic is testable with no IPython running at all.
FixContext = Callable[[], "tuple[str, str] | None"]

#: Kept as the name this module has always raised, so every existing `except
#: NalaError` (here and in `cli.py`) and every test that catches it by name keeps
#: working unchanged after the move to `leona_client`.
NalaError = LeonaClientError

#: The web address a notebook opens at — used by `%nala open` and (imported from
#: `leona_notebooks.leona`) by `leona_submit`'s "run this on Leona" message, so the
#: two surfaces cannot print two different domains for the same notebook.
NOTEBOOK_URL_TEMPLATE = "https://leonaqt.com/notebooks/{notebook_id}"


def notebook_url(notebook_id: str) -> str:
    return NOTEBOOK_URL_TEMPLATE.format(notebook_id=notebook_id)


#: This kernel's linked notebook, set by `%nala link` — see the module docstring's
#: last paragraph for why this is a plain global and not anything persisted.
_linked_notebook_id: str | None = None


def get_linked_notebook() -> str | None:
    """`None` means nothing is linked in this kernel yet."""
    return _linked_notebook_id


def set_linked_notebook(notebook_id: str | None) -> None:
    global _linked_notebook_id
    _linked_notebook_id = notebook_id


def _resolve_notebook_id(explicit: str | None) -> str:
    """`explicit` if given, else the link — `NalaError` naming exactly what to do
    when neither exists, since "no notebook id" is a usage mistake a reader can
    fix immediately (link one, or pass one), not a server error."""
    notebook_id = explicit or get_linked_notebook()
    if not notebook_id:
        raise NalaError(
            "no notebook id given and none linked — pass one, or run %nala link <notebook_id> first"
        )
    return notebook_id


class Client(_BaseClient):
    """`leona_client.Client`, plus two things `%nala` needs that the base class
    deliberately does not provide:

    - Every `%nala`/CLI command is authenticated, so a missing token should fail
      immediately and say so — unlike `leona_client.Client.from_env()`, which
      accepts a missing token so a caller who only wants the Atlas (`leona-mcp`'s
      read-only tools) never sees an error about a credential it does not need.
    - Rendering a version's notebook from its stored `spec` when the API has not
      compiled an `.ipynb` for it yet, which needs `leona_notebooks`'s own
      `ipynb`/`spec` modules — modules `leona_client` cannot depend on and stay
      installable standalone for a plain script that never touches a notebook.
    """

    @classmethod
    def from_env(cls, transport=None) -> Client:
        client = super().from_env(transport)
        if not client.token:
            raise NalaError(
                "LEONA_API_TOKEN is not set. Put it in your shell environment (never in a notebook)."
            )
        return client

    def pull(self, notebook_id: str, seq: int | None, out: Path) -> Path:
        version = self.version(notebook_id, seq)
        ipynb = version.get("ipynb")
        if ipynb is None:
            from leona_notebooks.ipynb import to_ipynb
            from leona_notebooks.spec import NotebookSpec

            spec = version.get("spec")
            if spec is None:
                raise NalaError(
                    f"version {version.get('seq')} has no content ({version.get('status')})"
                )
            ipynb = to_ipynb(NotebookSpec.model_validate(spec))
        out.write_text(json.dumps(ipynb, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        return out


# --------------------------------------------------------------------------- magics

#: `--flag` options that take no value (`%nala new ... --no-analogies`, `%nala push
#: ... --to X --no-run`). Named globally rather than per-command since a line is
#: parsed once, before the command word decides what is valid.
_BOOLEAN_FLAGS = frozenset({"no-analogies", "no-run"})


def _parse(line: str) -> tuple[list[str], dict[str, str]]:
    words = shlex.split(line)
    positional: list[str] = []
    options: dict[str, str] = {}
    index = 0
    while index < len(words):
        word = words[index]
        if word.startswith("--") and word[2:] in _BOOLEAN_FLAGS:
            options[word[2:]] = "true"
            index += 1
        elif word.startswith("--") and index + 1 < len(words):
            options[word[2:]] = words[index + 1]
            index += 2
        elif word == "-o" and index + 1 < len(words):
            options["out"] = words[index + 1]
            index += 2
        else:
            positional.append(word)
            index += 1
    return positional, options


_NEW_USAGE = (
    'usage: %nala new "<brief>" [--kind K] [--level L] [--no-analogies] '
    "[--math none|minimal|full] [--lang en|ja] [-o file.ipynb]"
)
_PUSH_USAGE = "usage: %nala push <file.ipynb> [--title T]  or:  %nala push <file.ipynb> --to <notebook_id> [--message M] [--no-run]"
_RUN_USAGE = "usage: %nala run [<file.ipynb>] [--to <notebook_id>] [--until <cell_id>]"


def run_line(
    line: str, *, client: Client | None = None, fix_context: FixContext | None = None
) -> str:
    """The `%nala` line magic, as a plain function so it is testable without IPython.
    `fix_context` is only consulted by `fix`; `load_ipython_extension` binds it to the
    live shell's last traceback, tests pass a fake, and a bare call (no IPython, no
    fake) reports that there is nothing to fix rather than raising `AttributeError`."""
    positional, options = _parse(line)
    if not positional:
        return __doc__ or ""
    command, args = positional[0], positional[1:]
    # `link` and `open` never touch the network — `link` only reads/writes this
    # kernel's own state, and `open` is string formatting — so both are handled
    # before a client is built. Building one here would mean a reader with no
    # `LEONA_API_TOKEN` set yet cannot even LINK a notebook, which is exactly
    # backwards for the exported-notebook bootstrap cell (`ipynb.py`'s
    # `setup_preamble`), whose whole point is running `%nala link` before the
    # reader has necessarily set a token.
    if command == "link":
        if args:
            set_linked_notebook(args[0])
            return f"linked {args[0]}"
        linked = get_linked_notebook()
        return f"linked to {linked}" if linked else "no notebook linked"
    if command == "open":
        notebook_id = _resolve_notebook_id(args[0] if args else None)
        return notebook_url(notebook_id)
    client = client or Client.from_env()
    if command == "pull":
        if not args:
            raise NalaError("usage: %nala pull <notebook_id> [--version N] [-o file.ipynb]")
        seq = int(options["version"]) if "version" in options else None
        out = Path(options.get("out") or f"leona-{args[0][:8]}.ipynb")
        path = client.pull(args[0], seq, out)
        return f"saved {path} — open it from the file browser"
    if command == "push":
        if not args:
            raise NalaError(_PUSH_USAGE)
        path = Path(args[0])
        notebook_id = options.get("to")
        if notebook_id:
            execute = "no-run" not in options
            result = client.push_version(
                notebook_id, path, message=options.get("message", ""), execute=execute
            )
            version = result.get("version", {})
            suffix = "" if execute else " (not re-run)"
            return f"pushed v{version.get('seq')} to {notebook_id}{suffix}"
        created = client.push(path, options.get("title"))
        notebook = created.get("notebook", created)
        return f"imported as {notebook.get('id')} ({notebook.get('title')}); Nala is running it now"
    if command == "versions":
        notebook_id = _resolve_notebook_id(args[0] if args else None)
        rows = client.versions(notebook_id)
        return "\n".join(
            f"v{row['seq']:>3}  {row['status']:<8} {row['created_by']:<5} {row.get('message', '')}"
            for row in rows
        )
    if command == "status":
        notebook_id = _resolve_notebook_id(args[0] if args else None)
        return client.status_summary(notebook_id)
    if command == "run":
        return _run_command(args, options, client)
    if command == "new":
        if not args:
            raise NalaError(_NEW_USAGE)
        brief = " ".join(args)
        fields: dict[str, Any] = {}
        if "kind" in options:
            fields["kind"] = options["kind"]
        if "level" in options:
            fields["audience"] = {"level": options["level"]}
        style: dict[str, Any] = {}
        if "no-analogies" in options:
            style["analogies"] = False
        if "math" in options:
            style["math_level"] = options["math"]
        if "lang" in options:
            style["language"] = options["lang"]
            fields["response_locale"] = options["lang"]
        if style:
            fields["style"] = style
        created = client.create(brief, **fields)
        notebook_id = created["notebook"]["id"]
        print(f"generating {notebook_id} ", end="", flush=True)  # noqa: T201 - progress, not logging
        notebook = client.wait_for_version(notebook_id)
        print()  # noqa: T201 - closes the progress-dot line
        out = Path(options.get("out") or f"leona-{notebook_id[:8]}.ipynb")
        # Reuse the seq `wait_for_version` already confirmed rather than asking
        # `pull` to re-resolve `current_version_seq` with a second poll.
        path = client.pull(notebook_id, notebook.get("current_version_seq"), out)
        return f"created {notebook_id} — saved {path}"
    if command == "fix":
        notebook_id = _resolve_notebook_id(args[0] if args else None)
        if fix_context is None:
            raise NalaError(
                "no failing cell to read — %nala fix only works inside a live IPython "
                "session that has actually hit an error"
            )
        found = fix_context()
        if found is None:
            raise NalaError("nothing has failed yet in this session")
        cell_source, tb_text = found
        message = (
            "This cell failed in my Jupyter:\n```python\n"
            + cell_source.strip()
            + "\n```\nTraceback:\n```\n"
            + tb_text.strip()
            + "\n```\nExplain what went wrong and give me the corrected cell."
        )
        return client.ask(notebook_id, message)
    raise NalaError(f"unknown command {command!r}; try %nala with no arguments")


def _run_command(args: list[str], options: dict[str, str], client: Client) -> str:
    """`%nala run` / `leona-notebooks run`: push a local file (new import, or a new
    version with `--to`) or re-run an existing notebook with neither, then wait for
    the sandbox and report cell by cell. Split out of `run_line` because the CLI's
    `cmd_run` needs the SAME per-cell report and the same exit-code decision, not
    just the same request shaping `_run_nala_line` already gives every other
    command.

    Three requests, three ways to find out WHICH version to wait for, because the
    three routes underneath answer that differently:

    - `--to <id>` with a file (`author_notebook_version`, a new version of an
      existing notebook) and no file (`rerun_notebook`) both hand back the exact
      version they just created, so its `seq` is polled directly
      (`wait_for_version_seq`) — the same guarantee `push`/`push --to` already
      relied on.
    - A file with no `--to` (`import_notebook`) is different: its own `version`
      field names the UPLOADED (already-`ready`, not-yet-run) version, and when
      `execute=True` a SECOND version is created to hold the actual run, whose
      `seq` this response never states — only its `run_id` does. So this case
      polls the notebook's `current_version_seq` instead (`wait_for_version`,
      the same call `%nala new` already uses for exactly this "which version am
      I waiting for" question), then reads that version's report once it lands.
    """
    if len(args) > 1:
        raise NalaError(_RUN_USAGE)
    file_arg = args[0] if args else None
    to = options.get("to")
    run_until = options.get("until")
    tick = lambda: print(".", end="", flush=True)  # noqa: E731,T201 - progress dots

    if file_arg is None:
        if run_until is not None:
            raise NalaError(
                "%nala run --until needs a file — pass one, or use %nala run "
                "<file.ipynb> --to <notebook_id> --until <cell_id> to run an edited "
                "copy up to one cell"
            )
        notebook_id = _resolve_notebook_id(to)
        result = client.rerun(notebook_id)
        seq = result.get("version", {}).get("seq")
        if seq is None:
            raise NalaError(f"{notebook_id}: re-run did not return a version to wait for")
        print(f"running {notebook_id} v{seq} ", end="", flush=True)  # noqa: T201
        full_version = client.wait_for_version_seq(notebook_id, seq, on_tick=tick)
        print()  # noqa: T201 - closes the progress-dot line
        return _cell_report_text(notebook_id, full_version)

    path = Path(file_arg)
    if to:
        result = client.push_version(to, path, run_until=run_until)
        seq = result.get("version", {}).get("seq")
        if seq is None:
            raise NalaError(f"{to}: push did not return a version to wait for")
        print(f"running {to} v{seq} ", end="", flush=True)  # noqa: T201
        full_version = client.wait_for_version_seq(to, seq, on_tick=tick)
        print()  # noqa: T201
        return _cell_report_text(to, full_version)

    if run_until is not None:
        raise NalaError(
            "%nala run --until only applies with --to (an existing notebook) — "
            "importing a new one always runs it whole"
        )
    created = client.push(path, None)
    notebook = created.get("notebook", created)
    notebook_id = notebook["id"]
    print(f"importing {notebook_id} ", end="", flush=True)  # noqa: T201
    notebook_state = client.wait_for_version(notebook_id, on_tick=tick)
    print()  # noqa: T201
    seq = notebook_state.get("current_version_seq")
    full_version = client.version(notebook_id, seq)
    return _cell_report_text(notebook_id, full_version)


def _cell_report_text(notebook_id: str, version: dict[str, Any]) -> str:
    """The per-cell report `%nala run`/`leona-notebooks run` print: which cells ran,
    which raised (with `ename`/`evalue` and the tail of the traceback), and which
    never got to run. Raises `NalaError` (so the CLI exits non-zero, per the brief)
    when the version itself has no report to read, or when any cell raised —
    `run_line`'s callers print the message either way, so a failing run still shows
    the reader exactly what happened before the non-zero exit lands.
    """
    status = version.get("status")
    report = version.get("report") or {}
    cells = report.get("cells") or []
    if not cells:
        # `failed` with no report at all: nothing executed (plan 05, rule 1's
        # "nothing usable" case) — the reader gets the version's own status rather
        # than a report this run never produced.
        raise NalaError(f"{notebook_id} v{version.get('seq')}: {status} — no cells ran")
    lines = [f"{notebook_id} v{version.get('seq')} ({status}):"]
    failed: list[dict[str, Any]] = []
    for cell in cells:
        cell_status = cell.get("status")
        cell_id = cell.get("id", "?")
        if cell_status == "ok":
            lines.append(f"  ✓ {cell_id}")
        elif cell_status == "error":
            failed.append(cell)
            error = cell.get("error") or {}
            ename = error.get("ename", "Error")
            evalue = str(error.get("evalue", ""))[:200]
            lines.append(f"  ✗ {cell_id}: {ename}: {evalue}")
            traceback_lines = error.get("traceback") or []
            for tb_line in traceback_lines[-3:]:
                lines.append(f"      {tb_line}")
        else:
            lines.append(f"  · {cell_id} {cell_status}")
    text = "\n".join(lines)
    if failed:
        raise NalaError(text)
    return text


def run_cell(line: str, cell: str, *, client: Client | None = None) -> str:
    """The `%%nala` cell magic: `%%nala ask [<notebook_id>]` with the question in the
    body, or `%%nala explain [<notebook_id>] [--level L]` with the code in the body.
    The notebook id may be omitted in either form and defaults to the link, exactly
    as the line magic's `ask`/`fix`/`status`/`versions`/`run`/`open` do."""
    positional, options = _parse(line)
    if not positional or positional[0] not in {"ask", "explain"}:
        raise NalaError(
            "usage: %%nala ask [<notebook_id>]  (question in the cell body)\n"
            "   or: %%nala explain [<notebook_id>] [--level L]  (code in the cell body)"
        )
    command = positional[0]
    notebook_id = _resolve_notebook_id(positional[1] if len(positional) > 1 else None)
    client = client or Client.from_env()
    if command == "ask":
        return client.ask(notebook_id, cell.strip())
    level = options.get("level", "engineer")
    message = f"Explain this code line by line for a {level}:\n```python\n{cell.strip()}\n```"
    return client.ask(notebook_id, message)


def _ipython_fix_context(shell: Any) -> tuple[str, str] | None:
    """Read the last traceback and the source of the cell that raised it out of a
    live IPython shell. `None` means nothing has failed yet this session."""
    last_type = getattr(sys, "last_type", None)
    last_value = getattr(sys, "last_value", None)
    if last_type is None:
        return None
    last_tb = getattr(sys, "last_traceback", None)
    tb_text = "".join(traceback.format_exception(last_type, last_value, last_tb))
    history = shell.user_ns.get("In") if shell is not None else None
    cell_source = history[-1] if history else ""
    return cell_source, tb_text


def load_ipython_extension(ipython: Any) -> None:  # pragma: no cover - needs IPython
    from IPython.core.magic import Magics, cell_magic, line_magic, magics_class

    @magics_class
    class NalaMagics(Magics):
        @line_magic
        def nala(self, line: str) -> None:
            print(run_line(line, fix_context=lambda: _ipython_fix_context(self.shell)))

        @cell_magic
        def nala_cell(self, line: str, cell: str) -> None:
            print(run_cell(line, cell))

    magics = NalaMagics(ipython)
    ipython.register_magics(magics)
    # `%%nala` and `%nala` share a name; register the cell form under it too.
    ipython.register_magic_function(magics.nala_cell, "cell", "nala")
