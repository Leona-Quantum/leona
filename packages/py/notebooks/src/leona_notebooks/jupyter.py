"""Nala inside the reader's own Jupyter: `%load_ext leona_notebooks.jupyter`.

    %nala pull <notebook_id> [--version N] [-o lesson.ipynb]   save a Leona notebook next to you
    %nala push <path.ipynb> [--title "…"]                       import your notebook into Leona
    %nala versions <notebook_id>                                 list a notebook's versions
    %%nala ask <notebook_id>                                      ask Nala about the cell body
    <question, then optionally --- and the code you mean>

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
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_API_URL = "https://api.leonaqt.com"
Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]


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


def _parse(line: str) -> tuple[list[str], dict[str, str]]:
    words = shlex.split(line)
    positional: list[str] = []
    options: dict[str, str] = {}
    index = 0
    while index < len(words):
        word = words[index]
        if word.startswith("--") and index + 1 < len(words):
            options[word[2:]] = words[index + 1]
            index += 2
        elif word == "-o" and index + 1 < len(words):
            options["out"] = words[index + 1]
            index += 2
        else:
            positional.append(word)
            index += 1
    return positional, options


def run_line(line: str, *, client: Client | None = None) -> str:
    """The `%nala` line magic, as a plain function so it is testable without IPython."""
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
            raise NalaError("usage: %nala push <file.ipynb> [--title T]")
        created = client.push(Path(args[0]), options.get("title"))
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
    raise NalaError(f"unknown command {command!r}; try %nala with no arguments")


def run_cell(line: str, cell: str, *, client: Client | None = None) -> str:
    """The `%%nala` cell magic: `%%nala ask <notebook_id>` with the question in the body."""
    positional, _ = _parse(line)
    if len(positional) < 2 or positional[0] != "ask":
        raise NalaError("usage: %%nala ask <notebook_id>  (question in the cell body)")
    client = client or Client.from_env()
    return client.ask(positional[1], cell.strip())


def load_ipython_extension(ipython: Any) -> None:  # pragma: no cover - needs IPython
    from IPython.core.magic import Magics, cell_magic, line_magic, magics_class

    @magics_class
    class NalaMagics(Magics):
        @line_magic
        def nala(self, line: str) -> None:
            print(run_line(line))

        @cell_magic
        def nala_cell(self, line: str, cell: str) -> None:
            print(run_cell(line, cell))

    magics = NalaMagics(ipython)
    ipython.register_magics(magics)
    # `%%nala` and `%nala` share a name; register the cell form under it too.
    ipython.register_magic_function(magics.nala_cell, "cell", "nala")
