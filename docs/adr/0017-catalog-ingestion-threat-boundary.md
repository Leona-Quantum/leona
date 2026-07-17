# ADR-0017: Catalog ingestion uses connector allowlists and offline quarantine

**Date:** 2026-07-18 · **Status:** proposed (Ryu/Eshaan security review required)
**Context:** Repository ingestion accepts content controlled outside Majorana. The
fetch phase can be abused for SSRF, DNS rebinding, redirect bypass, resource
exhaustion, path traversal, dependency installation, and credential theft; the parse
and execution phases can run malicious host-language code. Running discovery,
fetching, parsing, or conversion in a FastAPI request would combine these risks with
database and authentication authority.
**Decision:** FastAPI accepts a typed connector ID plus connector-specific opaque
source coordinates and creates a durable job; it never accepts an arbitrary shell
command or fetches external content in the request lifecycle. Each connector builds
its own URL from an allowlisted HTTPS host, port, operation, immutable ref, and path.
Redirects and archive ingestion are rejected in the initial release. Every connection
revalidates the resolved address and rejects loopback, private, link-local, multicast,
metadata-service, and non-routable ranges. The fetcher has bounded egress but no Neon,
cloud-provider, QPU, signing, or publication credential. It returns bounded bytes and
a retrieval manifest to a private content-addressed quarantine store. The parser and
all source execution run later in an ephemeral deny-all egress sandbox with read-only
input and bounded CPU, memory, time, processes, files, disk, and output. MQT Bench and
other generator dependencies are installed into a reviewed image from the lockfile;
an import job never installs an upstream package dynamically. Publication fails
closed on missing provenance, unknown rights, failed limits, or incomplete review.
**Consequences:** The network-capable component cannot execute content or publish a
record, and the execution-capable component cannot reach the network or credentials.
This requires connector-specific discovery, quarantine manifests, idempotent item
states, leases/heartbeats, stable failure codes, malicious fixtures, audit logs, and
operational limits. Initial GitHub/QASMBench ingestion retrieves individual bounded
files rather than cloning repositories, resolving submodules/LFS, or expanding
archives. Hugging Face and additional connectors remain disabled until they satisfy
the same contract. Untrusted Markdown/HTML is stored as data and sanitized before
rendering. Blocked destinations and limit failures are observable without logging
tokens or sensitive query strings. Exact byte/file/batch limits and quarantine
storage implementation must be approved during the importer slice; increasing a
limit is a reviewed configuration change. Reversal trigger: archive or repository
checkout support may be introduced only with a separate threat review covering
expansion ratio, file count, nesting, path traversal, symlinks, device files, hooks,
submodules, LFS, and cleanup after partial failure.

The built-in 285-record TypeScript bootstrap is a controlled local connector,
not a direct database seed. It bundles one pinned commit into a deterministic
checksummed manifest and submits that manifest through the same quarantine,
normalization, rights, deduplication, review, and publication states. Existing
catalog labels and prose cannot be promoted to execution or license evidence
merely because the source is maintained in Majorana.
