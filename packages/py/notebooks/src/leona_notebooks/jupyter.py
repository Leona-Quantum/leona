"""Nala inside the reader's own Jupyter: `%load_ext leona_notebooks.jupyter`.

    %nala new "<brief>" [--kind K] [--level L] [--no-analogies] [--math M] [--lang en|ja] [-o file.ipynb]
                                                                  ask Nala to build a notebook from scratch
    %nala pull <notebook_id> [--version N] [-o lesson.ipynb]   save a Leona notebook next to you
    %nala push <path.ipynb> [--title "…"]                       import your notebook into Leona
    %nala push <path.ipynb> --to <notebook_id> [--message "…"] [--no-run]
                                                                  push a new version of a notebook you own
    %nala versions <notebook_id>                                 list a notebook's versions
    %nala status <notebook_id>                                    latest version's status and cell counts
    %nala fix <notebook_id>                                       explain the last traceback in this session
    %%nala ask <notebook_id>                                      ask Nala about the cell body
    <question, then optionally --- and the code you mean>
    %%nala explain <notebook_id> [--level L]                      explain the cell body line by line

Everything goes through the same `/v1/notebooks` routes the web surface uses, so a
notebook edited here and one edited on leonaqt.com are the same object with the same
version history. Configuration is two environment variables — never a token in a cell:

    LEONA_API_URL    default https://api.leonaqt.com
    LEONA_API_TOKEN  a bearer token for the control plane

The transport is stdlib `urllib` so the package adds no dependency; IPython is imported
only when the extension is loaded. `Client` is usable without IPython at all.
"""

from __future__ import annotations

import json
import os
import shlex
import sys
import time
import traceback
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_API_URL = "https://api.leonaqt.com"
Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]
#: `() -> (cell_source, traceback_text) | None` — how `%nala fix` reads the last
#: failure. `load_ipython_extension` binds this to the live shell; tests inject a
#: fake so the magic is testable with no IPython running at all.
FixContext = Callable[[], "tuple[str, str] | None"]


class NalaError(RuntimeError):
    pass


def _urllib_transport(
    method: str, url: str, headers: dict[str, str], body: bytes | None
) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - https to the configured API
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


