# UI references — competitor surfaces we looked at

Moved into the repo from `plans/ui-reference-coda.md`, whose own closing instruction was
"move into repo `docs/ui/` when the UI domain opens." It has.

Product names are updated to current vocabulary (the agent is **Nala**, the surfaces are
**Run**, **Studio** and the public **Atlas** catalog); the observations themselves are left
as recorded. A **Status** line after each takeaway says what we actually did — every one
re-verified against `dev` @ `f42536a` on 2026-08-05, with the file it was checked in named
so the next reader can re-check rather than trust.

---

## Coda (Conductor Quantum)

**Observed:** 2026-07-11, from coda.conductorquantum.com and the conductorquantum.com
marketing page. **Why:** owner directive — "Coda/Conductor Quantum … really strong
reference for [our] UI". This is a point-in-time observation of a competitor's product and
may have changed; re-look before treating any detail as current.

### What Coda is (their framing)

Natural-language interface for quantum computing: "Describe what you want to do,
and Coda generates the quantum program, executes it, and returns the results."
Sits on NVIDIA cuQuantum/CUDA-Q simulation + real hardware (IonQ, Rigetti). Free
tier exists; a guest can open the app immediately. The closest competitor-shaped
reference we have.

### The surface (observed, signed-out-ish session)

- **Zero-friction entry:** the app URL opens straight into the prompt surface —
  no login wall. Centered headline "What would you like to build?", one prompt
  box, send button.
- **Mode selector inside the prompt box:** a small dropdown with exactly two
  modes — **Learn** (grad-cap icon) and **Build** (hammer icon). Maps to our
  Explain/Execute; our third mode (Ideate) is a differentiator — especially the
  owner's "Ideate can analyze a circuit you bring" idea, which Coda has no
  equivalent of.
- **Suggestion chips under the box:** "Implement the quantum Fourier transform",
  "Build a quantum phase estimation circuit", "Create a VQE circuit for H2
  molecule" — literally our eval-corpus families. Also an animated typing
  placeholder cycling example prompts, and "Tab to complete prompt".
- **Left rail, icon-only, 5 items:** New chat (+) · Chats (history list with
  relative timestamps) · **Circuits** (`</>`) · **QPU Jobs** (chip) · Account
  (bottom).
- **Circuits panel** = a personal circuit library in the rail: search box,
  "New Circuit" button, named entries (e.g. `grover_4qubit_1010`, "2d"). This is
  our artifact list in the rail, but code-artifact-only. Ours adds provenance
  facets, verification records, and the Studio bridge — the moat.
- **QPU Jobs panel** = job history with status icons (green check), searchable.
  Our runs list should read like this: one rail entry, status at a glance, search.
- **Visual language:** near-black background, single warm accent color (orange
  send button), generous empty center, everything secondary tucked into the
  rail. The product IS the prompt box.

### Takeaways, and what we did

1. **Prompt-first, library-in-the-rail layout works; adopt the shape** — center prompt +
   mode selector in-box + suggestion chips seeded from our corpus families.
   **Status: adopted.** `/run` is a composer with example prompts and a persistent
   collapsible sidebar of recent runs and chats
   (`apps/web/components/run-composer.tsx`, `apps/web/components/shell.tsx`). Their
   "Tab to complete prompt" is adopted too — `useGhostPrompt` offers a ghost suggestion
   that Tab accepts, and still offers it under `prefers-reduced-motion`.
2. **Mode dropdown in the composer** (not tabs or pages) for Execute/Ideate/Explain.
   **Status: adopted**, with the labels "Execute", "Learn", "Explain" (`copy.md`; the
   internal compatibility value `ideate` is never rendered).
3. **Keep entry to the composer unauthenticated; gate at run.**
   **Status: NOT adopted.** `apps/web/middleware.ts` is secure-by-default and `/run` is not
   in `PUBLIC_PATHS` — the composer requires an AuthKit session. The public surface is the
   landing page, `/workspace` and `/open-source` (marketing), `/pricing`, `/contact`,
   `/repository` (Atlas) and the legal routes, plus the auth callbacks.
   `/demo` is the one guest-shaped surface and it is **not a counter-example**:
   `isPublicDemoEnabled()` requires `MAJORANA_PUBLIC_DEMO=true` *and* a preview or
   development environment, so it is never public on production.
   The guest-taster tier this recommendation leaned on is not present in the shipped tier
   ladder either — `tiers.py` is `free / pro / team / developer`, and the doc that decided
   the taster has been archived. If unauthenticated entry is wanted, it is a new decision,
   not a resumption of this one.
4. **Rail panels:** Chats · artifact list (richer than their Circuits: provenance facets,
   verified badge, publish/open actions) · Runs (their QPU Jobs, plus the verifier decision
   at a glance) · Account.
   **Status: partly adopted.** The sidebar carries the Run/Studio surface switch, new chat,
   recent chat links, Folders, Projects, an artifact list, Settings and workspace identity.
   The panel that does **not** exist is the one Coda's QPU Jobs maps to: there is no Runs
   list with the verifier decision at a glance. That half is still open — the sidebar keys
   in `apps/web/lib/workspace-locale.ts` are the place it would be added.
5. **Where we visibly differ:** verification evidence surfaced on every result (tier +
   what-was-proven language from `docs/verification/`), classical baseline comparison, and
   export status — Coda shows none of that in the shell.
   **Status: adopted and shipped.** `packages/ts/ui/src/run-outcome.tsx` and Studio's
   `VerificationSummaryPanel` are the surfaces that carry it.
