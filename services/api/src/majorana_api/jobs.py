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
# The notebook lane (leona_notebooks): one job generates a notebook version from a
# brief, the other revises the current version from a chat turn. Both carry a
# run_id whose mode is `notebook`, so quota and the event stream come from runs.
NOTEBOOK_GENERATE_JOB_KIND = "notebook.generate"
NOTEBOOK_REVISE_JOB_KIND = "notebook.revise"
