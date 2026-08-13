# ADR-0026: A component may be extracted from a paper that is about something else

**Date:** 2026-08-13 · **Status:** accepted — in force

**Context:** Four owner rulings on `EshMis/ai-ops` say the same thing from four directions and
have never been written down as one policy, so each has been applied by whoever happened to
remember it.

The one that forced this ADR is #51 (2026-08-13T03:59:34Z):

> BIG: a whole paper doesn't need to be dedicated to a specific thing for it to exist!! A paper
> that has a full implementation will describe methods across many different processes in the
> workflow — we are frankensteining and breaking down papers to fill this map in at a more
> granular level!! […] however even something small like an objective can be gleaned from a
> paper and put where it fits, even if it isn't the point of the whole paper! The only important
> thing is that we know that the paper is actually relevant to the topic at hand, and that when
> going at this more granular level it doesn't abstract to unrelated topics. […] We are
> synthesizing all of literature so it all fits together, not being limited by things only at
> the paper-granularity level!

The three it has to be reconciled with: **#44** — *"textbooks are also primary sources"*, and
specific implementations *"we can verify them through simulation, math, by reliability of the
source, and of course give them to me to check on case-by-case basis for unsurities"*; **#42** —
implementations from a reputable source *"like classiq library"* are *"okay to keep"*, and *"13
different implementations of the same method […] is kind of where we want to be for everything"*;
and **#12** — a record may not cite a paper that does not contain the method it claims.

**The finding that shaped this ADR: paper granularity was never a rule.** The enforcement sites
were read exhaustively on 2026-08-13 and not one checker refuses a sub-paper extraction. The
assumption lived in two places, both prose: `docs/gates/G1-preregistration.md` §3
(*"One six-role block record per paper"*) and the practice of whoever was authoring. The map has
been doing the opposite for months without anyone writing it down — **31 of the 117 papers the map
cites are cited by more than one node**, and `cvar-objective` and `variance-objective` are already
nodes for objectives lifted out of papers that are about something else.

So this ADR is not a repeal. It is the first written statement of a rule the checkers were already
silent about, plus the two guards the silence left missing.

**Decision:**

**1. What may be extracted.** A record in the Atlas, or a node on the map, may name a *component*
of a paper — an objective, an encoding, an ansatz, a mixer, a subroutine, a stopping rule, a
discretisation, a readout — regardless of whether the paper is about that component. The unit of
extraction is what the paper *contains*, not what the paper is *for*.

**2. What a sub-paper extraction may claim, and what it may not.** It may claim the component's
definition or construction as the paper states it; any property the paper states **of the
component**; and that this paper uses it, in the setting it uses it. It may **not** carry down a
figure the paper states only for its whole algorithm — a complexity, a qubit count, a depth, an
error bound, a speedup. Those are claims about the assembled pipeline and are not properties of a
part of it. Where the paper does not state the figure for the component itself, the field is left
out or declared as a `knownGap`; §3.6's rule is untouched — *a block may ship with a hole, it may
never ship with a guess in the hole.* This is the half of the policy a checker cannot see, and it
is the reviewer's job.

**3. The evidence a sub-paper extraction needs.**

