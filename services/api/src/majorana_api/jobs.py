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
#: Grading one reader's attempt. A run of its own rather than a mode of `revise`,
#: because it changes no notebook version — it executes the reader's code against
#: assertions the reader never receives and emits verdicts, and a lane that produces
#: no version should not be able to write one by accident.
NOTEBOOK_GRADE_JOB_KIND = "notebook.grade"
# The course lane (leona_notebooks.courses): one job writes the plan from the
# reader's brief, the other rewrites it from a chat turn. Both carry a run_id whose
# mode is `notebook` — a course adds no run mode, it reuses the notebook lane's
# quota counters, abuse backstop and event stream. Generating a module's notebook
# is an ordinary `notebook.generate` job, dispatched by POST /courses/{id}/generate.
COURSE_PLAN_JOB_KIND = "course.plan"
COURSE_REVISE_JOB_KIND = "course.revise"
