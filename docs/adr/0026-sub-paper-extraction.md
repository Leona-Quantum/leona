# ADR-0026: A component may be extracted from a paper that is about something else

**Date:** 2026-08-13 · **Status:** accepted — in force. **§2 superseded and §1a added the same day
by the owner's ai-ops#58 ruling; §3's locus is now option (a), a structured field, not yet built.**
See *Owner rulings* at the foot.

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

**1. What may be extracted, and in which direction.** A record in the Atlas, or a node on the map,
may name a *component* of a paper — an objective, an encoding, an ansatz, a mixer, a subroutine, a
stopping rule, a discretisation, a readout — regardless of whether the paper is about that
component. The unit of extraction is what the paper *contains*, not what the paper is *for*.

**An extraction narrows a paper's claim. It never widens one.** #51 permits going *finer* than a
paper — "we are frankensteining and **breaking down** papers" — and the owner's own word for the
opposite move is in the same sentence: *"when going at this more granular level it doesn't
**abstract** to unrelated topics."* Generalising is that failure, not a smaller version of the
permitted move. So the test is a direction: draw the boundary of what the paper states and ask
whether the record sits **inside** it. #51 moved the granularity of what may be taken out; it did
not move the boundary.

The case that produced this clause, 2026-08-13: Lucas (arXiv:1302.5843) §3.4 formulates **binary**
integer linear programming, and a Classiq demonstration solves **general-integer** ILP. General ILP
needs a binary expansion of each integer variable before Lucas's formulation applies, and neither
the expansion nor its qubit cost is in Lucas. That is not a smaller piece of Lucas; it is a larger
claim than Lucas makes, and it stays a refusal. The right shipping form is a declaration against
the general record plus a `knownGap` with `reason: "not_stated_in_source"` naming the binary
expansion — which converts "we could not source this" into "here is precisely what is missing".

**2. A claim sits at the level of abstraction the paper stated it at.**
**Superseded 2026-08-13 by the owner's ruling on ai-ops#58** — see *Owner rulings* at the foot of
this ADR for the quote, URL and timestamp. The clause below is his rule; the original text is
recorded there rather than silently rewritten, because it was half right in a way worth keeping
visible.

> Claims are different — they should hold only at the level it is mentioned in the paper. So if a
> paper claims a specific cost for their whole algorithm without individual components, the cost
> claim should exist at the whole algorithm and reference the paper. If the paper mentions cost
> along each of its components as well, then those card should mention the papers claims about
> cost for each of the components it mentions.
> — owner, ai-ops#58, 2026-08-13T04:51:46Z

So the rule is **not** "only what the paper says of the part". It is: **every claim exists, at
exactly the level the paper made it, referencing the paper.**

- A paper stating a cost for its **whole algorithm only** → the cost claim exists **at the whole
  algorithm**, citing that paper. It is not deleted, and it is not pushed down onto a component.
- A paper stating costs **per component** as well → each component's card carries that paper's
  claim **for that component**.
- Neither level may borrow the other's figure. Carrying a whole-algorithm number down onto a part
  remains forbidden, and this is the half of the policy no checker can see once a locus field
  exists to hold the pointer — it is the reviewer's job.

**What this corrects in the original text:** it said the field is "left out or declared as a
`knownGap`" where the paper states no per-component figure. Leaving it out is right *for the
component*; it was wrong to imply the claim disappears. The claim has a home — the level the paper
made it at — and §3.6's rule is untouched either way: *a block may ship with a hole, it may never
ship with a guess in the hole.*

**The exception he named himself, and it is a channel rather than a caveat:**

> Let me know when you come across exceptions — one thing I can think of is a paper claiming
> something about an abstraction/process that doesn't exist on the map yet — but I'm sure there are
> easy ways to fold it in as the whole point of the map is to track what's marked in literature and
> other know sources of scientific information.

A paper making a claim about a level of abstraction the map does not yet carry is **reported to him
on ai-ops**, not resolved by inventing the level or by dropping the claim to the nearest level that
exists. Dropping it would restate the claim at an abstraction the paper never used, which is the
failure this whole clause is about.

