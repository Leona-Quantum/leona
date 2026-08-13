# ADRs

Seed list: ADR-0001..0012 correspond to AD-1..AD-12 in
`~/Documents/Projects/Majorana/plans/archive/rebuild/02-architecture.md` — written out
in Phase 0 step 5. New decisions: copy `0000-template.md`, number sequentially.
An architecture choice without an ADR is undocumented and non-compliant — it still
shipped, it just answers "why" from nowhere. The list under **Decisions with no ADR**
below is the current backlog of exactly that.

**A superseded ADR stays where it is.** It keeps its number and its text and gains a
`superseded-by-NNNN` status line; it is never moved, rewritten or archived. The point
of the file is that the reasoning stays readable after the decision is reversed.

**A status line is part of the decision.** "accepted for implementation" and
"implemented" are different claims about production, and a reader has no other way to
tell "proposed and never built" from "proposed and fully shipped". Both existed in this
directory simultaneously until 2026-08-04. Update the status in the same PR that ships
the work.

## Index

| # | Decision | Status |
|---|---|---|
| 0001 | Monorepo (pnpm/turbo + uv workspace, one repo) | accepted — in force |
| 0002 | Python backend; FastAPI is the only database caller | accepted — in force |
| 0003 | Neon Postgres (not Supabase) | **superseded by 0024** (2026-07-27) |
| 0004 | App-layer authz; scope-first repository layer | accepted — in force |
| 0005 | WorkOS AuthKit | accepted — in force |
| 0006 | Vercel sandbox, deny-all egress | accepted — in force |
| 0007 | Postgres jobs queue | accepted — extended by 0021 |
| 0008 | Generated contracts package | accepted — in force |
| 0009 | LLM wrapper (anthropic / openai / deepseek) | accepted — in force |
| 0010 | Observability: OTel + Sentry | accepted — in force |
| 0011 | Deploys: web on Vercel, api+worker on Cloud Run gen2 | accepted — **preview clause amended 2026-08-04** |
| 0012 | Staged posture, phases 0–4 | accepted — phases complete |
| 0013 | Framework-native circuit source is authoritative | accepted — in force |
| 0014 | Durable circuit tool loop | superseded by 0023 |
| 0015 | Seven-framework bounded circuit conversion | accepted — in force |
| 0016 | System catalog authority via server-owned principals | **implemented and deployed** |
| 0017 | Catalog ingestion threat boundary | proposed — **never exercised; no connector built** |
| 0018 | Byte / normalized / semantic fingerprints + evidence | proposed — **2 of 3 hashes built; evidence tables never built** |
| 0019 | Pinned bootstrap manifest through the importer | **implemented** — 283 records imported, attested, published |
| 0020 | Append-only license assertion history | **implemented** — migration 0018 |
| 0021 | Lease-fenced terminal writes; atomic Dead Letter closure | **implemented** — migration 0017 |
| 0022 | Three-state verification + private Studio materialization | **partially implemented; runtime superseded by 0023** |
| 0023 | Fixed nameko-style circuit pipeline | **implemented** — this is the shipping pipeline |
| 0024 | Cloud SQL for PostgreSQL 17 | **implemented** — production since 2026-07-27 |
| 0025 | A closed slot's population is pinned to a citable enumeration | **accepted** — one slot pinned (`linear-ode-solve`) |
| 0026 | Sub-paper extraction: a component may come from a paper about something else | **accepted** — in force |

## Decisions with no ADR

Recorded here so the gap is visible rather than silent. Each one is an architecture
choice that shipped; none has a numbered decision record, and until it does the tree
answers "why" only from runbooks, memory and code comments.

1. **The public catalog read model.** One route, `GET /v1/catalog/entries` (+ `/{slug}`),
   returning `slug + execution_state + updated_at + provenance + record: dict`, where
   `record` is an opaque blob re-validated in TypeScript on every request. There is no
   version list, no source list, no evidence endpoint and no faceted filter — the typed
   surface the platform plan specified was not built. Paired with
   `MAJORANA_PUBLIC_CATALOG_API`, which switches `/repository` between that API and the
   committed static corpus, **with a whole-corpus fallback on any fetch failure**
   (`apps/web/lib/repository-source.ts`). This is the most consequential undocumented
   decision in the tree: it is why a fix committed to the TypeScript corpus does not
   reach the public pages until the manifest is regenerated and re-imported. Documented
   operationally in `docs/runbooks/deploys.md § The public catalog flag`.
