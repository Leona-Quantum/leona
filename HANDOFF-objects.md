# Handoff — lane `objects` (session 15)

Written 2026-08-13 at the 5-hour window wind-down. Lane: the object records, the ingredient
shelf, and the object↔state join. Worktree `~/Developer/majorana-wt-objects-s15`.

**Not a project handoff.** One lane of six. The lead owns `STATUS.md`/`NEXT.md`; fold this in
rather than treating it as the session record.

## Shipped

| PR | state | what |
|---|---|---|
| **#505** | merged `7932a99c` | ai-ops#44 ruled on **sourcing**, not the map. The shelf told 30 visitors, in two locales, that the owner had "ruled twice" that gates stay off the map. A quote clipped one clause early turned a citation standard into a map ruling. Guard added, mutation-tested. |
| **#517** | merged `39961b56` | The control deepening pass — 8 of 50 operator records, with the measured cost as the deliverable. |
| **#520** | open, all checks green, awaiting review | The process denominator counts **nodes**, not slots. Doc-only. Carries this handoff. |

`ci` holds **#517 at inconclusive — precondition not met**: it had not deployed at wind-down
(`6d5e1e7f` was the last completed deploy, `731579c2` in flight, `39961b56` queued). That is
the precondition, not a failure. Their four arms are pre-flighted and can each fail.

## The numbers, each measured at a named commit

- **The join is 28/101** — states 12/12, operators 16/62, gates 0/27. Held at `45395f9e`,
  `f563dcb6`, `d48ee503`, `f379b495`, `39961b56` and on four teammate branches, across a
  corpus that grew 346 → 369.
- **Depth census, `check-ingredients.mjs --depth`:** deepened 5 · partial 1 · dissolved 1 ·
  abstract-only 1 · template 42/50.
- **Ordering resolution 2** — every join lands on `prepared-state` or `hamiltonian-access`, so
  the per-row count takes two values and the sort falls through to the slug.

## The four findings that outlive the PRs

1. **Gates are structurally unjoinable**, not merely ruled out. Nothing in the vocabulary is
   *a unitary you can apply*; the contracts name the gate **set** as a parameter. That argument
   survives the owner changing his mind and the ruling-based one does not.
2. **The operator corpus is thin on both sides of the join.** 39 of 46 unjoined *and* 11 of 16
   joined records are one six-field table expanded. **The join is not the axis that matters.**
3. **Map growth does not close the object gap.** Six new states across two lanes moved
   `28/101` by **zero**, measured on every branch. Anyone assuming otherwise now has a
   measurement against it.
4. **Eight of the remaining 42 need no new paper** — five already-registered sources cover
   them, four of which were read end to end during this pass. Candidate mapping, not verified
   per record.

## States pinged and measured (the standing offer, in practice)

Six states pinged before landing, all measured clear — `28/101` unchanged every time, no
abstention falsified:

| state | PR | effect on this lane |
|---|---|---|
| `eigenphase-problem`, `periodic-function-oracle`, `hidden-period` | #514/#515, merged | denominator only, 23 → 25 |
| `pde-problem` | #516, open | denominator 25 → 28 **and** `hamiltonian-access` 3 → 4 — sixteen rows change their numerator |
| `device-figure` | #521, open | denominator only, 25 → 26 |

**`joins`' PDE branch is the one that moves both halves of the row**, via a narrowed *method*
contract on `graph-laplacian-discretization`. `ci` has arms for both halves.

A framing from `regions` worth keeping and worth putting in the memo: `device-figure`
**sharpens** the observable gap rather than weakening it. The vocabulary now distinguishes a
number about the machine from a number about the answer, and still has no state for the
operator you measured — so "there is no state for an observable" is now a narrower, more
answerable request than it was this morning.

## Waiting on people, not on work

- **The owner**, via the lead: the revised ai-ops#41 memo (one question — the process-count
  column, three options; one closure — observables, recommend closing).
- **The lead**: review/merge of #520.
- **`ci`**: read-back of #517 once a deploy carries `39961b56` or later.

## Next concrete step

**Confirm the eight records that need no new paper**, in this order — the reading is done, so
this is confirmation rather than research:

```
Bravyi & Kitaev 2002  quant-ph/0003137  -> jordan-wigner-creation, jordan-wigner-hopping, parity-mapping
Liu et al 2007        quant-ph/0609125  -> two-rdm
Bravyi et al 2017     1701.08213        -> z2-symmetry-generator, fermion-parity
Pfeuty 1970           10.1016/0003-4916(70)90270-8 -> transverse-field-ising
Grimsley et al        1812.11173        -> energy-gradient-commutator
```

Confirm each paper contains each object before citing it. **Do not extrapolate the 12.5%
dissolution rate** — the eight were a deliberate spread front-loaded with named constructs;
the remaining 42 look like ~25 named things and ~17 generic primitives, so expect nearer 40%.

## Two traps this lane hit, both now memories

- **`replaceLegacyBrand` rewrites `Majorana` → `Leona Quantum`** in unexempted record fields.
  It never shipped — `check-paper-register.mjs` refused the build — and an earlier version of
  this note and of #517's body said it did. Corrected. Whether that rewrite should run at all
  against a physics corpus is an open owner question.
- **`turbo run lint typecheck test` reports a typecheck failure as `cancelled N` tests.**
  Read the task list before the test summary.

## Standing offer, please keep it alive

`regions` and `joins` ping before adding a state; I re-measure rather than predict. **The value
turned out not to be in the re-measures** — all six were clear. It was in the questions: `joins`
asking about `producedStates` made me re-read a claim of mine that would have gone silently
false on their merge, and it took someone outside the file to see a sentence I had stopped
seeing. **A stale abstention is a published claim that we document something we do not.** Worth
a two-minute re-run every time.
