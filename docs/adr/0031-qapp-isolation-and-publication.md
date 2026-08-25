# ADR-0031: Generated Qapp UI and quantum execution use separate isolation boundaries

**Date:** 2026-08-23 · **Status:** accepted 2026-08-25 (owner ruling, ai-ops#177 — option 1:
Qapps and the public `/q` gallery ship, "while making as many safety patches as possible so that
nothing is unsafe or can cause extensive costs back to me"). The two paragraphs that ruling
required changes to — the browser residual risk and the execution ceiling — are updated in place
below and marked.

**Context:** Qapp mode turns a prompt, or a stored Studio circuit, into an interactive quantum
application. Its interface must be authored dynamically by the model rather than selected from a
fixed UI template, it must be usable privately, and its creator may explicitly publish it. This
introduces two independent untrusted programs: browser HTML/JavaScript and Python quantum source.
Treating either as ordinary application code would give generated content Leona's origin, session,
network, or control-plane authority.

**Decision:** persist Qapps, immutable Qapp versions, and Qapp executions as their own domain. A run
in `qapp` mode produces exactly one private Qapp version. A Studio conversion binds the exact source
artifact version as provenance. Publication changes visibility explicitly; generation never does.

The generated browser document is free-form HTML, CSS, and JavaScript, but runs only in an iframe
with `sandbox="allow-scripts"` and no `allow-same-origin`. Leona injects a Content Security Policy
that denies subresource network requests, frames, workers, objects, and form destinations. Before
storage, a separate document guard rejects direct URL-bearing elements and attributes plus browser
network, storage, parent-document, and navigation APIs. The generated UI has one intended
capability: `window.qapp.run(inputs)`, implemented by a typed `postMessage` bridge. The parent
verifies the source window, channel, shape, and byte limit before calling an authenticated BFF
route. Only one request may be in flight per frame.

This browser boundary is deliberately not described as equivalent to the execution sandbox. The
iframe sandbox blocks top-level navigation, popups, forms, same-origin state, and parent DOM access,
while CSP blocks ordinary fetch/subresource channels. Current browser CSP does not provide a
portable `navigate-to` control, so self-navigation cannot be *prevented* by policy.

**Updated 2026-08-25, under the ai-ops#177 ruling.** A runtime tripwire in the host was built for
this channel and then **withdrawn before merge**, because it cannot be made correct. It is recorded
here rather than deleted, so that the next person to have the idea finds the reason and not just the
absence.

The design: the bridge, which runs first in a document Leona authors, announces itself; a frame
`load` event arriving after that announcement is a second document, and the host unmounts the frame.
The flaw is that the host cannot attribute a `load` event to a document. The frame's origin is opaque
both before and after a navigation, and the WindowProxy identity survives a cross-document navigation,
so there is nothing to compare. That collapses four orderings into two observations:

| | what the host sees | required |
|---|---|---|
| legitimate, announcement delivered before the load event | announcement, then load | keep |
| legitimate, load event before the announcement is delivered | load, no announcement yet | keep |
| hostile, navigates after its own document loaded | announcement, then load | tear down |
| hostile, navigates before its own document loaded | load, no announcement yet | tear down |

Rows 1 and 3 are the same observation, and so are rows 2 and 4. Any rule that tears down a frame that
navigated before its own load also tears down a legitimate Qapp whose announcement has not arrived —
and since the bridge posts during parsing while the load event fires after it, the *legitimate*
ordering is the one that puts the announcement first. The tripwire as written would have torn down
every working Qapp. A liveness heartbeat is the only shape that escapes the ambiguity, and its false
positive is a frame whose main thread is busy — a Qapp doing heavy canvas work — which is a worse
failure than the one being prevented.

Two further consequences were found in review and are part of why this was withdrawn rather than
patched: resetting the per-document flags during render is not safe under concurrent rendering (a
discarded render can clear a flag while the committed frame stays mounted), and deferring the
teardown widens the window in which an in-flight execution result is posted to the frame that has
already navigated.

Note also that no test in this repository can exercise any version of it: the form suite's jsdom is
constructed without `runScripts`, so the bridge never executes and every ordering in a test is one the
test author chose by hand. A control whose correctness turns entirely on task ordering, and whose
ordering cannot be observed by any check here, does not belong in front of users.

So the residual risk stands as this ADR originally described it, and is accepted under the ruling: a
one-shot GET to an attacker URL carrying what a viewer typed into that Qapp's own inputs, and an
attacker-controlled page then rendering inside Leona's chrome. What guards it is the generation-time
pattern guard below, which is a filter on how a document is written and not a boundary.

The static document guard was also measured rather than assumed, and was found weakest exactly
where it was the only generation-time control: of fifteen navigation payloads, nine passed it —
anchors built with `createElement` and given an `href` via `setAttribute`, `meta` refreshes
assembled in script, `eval` of an encoded payload. Twelve of fifteen are now blocked. The remaining
three (`window["loc"+"ation"]` and its kin) are pinned as a test asserting that they pass, because
these are regular expressions over JavaScript and string concatenation is not a pattern. Nothing
holds those three; they are the accepted residual risk above. The residual risk that remains after all of this is a
single one-shot GET to an attacker URL carrying what a viewer typed into that Qapp's own inputs,
with no page rendered afterwards — accepted, for non-secret UI inputs, under the ruling above.

Quantum source never enters the public Qapp response. The worker reads it from the scoped repository
and executes it through `majorana_sandbox.run`, preserving static guard, resource preflight,
provider isolation, and explicit deny-all egress. The generated bundle declares a conservative
1–27-qubit maximum, and every execution passes that number into the existing preflight. Inputs and
outputs use a bounded JSON-Schema subset and are validated on both sides of the sandbox boundary.

Public Qapps are anonymously viewable; execution requires a signed-in caller so sandbox cost and
usage are attributable. Public repository projections allowlist UI and descriptive fields and
exclude quantum source, generation prompts, tenant ids, and execution history.

**Updated 2026-08-25, under the ai-ops#177 ruling.** The per-account backstop of 60 executions per
rolling hour was, on its own, the right shape for a *private* Qapp and no ceiling at all for a
published one: `/q/<slug>` runs under the **visitor's** account, so one public page's reachable
total was (however many people have signed up) x 60 paid sandbox runs an hour, and the deployment's
was that again times the number of published Qapps. Two cross-tenant ceilings now sit beside it —
per-Qapp (200/hour, all accounts together) and deployment-wide (600/hour), the latter being the only
one of the three whose ceiling does not rise as accounts and Qapps are added, and therefore the only
one that bounds the bill. All three are environment-overridable so an operator can lower one without
shipping a deploy, and `0` disables one.

These are read through a `SECURITY DEFINER` counter (migration 0056), not a plain `count(*)`, and
that choice is load-bearing rather than stylistic: `qapp_executions` carries 0055's
`tenant_isolation` policy, whose first disjunct is permissive only while `majorana.rls_enforce` is
off — which it is, everywhere, today (ADR-0028). An ordinary count would bound spend correctly, pass
review, pass CI, and then silently stop bounding anything the day RLS enforcement is switched on,
which is the stated direction. It would neither error nor fire. The RLS suite probes exactly this,
with enforcement on and a negative control first. All three ceilings remain abuse ceilings, not plan
entitlements.

Publication additionally requires the current version to have completed at least one sandbox run
whose output satisfies its declared schema. This is an executability gate, not semantic quantum
verification, and the UI must not label it as the latter. A future verified-Qapp claim requires a
separate decision about parameterized verification; a successful smoke execution cannot earn it.

**Identity:** Qapp slugs are new public addresses for a new resource type. They do not rename or
migrate any existing published record id, and therefore do not settle the still-open record-id
rename question in the repository instructions.

**Consequences:**

- Generated UI can choose any interaction and visual design within a capability boundary; the
  bridge is runtime infrastructure, not a visual template.
- An anonymous reader can inspect and use the interface but must sign in before paid execution.
- Publishing is reversible without mutating a version. Existing shared links stop resolving after
  the creator makes the Qapp private.
- Migrations, contracts, public routing, and sandbox use remain CODEOWNERS blast-radius changes and
  require owner/security review. That review happened as ai-ops#177 and the ruling was to ship.
- One gap is knowingly left open and is **not** closed by this ADR: `QAPP_MAX_QUBITS` is written
  into the sandbox namespace (`handlers.py`) and read nowhere, so the qubit ceiling a bundle
  declares is enforced only by asking the model for it in the prompt. Containment is real but
  indirect — the sandbox's memory and wall-clock limits are what actually stop an over-large
  statevector, and the declared estimate is separately bounded to 1-27 by both the parsed model and
  the sandbox preflight. So this is "declared limit is not the enforced limit", not an isolation
  escape. Closing it means touching `packages/py/sandbox`, which is blast radius this change does
  not have and did not need.
