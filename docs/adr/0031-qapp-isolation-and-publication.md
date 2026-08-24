# ADR-0031: Generated Qapp UI and quantum execution use separate isolation boundaries

**Date:** 2026-08-23 · **Status:** proposed — owner and security review required before merge.

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
portable `navigate-to` control, so deliberately obfuscated self-navigation by hostile generated
JavaScript remains a security-review risk rather than a solved property. The generation prompt and
static document guard reject direct uses, but neither is an OS network boundary. Owner/security
review must either accept that residual risk for non-secret UI inputs, strengthen the browser
runtime, or keep Qapps out of `dev`.

Quantum source never enters the public Qapp response. The worker reads it from the scoped repository
and executes it through `majorana_sandbox.run`, preserving static guard, resource preflight,
provider isolation, and explicit deny-all egress. The generated bundle declares a conservative
1–27-qubit maximum, and every execution passes that number into the existing preflight. Inputs and
outputs use a bounded JSON-Schema subset and are validated on both sides of the sandbox boundary.

Public Qapps are anonymously viewable; execution requires a signed-in caller so sandbox cost and
usage are attributable. A serialized per-account safety backstop admits at most 60 Qapp executions
per rolling hour. This is an abuse ceiling, not a plan entitlement. Public repository projections
allowlist UI and descriptive fields and exclude quantum source, generation prompts, tenant ids, and
execution history.

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
  require owner/security review. No merge to `dev` is implied by this proposal.
