# Majorana research extraction

This package performs bounded syntactic inspection of untrusted research
sources. It never imports or executes the inspected module.

The Python AST extractor records:

- `import` and `from ... import ...` declarations and local aliases;
- simple symbol aliases that resolve to an imported symbol;
- syntactic calls whose callee resolves to an imported symbol;
- keyword names and bounded literal keyword values;
- calls placed under an exact `if __name__ == "__main__"` guard.

Every fact carries the source SHA-256 plus 1-based line and UTF-8 byte-column
spans. Inputs, AST size/depth, fact count, and literal structures are bounded.
Invalid input returns stable issue codes without raw parser exception text.

An `imported_call` is not proof that the callee is a constructor, that it ran,
or that the referenced framework supports a scientific capability. These
records remain private extraction evidence until a separate reviewed
materialization step.

The notebook sanitizer accepts bounded Jupyter v4 JSON only. It separates code
and markdown channels, strips all HTML markup and active HTML content from
markdown, removes outputs and execution counts from the returned model, rejects
attachments and base64 data URLs, and records the original source digest at
each cell index. Its lexical-token budget is deterministic and intentionally
not presented as an LLM tokenizer count. Raw cells are unsupported in v1.
