# ADR-0027: The Atlas VQE Registry/Compare UI merges into the existing `/repository` page, not a new top-level section

**Date:** 2026-07-24 · **Status:** accepted (owner-directed; see context)
**Context:** The Phase 4 execution plan (`docs/atlas/atlas_vqe_mvp_execution_plan_ja.md`
Phase 4, "UI placement") calls its new Browse/Compare surface "Atlas" and
explicitly instructs: "既存`/repository`とのidentity/search重複をADRで解決し、
Atlasが別の孤立Catalogにならないようにする" (resolve the identity/search overlap
with the existing `/repository` via an ADR so Atlas doesn't become a second,
isolated catalog). Investigating the existing codebase before writing any UI
code found a real naming collision the plan itself does not resolve: the
existing public `/repository` page is *already* branded "Atlas" throughout
the product (`apps/web/lib/public-locale.ts`'s nav label, the page's own
`<title>`, "Search the Atlas" copy) — a 283-record curated circuit catalog,
public and unauthenticated. It predates this VQE work. The owner was asked
directly (three options: new UI takes a different name; rename the existing
public page's "Atlas" label and give it to the new UI; or merge the new VQE
corpus data into the existing `/repository` page) and chose the third:
**merge into the existing page**, since that most directly satisfies the
plan's own "not a second, isolated catalog" instruction and touches no
existing public branding.

A second, code-level finding surfaced while implementing that choice:
`PublicRepositoryEntry` (`apps/web/lib/repository/types.ts`), the type every
existing `/repository` record is shaped as, is fundamentally an
*executable-circuit* record — `visualization` (wires/operations/outcomes)
and `codeVariants` (concrete framework code) are **required**, non-optional
fields, and every one of the 283 existing records genuinely has them. The
26 curated VQE papers (`docs/atlas/corpus/papers/`) are literature/method
records at Phase 2's annotation depth — no executed circuit, no framework
code, by design (Phase 2/ADR-0026 explicitly stopped short of execution;
that begins in Phase 5). Forcing a VQE paper through `PublicRepositoryEntry`
would mean fabricating a `visualization`/`codeVariants` value with no real
content behind it — a direct violation of this project's standing
no-fabrication rule (root `AGENTS.md` §"Hard rules": "No invented results")
and of the Part XI data-integrity principles adopted for this MVP.

**Decision:**
1. VQE Registry/Compare content lives **under the same `/repository` page,
   URL, and nav entry** as the existing circuit catalog — no new top-level
   route, no second nav-config entry, no new public brand name. The existing
   page gains a content-type toggle ("Circuits" | "VQE Methods") at the top
   of the browse view; VQE detail and compare pages live at
   `/repository/vqe/{paperId}` and `/repository/vqe/compare/{comparisonId}`
   — nested under the same page, not siblings of it.
2. VQE records are **not** coerced into `PublicRepositoryEntry`.
   `apps/web/lib/atlas-vqe/types.ts` defines its own types
   (`VqePaperRecord`, `VqeRepositoryRecord`, `VqeComparisonRecord`) that
   mirror the corpus JSON schema field-for-field, including every
   `unknown`/`null`/`machine_validated` marker the corpus already carries.
   No field is synthesized to satisfy a shape it doesn't actually have.
3. VQE corpus data is served to the browse/detail/compare views as
   **static, build-time fixture data** — a committed, generated bundle
   (`apps/web/lib/atlas-vqe/corpus-data.generated.json`, produced by
   `apps/web/scripts/generate-atlas-vqe-corpus.mjs` from
   `docs/atlas/corpus/{papers,repositories,comparisons}/*.json`, checked
   with `--check` the same way `generate-catalog-bootstrap-manifest.mjs`
   already is in the `ts` CI job) — **not** the authenticated
   `GET /v1/atlas/*` endpoints built in Phase 3. Those endpoints require a
   resolved `Scope` (Bearer token); `/repository` is public and
   unauthenticated, and opening a new anonymous passthrough to
   authenticated data was explicitly rejected by `repository-source.ts`'s
   own precedent ("Adding a public passthrough would create a second
   unauthenticated surface for no gain"). This also matches the corpus's
   actual maturity: no real DB import has run yet (`docs/atlas/PHASE3_PROGRESS.md`
   §4), so the DB-backed endpoints would return empty lists today regardless.
4. Every `unknown`/`conflicting`/`null` value already present in the corpus
   renders as an explicit "unknown" state in the UI, never a blank cell or
   an omitted row (plan requirement, restated from ADR-0026: never display
   unmet as met). Comparison reports render their
   `is_manual_gold: false` / `human_validated: false` flags visibly, the
   same requirement the plan states directly for this UI.

**Consequences:** `/repository`'s existing 283 circuit records, their
identity, and their URLs are completely unaffected — this is additive. The
merge costs more upfront UI work than a separate section would have (two
distinct card/detail renderers sharing one page shell, rather than one
type rendered twice), but avoids fabricating data and avoids a second
"Atlas" brand collision. The VQE section's data source (static generated
corpus bundle) is intentionally decoupled from the Phase 3 authenticated
API; when real DB-backed corpus import ships and a public-read decision for
it is made (an explicitly deferred, separate decision —
`docs/atlas/PHASE3_PROGRESS.md` §2 item 4), this UI's data source can be
swapped from the generated bundle to a live fetch, mirroring exactly how
`repository-source.ts` already swaps between `PUBLIC_REPOSITORY_ENTRIES`
(static) and the live catalog API today. Reversal trigger: if a future
phase decides VQE Registry data should be a distinct, separately-branded
product surface after all (e.g. once real experiment execution in Phase 5
gives it enough independent identity), that is a new ADR, not a silent
un-merge.
