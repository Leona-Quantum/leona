# ADR-0025: A closed slot's population is pinned to a citable enumeration

**Date:** 2026-08-12 · **Status:** accepted (one slot pinned: `linear-ode-solve`)

**Context:** Closing a region already has two instruments and they are good ones.
`regionClosure` (#409) measures a region's fields — summary, conditions, cost, citations,
pseudocode, worked runs — and `absences` (#452) lets a method declare, in both locales, why
one of those is empty, so that a gap somebody read the sources to establish stops being
indistinguishable from a gap nobody looked at. The linear-ODE region reads `closed 7/7 fields`
on that instrument, and the ratchet in `repository-layers.test.ts` holds it there.

Both measure the methods that **exist**. Neither can say whether the set is the right set.
`methodsRealizing(graph, "linear-ode-solve")` returns seven and says nothing about what seven is
out of, and a count with no denominator reads as a total. This is the same defect `absences`
fixed one level down — a method nobody authored and a method that does not exist are the same
absence — still open one level up. It is not hypothetical here: measured against the atlas's own
primary source for this slot, two members of the recorded literature have no node, and one of
them is the primary source of a corpus record the graph already anchors to that very slot.

**Decision:** A capability may have its population pinned by a row in
`apps/web/lib/repository/slot-closure.ts`: a paper, a **place in that paper**, and a disposition
for every member — a node the graph carries, or an absence with its own citation and a reason.
`auditSlotClosure` enforces the pin's integrity, and the load-bearing rule runs from the graph to
the pin: **every method the graph records for the slot must appear in the closure.** An eighth
method fails until somebody writes its row, and writing one is the only occasion on which anybody
is made to re-read the enumeration. An absence must also be really absent — if a method of the
slot already cites its paper, the row has outlived the gap it records and fails.

The pin is a **floor and not a ceiling**. The graph may hold members the enumeration does not, and
for `linear-ode-solve` three of the seven are exactly that. What an enumeration is for is the
other direction: the member the curator did not think of.

Nothing about a method's *fields* is checked here. Those are `regionClosure`'s, and duplicating
them would be a rule written twice that will eventually disagree with itself.

**Consequences:** Closing the next family is: add a `SlotClosure`, make its gate green, add the
slot to the region ratchet. The two absences on the first pin are now named, cited, reasoned and
un-forgettable, where before they were nothing at all.

The cost is that the enumeration has to be checkable by the next reader the same way. This first
pin names Table 1 of arXiv:2312.03916 rather than the same paper's related-work sentence, because
resolving that sentence's citation numbers through a fetched render gave two contradictory answers
on two passes and one of them invented authors. Prose only one reader can resolve is not a pin.

What this cannot do: it cannot tell you the enumeration is the right one, and it cannot tell you a
recorded absence is honest rather than convenient — a reason is a string, and a string satisfies a
non-emptiness check. It makes both visible and attributed instead of absent, which is the same
bargain `absences` struck one level down and for the same stated reason. Reversal trigger: if a
pin's absences outnumber its nodes for more than a release, the slot is not closed and the record
should say so rather than becoming a list of things nobody intends to author.