**1a. The order a paper is taken in — pipeline, then components, then the joins.**
**Added 2026-08-13 from the owner's ai-ops#58 ruling.** He volunteered this; nobody asked. It is
the most consequential part of that comment because it governs intake for every future paper.

> I think it makes sense to map the pipeline of each paper first. Then see how they can be broken
> into components. Then build the map by connecting components and states that are shared across
> papers. I feel like this is extremely clear, and can make it easy for future papers to add onto
> the map easily, either by integrating into it or by expanding it.
> — owner, ai-ops#58, 2026-08-13T04:51:46Z

Three steps, in order, and the order is the point:

1. **Map the paper's own pipeline first** — end to end, as that paper runs it.
2. **Then break the pipeline into components.**
3. **Then build the map by connecting components and the states shared across papers.**

**Why the order matters rather than being a preference.** Extracting components before mapping the
paper's pipeline is how a component gets recorded at the wrong level of abstraction — you cannot
tell what a piece *is* until you have seen what it sits inside. It is also what makes the map grow
by **shared states** rather than by one author's favourite arrangement, which is R1's whole defence
of the ladder. And it is why the join is step 3: a component that connects to nothing yet is still
correctly recorded, and the map gains the edge when a second paper shares the state.

**Papers that are not a pipeline fold in afterwards**, and he named the kinds:

> Other papers can theory and such, comparative analysis, one-off analysi of specific components.
> These can obviously be folded in after considering which fields they apply to.

A theory paper, a comparative analysis, or a one-off treatment of a single component is not run
through steps 1–2. It is folded in against **which fields it applies to** — which is the same
question §2 answers about level of abstraction, asked of a paper that has no pipeline of its own.

**This pairs with his ai-ops#57 answer** — grow the map, add new top-level regions; *"the nonlinear
odes were just a proof of concept."* So step 3 legitimately produces a **new region**, not only a
new node inside an existing one. R1 is untouched: a paper still never becomes a node, and a region
still has to be a place where genuinely different methods compete.

**2a. When two papers each hold half, neither becomes the record's `source`.** The commonest shape
this doctrine produces: one paper states the *problem* exactly, another states the *method* exactly,
and **no document contains the pair**. No record may claim the pair, because a record's claim is
what some document says.

The resolution is that the two citation sites are not interchangeable. `entry.source` is the
record's *own provenance claim* — it is the whole of what the catalog attestation hashes into
`claim_hash` — so naming a paper there asserts *this record documents that work*. `literature[]` is
a work the record draws on. A paper holding one half goes in `literature[]` with its locus, and the
demonstration itself stays a declaration against the general record, per #42 option (b).

The case, 2026-08-13: a Classiq demonstration solves Max k-Vertex Cover with QAOA. Manurangsi
(arXiv:1810.03792) states that problem exactly — objective and cardinality constraint, in the
abstract's first sentence — and is **entirely classical**: FPT approximation scheme, approximate
kernelization, an SDP-based 0.92-approximation, no quantum algorithm anywhere. Farhi states QAOA
exactly. Putting Manurangsi in `source` would assert the record documents Manurangsi's work, which
is false; leaving it out entirely would let a later session reach for Lucas's Vertex Cover section,
which is a *different problem* (minimise the cover, not maximise coverage under a budget of k). So:
register it, cite it for the problem statement, keep the demonstration a declaration.

