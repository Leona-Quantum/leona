# Converting `conditions` / `conditionsJa` to `$…$` — the rules

You are wrapping the mathematics that is **already in the corpus** in `$…$` so KaTeX typesets it.
You are **not** re-authoring, re-symbolising, or improving anything. The bar is: de-TeX the result
through a fixed inverse table and you must get the original string back, character for character.

## Absolute rules

1. **Never change a claim.** Not a number, not a bound, not a variable name, not word order.
2. **`%` inside `$…$` is a TeX comment.** It deletes the rest of the formula *and* the closing `$`.
   Put the sign outside: `$p = 0.57$%`. (Measured: 0 occurrences in this field, but the gate fails on it.)
3. **A literal backslash inside `$…$` becomes a control space and the operator VANISHES from the
   page.** `check-math` does not catch this — it compiles. Split the maths around it:
   `$[−1,1]$ \ $(−1/\kappa, 1/\kappa)$`.
4. **Never `\cdot`.** `\cdot` before a letter merges into one undefined token; `\cdot ` with a space
   leaves the space behind and fails the round-trip. Keep the literal `·` (U+00B7).
5. **Never `\left` / `\right`.** `\le` is a prefix of `\left` in the inverse table, so `\left(`
   de-TeXes to `≤ft(`.
6. **Never turn a word into a symbol.** If the source spells `psi`, `phi`, `kappa`, `poly`,
   `polylog`, leave the word. That is a re-authoring, not a typesetting change.
7. **Never touch a character inside a direct quotation.**
8. **Never rewrite a number's typography.** `d²` stays `d²`, not `d^2`. `ε^-2` stays. `2^n x 2^n`
   keeps the source's lowercase `x`.
9. **Em dash `—`, en dash `–`, and accented letters in author names stay in prose**, never inside
   `$…$`. Every `–` in the Japanese values is an author-name separator (`Yoder–Low–Chuang`).
10. **Convert both locales in the same pass.** `check-math` fails a one-sided conversion. 59 of 61
    nodes carry an identical multiset of math tokens in `en` and `ja`.

## What you MAY substitute (the inverse table knows these, so they round-trip)

`\varepsilon`→ε · `\kappa`→κ · `\lambda`→λ · `\alpha`→α · `\delta`→δ · `\rho`→ρ · `\pi`→π ·
`\psi`→ψ · `\Psi`→Ψ · `\Sigma`→Σ · `\leq`→≤ · `\geq`→≥ · `\approx`→≈ · `\times`→× · `\otimes`→⊗ ·
`\langle` `\rangle` · `\infty`→∞ · `\ldots` `\dots`→… · `\dagger`→† (only with nothing after it in the
body) · `\log` `\ln` `\min` `\max` `\exp` · `\mathrm{poly}` · `\mathrm{polylog}` · `\tilde{O}` · `\,`

## What you MUST leave as literal Unicode (the table does not know them; they compile fine)

`Φ` · `⪰` · `∈` · `∫` · `⌈` `⌉` · `‖` · `²` · `⁰` · `½` · `−` (U+2212, **not** a hyphen) · `·` ·
every combining accent (`d̃`, `µ̃`, `Φ̂`) · `Ĥ` · `√` · `†` where something follows it.

## Scope of a `$…$`

Wrap the **expression**, not the sentence. A bare variable used as a variable is in scope and is the
established precedent in this corpus: `independent of $M$, the number of sets of initial data`,
`for a $d$-sparse matrix`, `a degree-$N$ approximation`. Prose words inside the maths are not:
write `$O(1/\varepsilon)$ rather than $O(\log(1/\varepsilon))$`, never one `$…$` spanning "rather than".

## Verifying your own work — REQUIRED before you return

```
cd <SCRATCHPAD>
node roundtrip.mjs <your-batch-input>.json <your-batch-output>.json
```

It must print `round-trip: N of N values reproduce their original exactly` and exit 0. Anything it
rejects is your error, not the harness's — fix it or leave that value unconverted and say so.

A value you decide **not** to convert must appear in your output with its **original string,
byte-identical**. Do not omit it and do not guess.
