# Product copy rules

Tone: technical, calm. Zero exclamation marks, no emoji in product UI. Every number
gets units and, where relevant, tolerance. Never render an unlabeled float.

- **Verdicts:** "Verified" / "Structurally verified" / "Verified with caveats" /
  "Not verified" / "Failed" — never "Success!". Detail names the method: "Verified —
  statistical (TVD 0.0088 ≤ δ 0.05) · seed 42 · 4096 shots".
  "Structurally verified" is a real pass whose evidence was contract checks only —
  nothing compared the circuit against the physics. It is not a softer "Verified" and
  must not be shortened to it; that distinction is the whole point of the word.
- **Export statuses:** "Lossless" / "Lossy — <reason>" / "Download only" /
  "Not supported". Never overclaim (honesty taxonomy binds UI copy too).
- **Buttons:** verb-first — "Run", "Save", "Open in Run",
  "Retry from Verify".
- **Modes:** user-facing labels are "Execute", "Learn", and "Explain". The
  internal compatibility value `ideate` is never rendered.
- **Studio:** "Simulate", "Verify", "Save version", "Open in Studio", and
  "Generate version". A draft is never labeled Verified.
- **Errors:** what happened + what we did + one action. Never a bare stack trace
  outside collapsible details.
- **Empty states:** one sentence + one action. Artifact list: "Nothing verified yet. Your
  first verified run will appear here." + [Start a run].
- **Vocabulary (P1):** describe the OpenQASM program or the concrete check performed
  in framework terms. "the artifact list stores, Studio/Run creates" (P2) shapes verbs.

## Japanese (日本語) term glossary

Rescued from the 2026-07-30 Japanese UI audit (now
`docs/archive/japanese-ui-audit-2026-07-30/`), whose findings were applied but whose
glossary was never turned into a standing rule. It is the audit's own draft
(用語集のたたき台) reproduced unchanged.

**The rule it encodes: do not transliterate an internal-infrastructure noun into
katakana and ship it to a reader.** The left column is our English vocabulary; the
right column is what a Japanese reader should see instead. Where several renderings
are listed they are context alternatives, not synonyms — pick per surface, and pick
the same one every time on that surface.

| 英語 | 推奨日本語 |
|---|---|
| evidence | 検証結果／検証記録／裏付け |
| verification boundary | 検証範囲 |
| execution lane | 実行環境／実行方法 |
| record | 項目／エントリ／記録 |
| artifact | 保存済み回路／成果物 |
| control plane | サーバー／システム |
| deployment | 現在の環境 |
| provenance | 実行履歴／来歴 |
| fingerprint | 識別子 |
| native export | 直接エクスポート／元形式のエクスポート |
| source reference | 元のソースコード |
| attestation | 実行証明 |

The audit also asked that `Run / Studio / Vault / Atlas / アーティファクト` be fixed
as proper nouns with one official rendering each. That decision is still open; note
that `/library` (Vault) is retired and Atlas is now the public repository surface, so
the list needs re-deriving from the shipped navigation before it is settled.

### Open residues (verified 2026-08-04, unapplied)

Four flagged strings survived the audit's own sweep, mostly because the sweep did not
reach `packages/ts/ui` or the tier-limit copy:

- `根拠` ×3 — `packages/ts/ui/src/verification-summary.tsx:99,107,128`, including the
  label `"根拠の強さ"` (evidence strength). This is the audit's headline term, in a
  shared package. Per the table above it should be 検証結果 / 裏付け.
- `コントロールプレーン` — `apps/web/lib/workspace-locale.ts:1859`, user-facing
  tier-limit copy. Should be サーバー / システム.
- `最小の参照例` — `apps/web/lib/repository/entries-legacy.ts:68`.
- `公開研究` ×7 — `apps/web/app/repository/(browse)/page.tsx:24`,
  `apps/web/lib/public-copy.ts:257,259,372,376,447`,
  `apps/web/lib/public-locale.ts:42`. The browse heading `公開研究データベース` is
  close to what the audit suggested; the other six read as "public research (the
  activity)" and were the flagged sense.

`relabeling` at `entries-algorithms.ts:47` and `entries-states-operators.ts:295` is
English prose and is correctly untouched.
