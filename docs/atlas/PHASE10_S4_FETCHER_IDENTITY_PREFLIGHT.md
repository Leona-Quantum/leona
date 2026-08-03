# Phase 10 S4 — fetcher identity and deployment-separation preflight

Date: 2026-08-03 JST  
Status: **offline contract only — no workload or IAM has been created**

## Boundary

`phase10_fetcher_identity_contract` defines the minimum expected shape of a
future acquisition-only fetcher. It is deliberately provider-neutral and
I/O-free. It does not deploy a service, create a service account, grant a role,
read a secret, resolve DNS, open a connection, write quarantine bytes, update a
job, parse source, publish evidence, or execute source.

The plan requires:

- one digest-only fetcher principal reference;
- distinct digest-only references for the application, executor, publisher,
  quarantine verifier, and registry signer;
- exactly three capabilities: fixed-source HTTPS fetch, quarantine object
  creation, and append-only acquisition-status update;
- exactly three explicit TLS destinations: `api.github.com:443`, one owner-
  approved quarantine write host, and one owner-approved status host;
- workload-identity-only credential delivery;
- no secret-valued environment binding and no mounted control-plane path.

Inputs are non-secret identity references, which are immediately reduced to
SHA-256 digests in the serialized plan. Destinations are host/port tuples, not
URLs; wildcards, IP literals, paths, schemes, alternate ports, and duplicate
destination roles fail closed. The canonical outer digest detects later plan
modification.

## What this proves

The contract can reject a proposed design that aliases the fetcher to an
application/executor/publisher identity, adds a database capability, injects a
secret environment name, mounts a Docker/control-plane path, changes the
GitHub source authority, or introduces arbitrary egress.

## What this does not prove

It is not evidence about a live deployment. S4 remains incomplete until an
owner-approved provider configuration is inspected independently and live
negative tests prove all of the following on the exact deployed revision:

- the runtime principal matches the approved digest and differs from every
  forbidden role principal;
- application/Neon/Cloud SQL, WorkOS, QPU, LLM, GitHub-write, signing,
  registry-push, publication, executor, Docker, and Kubernetes credentials or
  routes are absent;
- only the three approved destinations are reachable;
- quarantine access cannot read/list/delete and status access cannot mutate
  unrelated records;
- logs and failure output contain no credential, source content, signed URL,
  or query value.

Provider, region, identity names, private network path, exact quarantine/status
hosts, retention, incident owner, and live probe harness remain owner/security
decisions. No S4 exit claim is made by this preflight.
