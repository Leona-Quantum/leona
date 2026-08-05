# Phase 10 S10 — hostile repository corpus preflight

Date: 2026-08-05  
Status: **inert corpus complete; live hostile execution not run**

## What was added

`docs/atlas/evidence/phase10/hostile_corpus_manifest_v1.json` contains exactly
one versioned fixture identity for each of the 26 threats in the S1 authority
matrix, plus benign controls for selected-source, executor-observation and
result-verifier paths.

The corpus is deliberately inert. It contains expected failure identities and
locators for bounded unit/recorded-response tests, but no executable repository
source, command, credential or environment payload.

## Coverage states

- `offline_tested`: a pure contract or recorded-response test exercises the
  failure boundary;
- `live_blocked`: an S8 observation schema exists, but the hostile action has
  not run on an owner-approved deployment class;
- `recorded_only`: the threat is represented, but its Phase 10 endpoint/storage
  boundary does not exist and therefore cannot be tested end to end.

The validator requires exact agreement with S1 for threat id, fixture id,
target stage and failure code. It also requires every test/document locator to
exist and prevents the manifest from silently claiming a live success.

## Current limits

Five executor attacks remain `live_blocked`:

- network/socket access;
- environment/credential discovery;
- host/privilege escape;
- fork/memory/disk/output exhaustion;
- timeout evasion and cleanup.

Cross-workspace Phase 10 object access remains `recorded_only` because no Phase
10 persistence endpoint exists. This is safer than inventing a passing tenancy
test for an API that has not been built.

Therefore the S10 exit gate is **not met**. Offline schema coverage is complete,
but the required exact-deployment hostile run, wall/resource measurements,
leakage proof, cleanup/retry proof and false-positive/false-negative review have
not occurred.