@dataclass
class Client:
    api_url: str
    token: str
    transport: Transport = _urllib_transport

    @classmethod
    def from_env(cls, transport: Transport | None = None) -> Client:
        token = os.environ.get("LEONA_API_TOKEN", "").strip()
        if not token:
            raise NalaError(
                "LEONA_API_TOKEN is not set. Put it in your shell environment (never in a notebook)."
            )
        url = os.environ.get("LEONA_API_URL", DEFAULT_API_URL).rstrip("/")
        return cls(api_url=url, token=token, transport=transport or _urllib_transport)

    def _call(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/json"}
        body: bytes | None = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode("utf-8")
        status, raw = self.transport(method, f"{self.api_url}/v1{path}", headers, body)
        if status >= 400:
            try:
                problem = json.loads(raw.decode("utf-8"))
                detail = (
                    problem.get("title") or problem.get("detail") or raw.decode("utf-8", "replace")
                )
            except (ValueError, AttributeError):
                detail = raw.decode("utf-8", "replace")
            raise NalaError(f"{method} {path} → {status}: {detail}")
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))

    # -- operations ------------------------------------------------------

    def notebook(self, notebook_id: str) -> dict[str, Any]:
        return self._call("GET", f"/notebooks/{notebook_id}")

    def versions(self, notebook_id: str) -> list[dict[str, Any]]:
        return self._call("GET", f"/notebooks/{notebook_id}/versions")["items"]

    def version(self, notebook_id: str, seq: int | None) -> dict[str, Any]:
        if seq is None:
            seq = self.notebook(notebook_id).get("current_version_seq")
            if seq is None:
                raise NalaError("this notebook has no finished version yet")
        return self._call("GET", f"/notebooks/{notebook_id}/versions/{seq}")

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

    def push(self, path: Path, title: str | None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ipynb": json.loads(path.read_text(encoding="utf-8")),
            "execute": True,
        }
        if title:
            payload["title"] = title
        return self._call("POST", "/notebooks/import", payload)

    def push_version(
        self, notebook_id: str, path: Path, *, message: str = "", execute: bool = True
    ) -> dict[str, Any]:
        """`POST /v1/notebooks/{id}/versions` — a new version of a notebook you
        already own, from a local `.ipynb`. Shaped like `AuthorNotebookVersionRequest`
        (`spec|source|ipynb`, `message`, `execute`, `run_until`); this always sends
        `ipynb`. Returns `{version: NotebookVersionSummary, run_id}`."""
        payload: dict[str, Any] = {
            "ipynb": json.loads(path.read_text(encoding="utf-8")),
            "message": message,
            "execute": execute,
        }
        return self._call("POST", f"/notebooks/{notebook_id}/versions", payload)

    def create(self, brief: str, **fields: Any) -> dict[str, Any]:
        """`POST /v1/notebooks`. `fields` (kind, audience, style, response_locale,
        …) are merged over `{"brief": brief}`; a `None` value is dropped rather than
        sent, so callers can pass every optional field unconditionally. Returns
        `CreateNotebookResponse`-shaped JSON: `{notebook, version, run_id}`."""
        payload: dict[str, Any] = {"brief": brief}
        payload.update({key: value for key, value in fields.items() if value is not None})
        return self._call("POST", "/notebooks", payload)

    def wait_for_version(
        self,
        notebook_id: str,
        *,
        wait_s: int = 600,
        poll_s: float = 3.0,
        sleep=time.sleep,
        on_tick: Callable[[], None] | None = None,
    ) -> dict[str, Any]:
        """Poll `GET /v1/notebooks/{id}` until `current_version_seq` is set (the
        first version is ready) or `latest_status` is `failed`. `on_tick` fires once
        per poll that finds neither — the default prints a friendly progress dot;
        tests inject their own to stay silent and deterministic."""
        tick = on_tick or (lambda: print(".", end="", flush=True))  # noqa: T201 - the point
        deadline = time.monotonic() + wait_s
        while True:
            notebook = self.notebook(notebook_id)
            if notebook.get("current_version_seq") is not None:
                return notebook
            if notebook.get("latest_status") == "failed":
                raise NalaError(
                    f"{notebook_id} failed to generate — open it on leonaqt.com to see why"
                )
            if time.monotonic() >= deadline:
                raise NalaError(
                    f"{notebook_id} is still generating after {wait_s}s — "
                    f"pull it once it finishes: %nala pull {notebook_id}"
                )
            tick()
            sleep(poll_s)

    def status_summary(self, notebook_id: str) -> str:
        """The newest version's status, author and message, plus — when its
        execution report is present — how many cells ran, failed, or did not run."""
        rows = self.versions(notebook_id)
        if not rows:
            return f"{notebook_id}: no versions yet"
        latest = max(rows, key=lambda row: row["seq"])
        detail = self.version(notebook_id, latest["seq"])
        lines = [f"v{detail['seq']} {detail['status']} (by {detail['created_by']})"]
        if detail.get("message"):
            lines.append(f"message: {detail['message']}")
        report = detail.get("report")
        if report:
            cells = report.get("cells", [])
            ran = sum(1 for cell in cells if cell.get("status") == "ok")
            failed = sum(1 for cell in cells if cell.get("status") == "error")
            not_run = sum(1 for cell in cells if cell.get("status") in {"skipped", "not_run"})
            lines.append(f"cells: {ran} ran, {failed} failed, {not_run} not run")
        return "\n".join(lines)

    def ask(
        self,
        notebook_id: str,
        message: str,
        *,
        wait_s: int = 180,
        poll_s: float = 3.0,
        sleep=time.sleep,
    ) -> str:
        """Post a turn and wait for Nala's reply (the reply is a later `nala` turn)."""
        response = self._call("POST", f"/notebooks/{notebook_id}/turns", {"message": message})
        asked_seq = int(response["turn"]["seq"])
        deadline = time.monotonic() + wait_s
        while time.monotonic() < deadline:
            turns = self._call("GET", f"/notebooks/{notebook_id}/turns")["items"]
            replies = [t for t in turns if t["role"] == "nala" and int(t["seq"]) > asked_seq]
            if replies:
                return str(replies[-1]["content"])
            sleep(poll_s)
        raise NalaError("Nala has not replied yet — the run is still going; ask again in a minute")


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
        if not args:
            raise NalaError("usage: %nala versions <notebook_id>")
        rows = client.versions(args[0])
        return "\n".join(
            f"v{row['seq']:>3}  {row['status']:<8} {row['created_by']:<5} {row.get('message', '')}"
            for row in rows
        )
    if command == "status":
        if not args:
            raise NalaError("usage: %nala status <notebook_id>")
        return client.status_summary(args[0])
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
        if not args:
            raise NalaError("usage: %nala fix <notebook_id>")
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
        return client.ask(args[0], message)
    raise NalaError(f"unknown command {command!r}; try %nala with no arguments")


def run_cell(line: str, cell: str, *, client: Client | None = None) -> str:
    """The `%%nala` cell magic: `%%nala ask <notebook_id>` with the question in the
    body, or `%%nala explain <notebook_id> [--level L]` with the code in the body."""
    positional, options = _parse(line)
    if len(positional) < 2 or positional[0] not in {"ask", "explain"}:
        raise NalaError(
            "usage: %%nala ask <notebook_id>  (question in the cell body)\n"
            "   or: %%nala explain <notebook_id> [--level L]  (code in the cell body)"
        )
    command, notebook_id = positional[0], positional[1]
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
