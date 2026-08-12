# ADR-0025: A slot is closed against a citable population, not against a curator's judgement

**Date:** 2026-08-12 · **Status:** accepted (one slot closed: `linear-ode-solve`)

**Context:** The layer graph draws a capability's methods as the recorded ways across
it. Nothing in the repository could say whether those ways are *the* ways. `linear-ode-solve`
carried seven methods; the question "seven out of how many?" had no answer, because a
method nobody authored and a method that does not exist are the same absence in a hand-authored
file. Session 119 fixed the drawing half of this slot — the figure had claimed every route
discretises then solves, which three of the seven refute — and gated it. The population half
stayed unmeasured, and the general form of the defect is that a count with no denominator reads
as a total. It cost the linear-ODE family two sessions of the owner reporting a figure that was
wrong in a way no gate could see.

**Decision:** A capability may be declared **closed** by a row in
`apps/web/lib/repository/slot-closure.ts`. Closing it means pinning its population to a
*citable enumeration* — a named place in a named paper, not a curator's list — and giving
every member of that enumeration a disposition: a node the graph carries, or a recorded
absence with a citation and a reason. `auditSlotClosure` then enforces eight rules, of which
the load-bearing one is that **every method the graph records for a closed slot must appear in
its closure**. A method added later fails until someone writes its row, and writing the row is
where the remaining rules — cited, conditioned in both locales, costed or explicitly silent on
a source that was read, routed, drawn on its own slot's figure, linked from it — get asked. The
pin is a floor and not a ceiling: the graph may hold members no enumeration lists (Taylor, Krovi
and Schrödingerisation are all absent from the pinned table for `linear-ode-solve` and all
belong), which is why rule 2 runs from the graph to the pin rather than the other way.

Two rules exist because absence and ignorance render identically. An absent `cost` prints
"nobody stated one" whether or not anybody looked, so a closed slot's node either carries a cost
or carries a `costSilent` row naming the source that was read and found to state none — and
carrying both fails, so the row cannot outlive the gap it explains. A member the graph does not
hold at all carries the paper and the reason it is not authored, so that a hole in the corpus is
one row of a gated record instead of nothing at all.

**Consequences:** Closing the next family is: add a `SlotClosure`, make the gate green. The
gate names what is missing, by method and by field, and keeps naming it. What it costs is that
the enumeration has to be checkable by the next reader the same way — the first closure pinned
An, Childs and Lin's Table 1 rather than the same paper's related-work sentence, because
resolving that sentence's citation numbers through a fetched render gave two contradictory
answers on two passes and one of them invented authors. Prose that only one reader can resolve
is not a pin.

The gate cannot tell you the enumeration is the right one, and it cannot tell you a recorded
absence is honest rather than convenient — a reason is a string, and a string always satisfies a
non-emptiness check. What it can do, and what it is for, is make both of those visible and
attributed instead of absent. Reversal trigger: if a closure's absences outnumber its nodes for
more than a release, the slot is not closed and the row should say so rather than the record
becoming a list of things nobody intends to author.
