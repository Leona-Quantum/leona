# AGENTS.md — majorana-openqasm (BLAST-RADIUS)

OpenQASM is the durable circuit source of truth. OpenQASM 3 is canonical for new
artifacts; OpenQASM 2 is accepted only as an ingestion bridge for legacy runtimes.

- Use Qiskit's official OpenQASM import/export APIs. Do not grow a second parser.
- Normalize by parse + OpenQASM 3 export before hashing or persistence.
- SDK circuit objects are ephemeral implementation details, never API/DB contracts.
- Invalid or unsupported programs fail closed with `OpenQASMError`.