2. **WorkOS staging → production environment** (2026-07-29). ADR-0005 chose the vendor,
   not the environment; the cutover changed which issuer every deployed revision trusts,
   and orphaned the accounts provisioned against staging.
3. **Tiers, billing and QPU runs** — `tiers.py`, `routes/billing.py`, `routes/qpu.py`,
   migration `0034_qpu_runs`, and the three `LEONA_*_EMAILS` allowlists that must be set
   identically on api, worker and Vercel.
4. **Workspace sharing, projects and invitations** — migrations `0037_active_workspace`,
   `0038_membership_invitation`, `0041_studio_projects`, `0042_project_shares`,
   `0043_project_artifact_limit`, plus `repos/shares.py` (62.8 KB, the largest
   repository module in the codebase) and `routes/shares.py`.
5. **`execution_state` is written and never read.** Every bootstrapped record stages as
   `template_only` and `PublicCatalogEntry` exposes it as a typed, database-authoritative
   field; `apps/web` never reads it. The badge a visitor sees comes from
   `record.status` inside the blob. The honest field is invisible and the claim-shaped
   field renders — that is a decision, whether or not it was made deliberately.

## Log

- 2026-07-09: Phase 0 CI smoke PR; ADR-0001..0012 written out from the AD seed list.
- 2026-07-15: ADR-0013 makes selected-framework source authoritative and limits
  OpenQASM to optional conversion interchange.
- 2026-07-16: ADR-0014 replaces the fixed circuit pipeline with a durable,
  policy-enforced tool-calling loop and immutable Candidate revisions.
- 2026-07-18: ADR-0015 defines bounded deterministic conversion across seven
  circuit formats, explicit OpenQASM target recipes, and a no-fabrication
  boundary for literature and operator records.
- 2026-07-18: ADR-0016 proposes an isolated system catalog authority and
  anonymous-safe public read boundary.
- 2026-07-18: ADR-0017 proposes allowlisted ingestion, content quarantine, and
  deny-all offline parsing.
- 2026-07-18: ADR-0018 proposes separate byte, normalized, and semantic
  fingerprints with immutable version-bound evidence.
- 2026-07-18: ADR-0019 accepts the pinned 285-record snapshot as an idempotent
  importer bootstrap, never as a migration or runtime data source.
- 2026-07-19: ADR-0019 amended to 283 records; the two community submissions the
  first-party license grant could not reach were removed from the corpus.
- 2026-07-19: ADR-0020 enforces append-only license assertion history in
  PostgreSQL rather than relying on repository convention.
- 2026-07-19: ADR-0021 requires database-clock lease fencing for terminal queue
  writes and one transaction for Dead Letter Run closure.
- 2026-07-23: ADR-0022 proposes three-state verification, evidence-bound retry
  routing, and private unverified Studio materialization with PASS-only Verified/public gates.
- 2026-07-24: ADR-0023 supersedes ADR-0014 for new execute runs with a fixed
  nameko-style circuit pipeline, while retaining Majorana's durable evidence and
  sandbox boundaries. Amended 2026-07-25 to let a Plan declare an independent
  reference check and to make every review name a next step.
- 2026-07-27: **ADR-0024** moves the production database to Cloud SQL for
  PostgreSQL 17 and supersedes ADR-0003. Written retrospectively on 2026-08-04.
- 2026-07-31: Cloud Run revision tags other than `verify` removed as a public-URL
  hazard; ADR-0011's preview clause amended to match (2026-08-04).
- 2026-08-13: **ADR-0026** writes the sourcing doctrine down as one policy for the
  first time: a component may be extracted from a paper whose subject is something
  else (owner, ai-ops#51), reconciled with #44 (textbooks are primary sources),
  #42 (a reputable vendor library's implementations may be kept) and #12 (a record
  may not cite a paper that does not contain what it claims). The enforcement sites
  were read exhaustively first and **no checker had ever encoded paper granularity**
  — the assumption lived in G1's pre-registration prose and in practice. Adds the
  scattered-trace gate to `check-paper-register.mjs` as the checkable half of the
  owner's "does not abstract to unrelated topics".
- 2026-08-04: status-line sweep — 0016/0019/0020/0021/0023 marked implemented, 0022
  marked partially implemented and partially superseded by 0023, 0017 and 0018
  annotated with what was never built, and the no-ADR list above opened.
