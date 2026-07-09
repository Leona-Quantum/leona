# ADR-0006: Sandbox = Vercel Sandbox with mandatory deny-all egress; Modal heavy-lane seam

**Date:** 2026-07-09 · **Status:** accepted
**Context:** LLM-generated quantum code is untrusted and must run with zero credentials
and no network. Vercel Sandbox's DEFAULT network policy is allow-all — unacceptable as
shipped. Memory ceilings (Hobby 8 GB / Pro 16 GB) cap statevector sims.
**Decision:** Vercel Sandbox day one with two corrections: (a) every sandbox creation
MUST apply the deny-all firewall API with an explicit allowlist (nothing, or a private
PyPI mirror) — launch-blocking config, tested by the CI hostile-payload suite; (b) default
lane capped at ≤26–27 qubits statevector; 28–30 qubit requests route to a gated heavy
lane on Modal (gVisor, `block_network=True`, $30/mo perpetual free credit) — build the
routing seam now, the lane only when a real request hits the ceiling. Custom OCI image
(qiskit/pennylane/cirq/numpy pinned) via Vercel Container Registry. One sandbox per
execution, never pooled, no secrets in env, hard timeout 120 s, CPU/mem caps,
stdout/stderr/exit/duration captured.
**Consequences:** Buys zero-credential, network-locked execution with cross-cloud blast
radius separation for the heavy lane. Costs: custom image maintenance and provider limits
on corpus runs (Phase 2 stop condition: document and evaluate Modal promotion).
Long-horizon migration: Cloud Run gen2 (32 GiB) once there's infra headcount.
