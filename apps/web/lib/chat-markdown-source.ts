/**
 * Presentation-only rewrites applied to a model-authored Markdown answer before
 * it is parsed. The stored response is never changed.
 *
 * Both rules exist because providers emit Markdown that is *valid* but renders
 * wrongly in this product specifically:
 *
 * 1. TeX arrives with `\(…\)` / `\[…\]` delimiters, which remark-math does not
 *    recognise — it wants `$…$` / `$$…$$`.
 * 2. A `|` inside inline math is eaten by the GFM table parser as a column
 *    separator. That is GFM behaving correctly (GitHub does the same), but for
 *    a quantum product it breaks the single most common table there is: a state
 *    table whose cells are kets. A production answer to "ベル状態とは何ですか？"
 *    returned exactly that, and the row rendered as three shredded cells
 *    (`$` / `\Phi^+\rangle$` / `$\frac{1}{\sqrt{2}}(`) instead of two.
 */

/** Providers commonly emit TeX delimiters as `\(…\)` and `\[…\]`. */
export function normalizeMathDelimiters(source: string): string {
  return source
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match: string, content: string) => `$$${content}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match: string, content: string) => `$${content}$`);
}

/**
 * Rewrite `|` to `\vert` inside inline math **on table rows only**.
 *
 * `\vert` is what KaTeX renders `|` as anyway, so the output is visually
 * identical — this changes how the *table* parser splits the line, not how the
 * math reads. Escaping to `\|` would not work: in KaTeX `\|` is ‖, a different
 * glyph.
 *
 * Two deliberate guards keep this from touching prose:
 * - only lines whose trimmed form starts with `|` (a table row) are considered;
 * - only `$…$` spans containing a backslash are treated as math, so a line like
 *   `| costs $5 | $10 |` is left alone rather than having its two currency
 *   amounts merged into one cell.
 */
export function protectMathPipesInTableRows(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      if (!line.trim().startsWith("|")) return line;
      return line.replace(/\$([^$\n]+)\$/g, (match: string, body: string) =>
        body.includes("\\") ? `$${body.replaceAll("|", "\\vert ")}$` : match,
      );
    })
    .join("\n");
}

/** Every presentation rewrite, in the order they have to run.
 *
 * Delimiter normalization comes first so that a ket written as `\(|00\rangle\)`
 * inside a table cell is already `$…$` by the time the pipe guard looks at it.
 */
export function renderableMarkdown(source: string): string {
  return protectMathPipesInTableRows(normalizeMathDelimiters(source));
}
