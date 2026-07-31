import json

import pytest

from majorana_research_extraction import NotebookExtractionLimits, extract_notebook


def _notebook(cells, **extra):
    return json.dumps(
        {
            "cells": cells,
            "metadata": {"untrusted": "ignored"},
            "nbformat": 4,
            "nbformat_minor": 5,
            **extra,
        }
    ).encode()


def test_sanitizes_html_separates_channels_removes_outputs_and_retains_cell_index():
    output_secret = "output-secret-must-not-survive"
    content = _notebook(
        [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": [
                    "# H2 VQE\n",
                    '<script>alert("x")</script><b onclick="steal()">Safe text</b>',
                ],
            },
            {
                "cell_type": "code",
                "execution_count": 99,
                "metadata": {},
                "outputs": [{"output_type": "stream", "text": output_secret}],
                "source": "from qiskit_algorithms import VQE\nsolver = VQE()\n",
            },
        ]
    )

    result = extract_notebook("notebooks/h2.ipynb", content)
    serialized = json.dumps(result.as_dict())

    assert result.issues == ()
    assert result.execution_performed is False
    assert result.publication_eligible is False
    assert result.removed_output_count == 1
    assert [cell.channel for cell in result.cells] == ["markdown", "code"]
    assert result.cells[0].sanitized_source == "# H2 VQE\nSafe text"
    assert "script" not in result.cells[0].sanitized_source
    assert "onclick" not in result.cells[0].sanitized_source
    assert output_secret not in serialized
    assert "execution_count" not in serialized
    assert [cell.locator.cell_index for cell in result.cells] == [0, 1]
    assert all(cell.locator.notebook_sha256 == result.notebook_sha256 for cell in result.cells)


def test_attachment_rejects_entire_notebook_without_copying_payload():
    secret = "attachment-secret-must-not-survive"
    content = _notebook(
        [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": "image",
                "attachments": {"image.png": {"image/png": secret}},
            }
        ]
    )

    result = extract_notebook("notebooks/attached.ipynb", content)

    assert result.cells == ()
    assert [issue.code for issue in result.issues] == ["attachments_rejected"]
    assert result.issues[0].cell_index == 0
    assert secret not in json.dumps(result.as_dict())


def test_binary_data_url_in_source_is_rejected():
    content = _notebook(
        [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": "![x](data:image/png;base64,AAAA)",
            }
        ]
    )

    result = extract_notebook("notebooks/base64.ipynb", content)

    assert [issue.code for issue in result.issues] == ["base64_source_rejected"]


@pytest.mark.parametrize(
    ("path", "content", "code"),
    [
        ("../escape.ipynb", b"{}", "invalid_notebook_path"),
        ("notebook.json", b"{}", "invalid_notebook_path"),
        ("notebook.ipynb", b"\xff", "invalid_utf8"),
        ("notebook.ipynb", b"{", "invalid_notebook_json"),
        (
            "notebook.ipynb",
            b'{"nbformat":4,"nbformat":5,"cells":[]}',
            "duplicate_json_key",
        ),
        (
            "notebook.ipynb",
            json.dumps({"nbformat": 3, "cells": []}).encode(),
            "unsupported_nbformat",
        ),
        (
            "notebook.ipynb",
            b'{"nbformat":4,"cells":[],"metadata":{"value":NaN}}',
            "invalid_notebook_json",
        ),
    ],
)
def test_invalid_notebook_fails_closed(path, content, code):
    result = extract_notebook(path, content)

    assert result.cells == ()
    assert [issue.code for issue in result.issues] == [code]
    assert result.execution_performed is False


def test_cell_count_source_token_and_json_limits_fail_closed():
    cell = {"cell_type": "code", "metadata": {}, "outputs": [], "source": "x = 1"}
    cell_count = extract_notebook(
        "n.ipynb",
        _notebook([cell, cell]),
        limits=NotebookExtractionLimits(max_cells=1),
    )
    source_size = extract_notebook(
        "n.ipynb",
        _notebook([{**cell, "source": "x" * 20}]),
        limits=NotebookExtractionLimits(max_cell_source_bytes=4),
    )
    cell_tokens = extract_notebook(
        "n.ipynb",
        _notebook([{**cell, "source": "a + b + c"}]),
        limits=NotebookExtractionLimits(max_cell_tokens=2),
    )
    total_tokens = extract_notebook(
        "n.ipynb",
        _notebook([cell, cell]),
        limits=NotebookExtractionLimits(max_total_tokens=2),
    )
    json_nodes = extract_notebook(
        "n.ipynb",
        _notebook([cell]),
        limits=NotebookExtractionLimits(max_json_nodes=3),
    )

    assert [issue.code for issue in cell_count.issues] == ["cell_count_limit_exceeded"]
    assert [issue.code for issue in source_size.issues] == ["cell_source_size_limit_exceeded"]
    assert [issue.code for issue in cell_tokens.issues] == ["cell_token_limit_exceeded"]
    assert [issue.code for issue in total_tokens.issues] == ["notebook_token_limit_exceeded"]
    assert [issue.code for issue in json_nodes.issues] == ["json_node_limit_exceeded"]


def test_raw_cell_is_explicitly_unsupported_in_v1():
    content = _notebook([{"cell_type": "raw", "metadata": {}, "source": "raw"}])

    result = extract_notebook("n.ipynb", content)

    assert [issue.code for issue in result.issues] == ["unsupported_cell_type"]


def test_unexpected_markdown_outputs_are_removed_without_copying_payload():
    secret = "nonstandard-markdown-output-secret"
    content = _notebook(
        [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": "safe",
                "outputs": [{"text": secret}],
            }
        ]
    )

    result = extract_notebook("n.ipynb", content)

    assert result.issues == ()
    assert result.removed_output_count == 1
    assert secret not in json.dumps(result.as_dict())


def test_replay_is_deterministic_and_code_cell_is_never_executed(tmp_path):
    marker = tmp_path / "must-not-exist"
    content = _notebook(
        [
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": f"from pathlib import Path\nPath({str(marker)!r}).write_text('x')",
            }
        ]
    )

    first = extract_notebook("hostile.ipynb", content)
    second = extract_notebook("hostile.ipynb", content)

    assert first == second
    assert first.deterministic_digest == second.deterministic_digest
    assert not marker.exists()
    assert first.execution_performed is False
