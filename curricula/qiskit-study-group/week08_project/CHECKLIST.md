# Week 08 team self-evaluation

Complete this together after your demo. It is for your team, not for anyone to grade —
the point is noticing what actually happened during the project, not checking boxes
for their own sake.

Our team built: ______________________________ (`random_bits` / `bell_certifier` /
`grover_3q`)

## Process

- [ ] We picked a template within the first 10 minutes and did not spend more than
      that deciding.
- [ ] Every milestone's prediction was written down *before* running the cell it asked
      about, not filled in afterward to match the result.
- [ ] We read the scaffold code before extending it, rather than deleting it and
      starting over.
- [ ] Every `role=checkpoint` cell in our template passed without editing the assertion
      itself to force a pass.
- [ ] We compared our finished notebook against the matching `reference/*.nb.py` file
      and can point to at least one place our approach differed.

## The one modification

- [ ] We chose one modification beyond the milestones and can state, in one sentence,
      what we changed.
- [ ] We ran it and observed what actually happened — including if it made the
      checkpoint fail, which is itself a valid and useful outcome to report.
- [ ] Every team member can explain *why* the modification changed the result, not
      just *that* it did.

## Template-specific checks

Fill in only the section for the template you built.

**`random_bits`**
- [ ] The bias checkpoint passed (fraction of 1s between 0.40 and 0.60 on 500 bits).
- [ ] The runs checkpoint passed (|z| under 3.5).
- [ ] Everyone on the team can explain, without looking it up, why the simulator's
      randomness being a seeded PRNG does not make this exercise pointless.

**`bell_certifier`**
- [ ] Both the ZZ and XX correlation checkpoints passed (each above 0.9).
- [ ] The non-entangled control checkpoint passed (correlation near 0, below 0.3 in
      magnitude).
- [ ] Everyone on the team can explain why checking two bases is stronger evidence than
      checking one.

**`grover_3q`**
- [ ] The local (non-transpiled) checkpoint passed — the marked state was the most
      common outcome, above 0.7 of shots.
- [ ] The transpile checkpoint passed — the ISA circuit was deeper than the ideal
      circuit and used only instructions in the target's basis.
- [ ] The iteration-count checkpoint passed, and the team can state in their own words
      why more iterations is not always better.

## Demo

- [ ] We stayed within the demo's 2-3 minute budget.
- [ ] We showed the checkpoint passing live, not a screenshot or a description of a
      prior run.
- [ ] We stated at least one prediction before showing the result it was about.

One remaining question, as a team: _______________________________________________
