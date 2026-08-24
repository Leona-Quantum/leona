"""Job-kind constants — the API enqueues them, the worker dispatches on them.
One shared module so producer and consumer can't drift."""

RUN_EXECUTE_JOB_KIND = "run.execute"
CIRCUIT_OPTIMIZE_JOB_KIND = "circuit.optimize"
CATALOG_IMPORT_JOB_KIND = "catalog.import"
# Durable hardware submission (two-PR schema change; this is the contract
# half). No producer enqueues it until the qpu_run record storage lands — the
# worker handler exists so a row of this kind can never dead-letter as an
# unknown kind, and fails closed instead.
QPU_RUN_JOB_KIND = "qpu.run"
QAPP_EXECUTE_JOB_KIND = "qapp.execute"