**A half also does not earn a record of its own**, and the reason is mechanical rather than
editorial: a corpus record must resolve to a `role` through `FAMILY_RULES` (`topics.ts`), and for a
classical problem statement every honest option is wrong. `algorithm-reference` would assert an
algorithm described at reference depth — Manurangsi's algorithms are classical and are not what the
record is about — and inventing a family for "classical combinatorial problem statement" tells a
browsing reader the corpus has a category it does not have. A first-class home for problem
statements is the ingredient shelf (ai-ops#41 option B), which is not built; until it is, the
citation is the home.

**3. The evidence a sub-paper extraction needs.**

- **A document that contains it.** `source.url` and every `literature[].url` resolve to a row of
  `apps/web/lib/repository/paper-register.ts`, already enforced by
  `scripts/check-paper-register.mjs` for any arXiv- or DOI-shaped address. Textbooks are primary
  sources (#44); a textbook with a DOI registers like any other row, and Nielsen & Chuang
  (`doi:10.1017/cbo9780511976667`) already does.
- **A locus, and the owner has ruled it becomes a structured field.** It names *where in the paper
  the component is* — a section, figure, equation, table or named subroutine — not merely that the
  paper is relevant. The repo already holds this rule three times for other fields and it is the
  same rule: `MethodExampleRun.at` (`layers.ts`, enforced at the message *"a whole paper is not a
  run"*), `SlotClosure.sourceLocus` (ADR-0025), and G1's `locator`, which is a section number
  **and** a short verbatim quote.

  **He picked option (a) on ai-ops#58** — *"let's go with the first option"* — which is the strict
  reading **with the locus as its own field on `PublicRepositoryCitation`, so a checker can require
  it**. Until that field exists the locus goes in the `relevance` prose, which is what every record
  authored to date does and what keeps them correct under the new rule rather than needing rework.

  **What building it costs, so whoever picks it up has the number in front of them and does not
  discover it mid-PR.** Not started, deliberately:
  - It changes the **shape of every published record**. `PublicRepositoryCitation` is inside the
    `record` blob the public catalog serves, re-validated in TypeScript on every request.
  - It is therefore a **two-part deploy**, the pattern `papers.ts` already describes for the
    citation normalisation it is waiting on: ship the field optional and backfill, then require it.
    Requiring it in one step refuses every record authored before it existed.
  - It touches the **API list projection allowlist** and **both `from-catalog.ts` guards** — a
    field missing from either is dropped silently, in production only, against a healthy API. That
    is the failure `topics` and `knownGaps` both hit.
  - It moves each edited record's `evidence_hash` but **not** its `claim_hash`, which is sha256
    over the `source` object alone (`catalog_attestation.py:77-88`), so the existing grants carry
    forward and **no re-signature is needed**. This is the one part that is cheaper than it looks.
  - Every record's citations then need a locus authored, which is a **content pass over the
    corpus**, not a schema change with a migration at the end of it. That is the real cost.
- **A declaration when the extraction is shared.** Where `DECLARED_SHARED_SOURCES` applies (see 5),
  the URL and its exact slug set are written down with the reason.
- **A notebook is a program; its prose is a cover letter.** Where a demonstration ships code, the
  code is the authoritative text and the markdown is not. Three Classiq rows were recorded as
  unsourceable on a markdown-only read and all three were released by opening the code cells at
  pinned commit `ac61dccb` (lane 4, 2026-08-13): `chemistry/second_quantized_hamiltonian` has one
  markdown cell — a title — and **seven code cells** building an OpenFermion Hamiltonian, mapping it
  with `FermionToQubitMapper`, constructing a `full_hea` ansatz and calling `es.minimize`, which is
  VQE with a hardware-efficient ansatz; `CFD/double_slit_experiment` publishes no bibliography at all
  and imports `qsvt_phases` to solve its system by QSVT matrix inversion; `CFD/QLS_for_hybrid_solvers`
  was judged on one of its four notebooks, and the other three are titled for QSVT and for LCU of
  Chebyshev polynomials. This is the same shape as the rule that a cited constant is checked by
  grepping the paper for the distinctive *word* rather than the number, and the same shape as the
  clause below: **in each case the authoritative text is the one that does the work, not the one that
  describes it.** A record may not be refused for want of a source until what the thing actually does
  has been read.
- **A reference list is never inherited.** Every reference that enters the register or a citation is
  opened and confirmed to be the paper it is labelled as. This is not a general caution; it is a
  measurement. Reading the 13 Classiq notebooks of the #42 batch first-hand at pinned commit
  `ac61dccb` (lane 4, 2026-08-13) found that **six publish no references cell at all**, **three**
  print a citation marker against an anchor that does not exist, **six cite the CVaR paper** — which
  is not a QAOA reference — and **3 of 13 carry a broken or wrong reference**:
  `minimum_dominating_set`'s `[1]` is labelled "Dominating Set (Wikipedia)" and points at
  `wiki/Partition_problem`; `integer_linear_programming` cites `#ILP` against an anchor spelled
  `id='MVC'`, copy-paste residue from the neighbouring notebook; `electric_grid_optimization` cites
  `#OpPwer` against `id='OpPower'`. The first of those is the exact failure `papers.ts` was built
  for — a citation naming a different, real work — arriving from a new direction.
  **This sharpens #42 rather than contradicting it.** "Reputable source (like classiq library)" is a
  claim about the *implementation*: it runs, it is maintained, it is used. None of that is evidence
  about a hyperlink somebody pasted into a markdown cell.

  **Those figures are the script-measured ones, and an earlier hand tally of the same batch was
  wrong** — it said five, two and eight where a script over the pinned notebooks says six, three and
  six. The hand tally was made while reading, which is exactly the condition under which this ADR
  says not to trust a count. Recorded rather than silently replaced, because the correction is the
  clause working on itself.

  **And a citation count concludes the opposite of the truth on this batch.** Six notebooks cite the
  CVaR paper (arXiv:1907.04769) and **none uses a CVaR objective**: only two expose the parameter and
  both pin it to `alpha_cvar = 1`, the degenerate value at which CVaR *is* the plain expectation
  value. Reading only the bibliography would have recorded six CVaR implementations that do not
  exist. Note also that grepping for `alpha` hits eight of the thirteen and means CVaR in none of
  them — it is matplotlib's plot transparency. A token that looks like evidence.
- **An encyclopedia article is not a source.** ai-ops#12 settled that a directory entry is not a
  source; a Wikipedia link is the same shape and does not belong in `literature[]`. A demonstration
  whose only reference is one has **no** per-problem primary source, which is a different and more
  honest state than a weak one.

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

## Owner rulings

**ai-ops#58, 2026-08-13T04:51:46Z — answered the question this ADR was opened with, and two things
it did not ask.** Quoted in full because the shape matters; the clauses above cite it by section.

> I think it makes sense to map the pipeline of each paper first. Then see how they can be broken
> into components. Then build the map by connecting components and states that are shared across
> papers. I feel like this is extremely clear, and can make it easy for future papers to add onto
> the map easily, either by integrating into it or by expanding it.
>
> Other papers can theory and such, comparative analysis, one-off analysi of specific components.
> These can obviously be folded in after considering which fields they apply to.
>
> Claims are different- they should hold only at the level it is mentioned in the paper. So if a
> paper claims a specific cost for their whole algorithm without individual components, the cost
> claim should exist at the whole algorithm and reference the paper. If the paper mentions cost
> along each of its components as well, then those card should mention the papers claims about cost
> for each of the components it mentions. So let's go with the first option, with the clarification
> that whole-algorithm claims or more general claims can still exist in the map- but only at that
> same level of abstraction. Let me know when you come across exceptions- one thing I can think of
> is a paper claiming something about an abstraction/process that doesn't exist on the map yet- but
> I'm sure there are easy ways to fold it in as the whole point of the map is to track what's
> marked in literature and other know sources of scientific information.

What it settled, in the order it appears: **§1a** the intake order (pipeline → components → joins,
with non-pipeline papers folded in by which fields they apply to); **§2** claims sit at the level of
abstraction the paper stated them at, and the exception channel; **§3** option (a) — the locus
becomes a structured field.

**What §2 said before it was superseded**, kept because it was half right and the half that was
wrong is instructive: *"It may **not** carry down a figure the paper states only for its whole
algorithm … Where the paper does not state the figure for the component itself, the field is left
out or declared as a `knownGap`."* The refusal to carry a figure downward survives. What did not is
the implication that the claim then has nowhere to go — his rule gives it a home at the level the
paper made it, which is more permissive **and** more precise than the conservative default this ADR
shipped with.

**ai-ops#57, same day — grow the map.** New top-level regions are in scope; *"the nonlinear odes
were just a proof of concept."* Recorded here because §1a's third step now legitimately produces a
region rather than only a node. R1 is untouched: a paper still never becomes a node, and a region
still has to be a place where genuinely different methods compete.

**Settled without him, under rulings he had already given** (his queue was at its working maximum):
whether a reputable vendor library is a source of record — #42 option (b) answers it, the paper is
the source and the notebook is the demonstration; and the three clauses in §1, §2a and §3 that came
out of lane 4's first real cases.
