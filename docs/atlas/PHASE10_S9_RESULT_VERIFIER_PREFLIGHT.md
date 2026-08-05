# Phase 10 S9 — independent result verifier preflight

Date: 2026-08-05  
Status: **offline contract implemented; external execution remains disabled**

## Scope

S9 treats every byte emitted by external source code as hostile. The
implementation in `services/api/src/majorana_api/phase10_result_verifier.py` is
pure and I/O-free: it does not run code, read a repository, contact a provider,
write the database, or grant publication authority.

## Accepted boundary

The verifier accepts only one bounded UTF-8 JSON object:

- maximum 256 KiB, depth 8 and 2,048 JSON nodes;
- duplicate keys, `NaN`, `Infinity`, unknown fields and executable-content
  fields are rejected;
- the output schema id is fixed to `atlas.phase10.vqe-result/1`;
- source status is recorded but never trusted as verifier status;
- metrics use an explicit allowlist, exact units and versioned protocol ids;
- missing metrics remain missing and are never coerced to zero.

## Identity binding

Every accepted source result binds all of the following:

- S7 candidate qualification identity;
- normalized source manifest;
- static execution candidate;
- portable workflow;
- component configuration;
- OCI index digest and execution policy;
- input and seed;
- S8 executor observation;
- a format-independent result digest.

The expected binding is constructed from typed S7 and S8 parents. A caller
cannot provide parallel repository/runtime scalar values. A failed S8 probe
cannot be used as the parent of an S9 binding.

## Scientific boundary

Source-reported and Atlas-observed metrics are separate typed records. The
verifier compares only the same metric, exact unit and exact protocol id.
Energy and fidelity use named absolute tolerances; discrete resource metrics
must match exactly. An unknown protocol, missing independent observation,
out-of-domain fidelity, non-integer count or disagreement produces
`scientific_invariant_failed`.

This is a cheap invariant layer, not an independent replication of an arbitrary
paper. A matching result is labelled only:

```text
verification_outcome = accepted_unqualified
qualification_status = unqualified
publication_status = blocked
```

## Append-only evidence shape

The verifier emits an immutable observation with a unique attempt id, canonical
UTC timestamp, expected/raw/source digests, separately labelled metrics,
invariant results, stable failure code and its own canonical digest. The module
does not expose an update operation.

## Failure semantics covered offline

- `result_schema_invalid`
- `result_binding_mismatch`
- `scientific_invariant_failed`
- `source_reported_failure`

Forged success, digest substitution, replay to another observation, ambiguous
protocols, missing-to-zero coercion and publication-state escalation are
covered by inert tests. This does not qualify a live executor or an external
repository.
