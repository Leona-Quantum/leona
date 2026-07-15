# AGENTS.md — majorana-openqasm (BLAST-RADIUS)

OpenQASM is an optional interchange representation for explicit framework conversion.
The selected framework's executable source is the durable circuit source of truth.
OpenQASM 3 is normalized when interchange data exists; OpenQASM 2 is accepted only as
an ingestion bridge for legacy runtimes.

- Use Qiskit's official OpenQASM import/export APIs. Do not grow a second parser.
- Normalize interchange data by parse + OpenQASM 3 export before persistence.
- SDK circuit objects are ephemeral implementation details, never API/DB contracts.
- Invalid or unsupported programs fail closed with `OpenQASMError`.
- Do not verify, optimize, or gate artifact persistence on OpenQASM availability.
