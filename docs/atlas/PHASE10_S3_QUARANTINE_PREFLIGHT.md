# Phase 10 S3 — private quarantine preflight

Date: 2026-08-03 JST  
Status: **offline contract only — provider selection and storage I/O blocked**

## Boundary

The `phase10_quarantine_contract` module defines provider-neutral identities
for source bytes that have already passed the complete S2 acquisition evidence
chain. It does not create or access a bucket, write a file, persist a database
record, grant an IAM role, parse source, publish evidence, or execute code.

Every planned object has:

```text
selected path
media type
byte length
SHA-256
opaque qobj locator
internal object key derived only from SHA-256
```

The plan is bound to one canonical workspace UUID and one complete acquisition
result digest. The serialized form contains neither source bytes, a public URL,
a signed URL, provider credentials, nor a bucket name. An exact workspace check
is mandatory before a locator can be used.

The pure readback verifier accepts already-read bytes and compares both length
and SHA-256. It does not itself prove that bytes came from an object store; a
future approved storage adapter must write, read back through an independent
operation, invoke this verifier, and only then persist a receipt.

## Still blocked

- quarantine cloud/provider and region;
- public-access prevention, encryption key and workload IAM;
- retention, lifecycle deletion, versioning/immutability and legal hold;
- write-only fetcher capability and read-only verifier capability;
- database repository, workspace authorization and append-only audit schema;
- live byte round trip, tamper, cleanup and cross-workspace negative tests.

No S3 exit claim is made until these owner/security decisions and live tests are
complete.
