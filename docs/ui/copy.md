# Product copy rules

Tone: technical, calm. Zero exclamation marks, no emoji in product UI. Every number
gets units and, where relevant, tolerance. Never render an unlabeled float.

- **Verdicts:** "Verified" / "Verified with caveats" / "Not verified" / "Failed" —
  never "Success!". Detail names the method: "Verified — statistical (TVD 0.0088 ≤
  δ 0.05) · seed 42 · 4096 shots".
- **Export statuses:** "Lossless" / "Lossy — <reason>" / "Download only" /
  "Not supported". Never overclaim (honesty taxonomy binds UI copy too).
- **Buttons:** verb-first — "Run", "Save to Library", "Open in Run",
  "Retry from Verify".
- **Errors:** what happened + what we did + one action. Never a bare stack trace
  outside collapsible details.
- **Empty states:** one sentence + one action. Library: "Nothing verified yet. Your
  first verified run will appear here." + [Start a run].
- **Vocabulary (P1):** "IR" is not user vocabulary — say what was checked/exported
  in framework terms. "Library stores, Studio/Run creates" (P2) shapes verbs.
