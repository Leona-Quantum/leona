# Phase 10 S6 — static execution-candidate preflight

Date: 2026-08-03 JST  
Status: **structured-only contract — execution remains blocked**

## Boundary

`phase10_static_candidate` binds reviewed metadata to an S5 normalized-source
manifest without importing, parsing, installing, or executing candidate code.
The candidate may name only:

- Python as the initial language;
- Qiskit 1.4.6 or PennyLane 0.45.1 as a bounded framework family;
- selected manifest paths as framework/package evidence;
- one selected `.py` path as a requested entrypoint **as data**;
- an explicit license and provenance review state.

The framework maps to an Atlas-owned candidate runtime-profile identifier. The
source cannot supply a command, argument, image, package index, version range,
launcher, input schema, output schema, or enforcement limit. The fixed launcher
identifier is metadata only and is not implemented as an execution path here.

## Mandatory fail-closed disposition

Every S6 candidate is emitted as `structured_only` with at least:

```text
external_runtime_policy_unqualified
static_entrypoint_review_pending
```

Unresolved license or provenance adds separate blocking reasons. Rewriting the
serialized record to `executable`, deleting the reasons, changing the runtime
mapping, or injecting a command fails validation even if the outer digest is
recomputed.

The candidate therefore supports review and comparison of metadata, not public
execution or a reproducibility claim. S6 exit still requires an approved static
review process and evidence that unsupported packages, versions, native
extensions, network needs, and entrypoints remain structured-only. S7 policy,
OCI runtime qualification, sandboxing, result verification, and publication
gates are all still absent.
