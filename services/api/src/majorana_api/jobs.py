"""Job-kind constants — the API enqueues them, the worker dispatches on them.
One shared module so producer and consumer can't drift."""

RUN_EXECUTE_JOB_KIND = "run.execute"
CATALOG_IMPORT_JOB_KIND = "catalog.import"