- **A document that contains it.** `source.url` and every `literature[].url` resolve to a row of
  `apps/web/lib/repository/paper-register.ts`, already enforced by
  `scripts/check-paper-register.mjs` for any arXiv- or DOI-shaped address. Textbooks are primary
  sources (#44); a textbook with a DOI registers like any other row, and Nielsen & Chuang
  (`doi:10.1017/cbo9780511976667`) already does.
- **A locus.** The `relevance` prose names *where in the paper the component is* — a section,
  figure, equation, table or named subroutine — not merely that the paper is relevant. The repo
  already holds this rule three times for other fields and it is the same rule:
  `MethodExampleRun.at` (`layers.ts`, enforced at the message *"a whole paper is not a run"*),
  `SlotClosure.sourceLocus` (ADR-0025), and G1's `locator`, which is a section number **and** a
  short verbatim quote. There is no structured locus field on `PublicRepositoryCitation` today
  and this ADR does not add one — see *Open* below.
- **A declaration when the extraction is shared.** Where `DECLARED_SHARED_SOURCES` applies (see 5),
  the URL and its exact slug set are written down with the reason.

**4. "Relevant to the topic" and "does not abstract to unrelated topics", in checkable terms.**
The owner's two conditions are one machine-checkable rule and one reviewer rule, and this ADR is
explicit about which is which.

- **Checkable — the paper's map trace may not be `scattered`.** `paper-traces.ts` already
  classifies each cited paper as `point`, `contiguous`, `joinable` or `scattered`, over the
  undirected graph of `realizes` / `steps` / `refines`. `scattered` means the citing nodes fall in
  **different connected components of the map**: no chain of realisation or containment joins the
  places this one paper has been used. That is exactly "it abstracted to an unrelated topic",
  stated as a property of the graph rather than as an opinion. As of 2026-08-13 the map has **three
  connected components** (99 / 13 / 5 nodes: the algorithms cluster, compilation-and-QEC, and error
  mitigation), so the shape is reachable, and **0 of 117 cited papers are scattered** — the gate is
  armed on a clean board rather than grandfathering a backlog. A scattered trace now fails
  `scripts/check-paper-register.mjs` unless the paper is listed in `DECLARED_SCATTERED_PAPERS` with
  a written reason; that list is stale-proof in both directions, so a declaration that stops being
  true fails as loudly as an undeclared scatter.
- **Reviewer's, and named as such.** Whether the extracted component is the thing the paper's
  sentence actually names. No graph property can see a record that reads a paper's remark about
  someone else's method as that paper's own contribution. #12 is the standing rule for it and is
  not weakened here: a record may not cite a paper that does not contain the method it claims.
  The fix for "cited to Farhi for a problem Farhi never formulates" is still a declaration against
  a general record, never a new record.

**5. What still fails, unchanged.**

- **#12.** As above.
- **R1, "a paper is never a node"** (`plans/leona-map-scaling-rules.md` §2). A component earns an
  Atlas *record* on the strength of a paper containing it. It earns a *map node* only when it is a
  way of filling a slot no recorded method already covers, and only where `whyALayer` has an honest
  sentence naming the methods that compete for that slot — the test that keeps every slot at ≥2
  methods. **#51 widens what may be extracted; it does not widen what earns a node.** The owner said
  so in the same comment: *"we can put specifications in the labels rather than another item on the
  map: something like 'penalty objective'."*
- **The map's two single-entry tuples.** `MAP_ELIGIBLE_ROLES` (`algorithm-reference` only) and
  `MAP_CITABLE_SOURCE_KINDS` (`curated_reference` only) were ruled on directly by the owner in
  ai-ops#14 and are untouched by #51. Widening either stays a question for him.
- **`FAMILY_RULES` exhaustiveness** (`topics.ts`). A component authored under a new
  `algorithmFamily` string with no rule produces a record with no `role` and fails
  `check-repository-data.mjs`. That friction is deliberate and stays: it is what makes adding a new
  kind of thing a decision somebody makes rather than a silent gap.
- **ADR-0020** (append-only `license_assertions`) and **ADR-0022/0023** (PASS / FAIL /
  INCONCLUSIVE; a run that happened is not a verification). #44's *"we can verify them through
  simulation, math, by reliability of the source"* is a statement about **which sources may be
  kept**, and is not licence to write `verified` for anything. Nothing in this ADR changes how a
  record's `status` or a `VerifierDecision` is set.

**Consequences:** What this buys — the four rulings become one readable policy with two of its four
clauses enforced by a build rather than by memory; the map's existing practice (31 papers cited from
more than one node) stops being undocumented; and lanes authoring records under #51 have a bar they
can meet without asking. What it costs — one more gate on `check-paper-register.mjs`, and a
declaration list that has to be maintained honestly; and the whole-algorithm-claim rule in (2)
remains reviewer-enforced, which is the weakest clause here and is stated as such rather than
dressed up. **Reversal trigger:** if `DECLARED_SCATTERED_PAPERS` grows past a handful of entries,
the scatter gate is measuring the map's disconnection rather than an extraction's drift, and the
right fix is the map's missing edges — revisit this ADR rather than keep extending the list.

**Open, and with the owner rather than settled here** (one consolidated question, ai-ops):
whether a sub-paper extraction needs a **structured** locus field rather than prose; whether a
vendor library (#42's Classiq case) is a source of record in its own right or only permission to
keep an entry whose method is sourced elsewhere; and whether an extracted component may ever carry
a complexity the paper states only for the whole algorithm — (2) above is the conservative default
until he rules, chosen because a record built that way stays correct under either answer.
