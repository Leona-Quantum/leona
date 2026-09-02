# ---
# title: Bonus — IBM Quantum hardware
# kind: hardware
# summary: What an IBM Quantum account adds beyond local simulation, and a credential-safe,
#   cell-by-cell walk from a local Bell circuit to a real QPU job and back.
# objectives:
#   - State what an IBM Quantum account gives you, and that no other unit needs one
#   - State the credential rule — a token comes from an environment variable, never from a
#     notebook or a committed file
#   - Read the exact sequence a real hardware submission follows — connect, pick a backend,
#     transpile to its ISA, submit, check status, retrieve a job by id, read counts
#   - Compare a real QPU's counts against the same Bell circuit's local, noiseless simulation
# prerequisites:
#   - Week 04 — Transpilation (Target, basis gates, generate_preset_pass_manager, ISA circuits)
#   - Week 05 — Primitives (SamplerV2, result objects)
# duration_minutes: 30
# ---

# %% [markdown] role=objective
# ## What you will build
# Every notebook before this one ran on your own machine: a local, noiseless simulator with
# no account, no queue, and no cost. This bonus chapter is different in kind, not just in
# content. It walks the exact sequence of calls that sends a circuit to a real IBM quantum
# processor and reads a result back — but it never makes that call for you.
#
# The first half runs locally, the same way every earlier week did: a Bell circuit, made
# ISA-compatible for a simulated backend, sampled with `StatevectorSampler`. The second half
# reads, cell by cell, what changes when the backend is real hardware instead of
# `GenericBackendV2` — connecting to the service, picking a backend, transpiling to its
# actual `Target`, submitting a job, and retrieving it later by id. Every cell in that second
# half is marked so it never runs on its own; you choose whether to run it yourself, with
# your own account. The deliverable is optional: a real QPU result, if you want one.

# %% role=setup
import qiskit

print(qiskit.__version__)

# %% [markdown] role=concept
# ## Three execution environments, not one
# The course FAQ names them, and it is worth having the distinction sharp before anything
# else in this notebook: **local simulation** (`StatevectorSampler`, `StatevectorEstimator`)
# runs on your machine, needs no account, and is exact apart from sampling. **IBM Quantum
# Runtime** is a cloud service, reached through the separate `qiskit_ibm_runtime` package,
# that accepts ISA circuits and hands back results the same shape as the local primitives.
# A **real QPU** is one specific hardware backend, selected through Runtime, with its own
# basis gates, its own coupling map, a queue of other people's jobs ahead of yours, and
# physical noise a simulator has none of. This notebook is the only place in the course
# where the second and third environments appear at all.

# %% [markdown] role=predict
# ## Predict, then run: the Bell circuit locally
# You built this exact circuit in Week 02, then made a version of it ISA-compatible in
# Week 04. Here it is one more time, transpiled for a simulated backend and sampled with
# `shots=1000`. Before running: write a specific guess for what fraction of the 1000 shots
# land on `00` or `11` combined, versus `01` or `10`. (As in Week 02, qubit 0 is the
# rightmost character of each bitstring.)

# %% role=run
from qiskit import QuantumCircuit
from qiskit.providers.fake_provider import GenericBackendV2
from qiskit.transpiler import generate_preset_pass_manager

bell_qc = QuantumCircuit(2)
bell_qc.h(0)
bell_qc.cx(0, 1)
bell_qc.measure_all()

sim_backend = GenericBackendV2(num_qubits=5, seed=1)
local_pm = generate_preset_pass_manager(optimization_level=1, backend=sim_backend, seed_transpiler=1)
isa_bell_local = local_pm.run(bell_qc)

print("original:", bell_qc.count_ops())
print("ISA circuit:", isa_bell_local.count_ops())

# %% role=run
from qiskit.primitives import StatevectorSampler

local_counts = (
    StatevectorSampler(seed=99).run([isa_bell_local], shots=1000).result()[0].data.meas.get_counts()
)
local_total = sum(local_counts.values())
for outcome in sorted(local_counts):
    print(f"{outcome}: {local_counts[outcome]} ({local_counts[outcome] / local_total:.1%})")

# %% [markdown] role=observe
# `00` and `11` account for essentially all 1000 shots; `01` and `10` are effectively absent
# — the same Bell-state pattern from Week 02, now sampled from a circuit already rewritten
# into the `rz, sx, x, cx` basis a real backend would require.

# %% [markdown] role=explain
# `isa_bell_local` is not a convenience form — it is the same kind of object
# `to_target_compatible` produced in Week 04, and sampling it locally exercises the exact
# circuit shape a real backend needs, without touching a network or a queue. The
# transpilation step is unitary: it changes which gates the circuit is written in, not the
# state the circuit produces, so the counts here should look like Week 02's Bell state, not
# some new distribution.

# %% role=figure
# The text drawing and the image below describe the same ISA circuit; keep both, since the
# text form works even where the image never renders.
print(isa_bell_local.draw("text"))
isa_bell_local.draw("mpl")

# %% role=figure
from qiskit.visualization import plot_histogram

print(local_counts)
plot_histogram(local_counts)

# %% role=checkpoint
isa_ops = {instr.operation.name for instr in isa_bell_local.data if instr.operation.name != "barrier"}
assert isa_ops <= set(sim_backend.target.operation_names), (
    f"every instruction in an ISA circuit must come from the backend's basis, saw {isa_ops}"
)
local_matched = local_counts.get("00", 0) + local_counts.get("11", 0)
assert local_matched / local_total > 0.95, (
    f"a Bell state should land on 00 or 11 almost every shot, got {local_matched}/{local_total}"
)

# %% role=modify
# Same seed, five times the shots: the matched fraction should stay in the same band, just
# with less shot-to-shot wobble around it.
bigger_counts = (
    StatevectorSampler(seed=99).run([isa_bell_local], shots=5000).result()[0].data.meas.get_counts()
)
bigger_total = sum(bigger_counts.values())
bigger_matched = bigger_counts.get("00", 0) + bigger_counts.get("11", 0)
print(f"shots=1000: {local_matched}/{local_total} ({local_matched / local_total:.1%})")
print(f"shots=5000: {bigger_matched}/{bigger_total} ({bigger_matched / bigger_total:.1%})")

# %% [markdown] role=note
# Everything above needed nothing but your own machine — no account, no network call, no
# cost, no wait. The rest of this notebook reads what changes when `sim_backend` becomes a
# real IBM quantum processor instead. None of the following code cells run automatically;
# each one is preceded by a note on what it does, what it costs, and what to expect, so you
# can decide whether to run it yourself.

# %% [markdown] role=concept
# ## From local simulation to a real QPU
# The shape of the work does not change: connect, pick a backend, transpile to that
# backend's `Target`, submit, and read results back. What changes is that each of those
# steps now involves IBM's account system, a specific piece of hardware, and — for the
# submission step only — a shared queue and real device time. The cells below follow that
# sequence one call at a time.
#
# Before any of it: create a free IBM Quantum account if you do not already have one, and
# generate an API token from its account settings page (see the official docs link in the
# references cell at the end). **Never paste that token into a notebook, a script, or
# anything you might commit to git.** Set it as an environment variable in your shell —
# `QISKIT_IBM_TOKEN` is the name this notebook reads — before you launch Jupyter, and every
# cell below reads it from there.

# %% [markdown] role=note
# **Connecting to the service.** This is a local object construction plus one network call
# to authenticate — free, and normally instant. `channel="ibm_quantum_platform"` is the
# current channel name for `qiskit-ibm-runtime` 0.49; if your installed version rejects it,
# check the docs link at the end of this notebook against `pip show qiskit-ibm-runtime`. The
# token comes from `os.environ.get`, never a literal string.

# %% role=run execute=false tags=["skip-execution"]
import os

from qiskit_ibm_runtime import QiskitRuntimeService

token = os.environ.get("QISKIT_IBM_TOKEN")
service = QiskitRuntimeService(channel="ibm_quantum_platform", token=token)

# %% [markdown] role=note
# **Picking a backend.** `least_busy` is a free query against IBM's current backend status —
# it does not submit anything. `simulator=False` excludes IBM's own cloud simulators so you
# land on real hardware; `operational=True` excludes anything offline for maintenance.
# "Least busy" is relative to other users' queues at this exact moment — it can still mean a
# real wait once you submit, just a shorter one than the alternatives.

# %% role=run execute=false tags=["skip-execution"]
backend = service.least_busy(simulator=False, operational=True)
print(backend.name)

# %% [markdown] role=note
# **Transpiling for the real backend.** Same call as the local path above,
# `generate_preset_pass_manager`, but reading `backend.target` from an actual piece of
# hardware instead of `GenericBackendV2` — its basis gates and coupling map are whatever
# that specific chip has today. This runs on your machine and costs nothing; it is the step
# right before the one that does.

# %% role=run execute=false tags=["skip-execution"]
hw_pm = generate_preset_pass_manager(backend=backend, optimization_level=1)
isa_bell_hw = hw_pm.run(bell_qc)
print(isa_bell_hw.count_ops())

# %% [markdown] role=note
# **Submitting the job.** This is the one step above that spends real device time and enters
# IBM's shared queue — everything before it was free and local. Queueing can be anywhere
# from seconds to well over an hour, depending on the backend, the time of day, and your
# account's access tier; a no-cost account shares the smallest allocation and the longest
# queues. Keep `shots` small for a demo like this one — a few hundred is enough to see a
# pattern, and it is also cheaper. `mode=backend` is how `SamplerV2` targets a specific
# backend in `qiskit-ibm-runtime` 0.49.

# %% role=run execute=false tags=["skip-execution"]
from qiskit_ibm_runtime import SamplerV2

sampler = SamplerV2(mode=backend)
job = sampler.run([isa_bell_hw], shots=200)

# %% [markdown] role=note
# **Job id and status.** Both return immediately — they do not wait for the job to finish.
# `job.job_id()` is a string worth writing down; it is how you find this job again in a
# later session. `job.status()` is one of a small set of strings such as `QUEUED`,
# `RUNNING`, or `DONE`.

# %% role=run execute=false tags=["skip-execution"]
print(job.job_id())
print(job.status())

# %% [markdown] role=note
# **Coming back later.** Nothing about a Runtime job requires your notebook's kernel to stay
# open — the job keeps running on IBM's side whether or not you do. `service.job(job_id)`
# looks up a job you already submitted, in this session or a completely different one, using
# only the id string from the cell above. This is a free query.

# %% role=run execute=false tags=["skip-execution"]
job_id = None  # paste the string job.job_id() printed above
retrieved_job = service.job(job_id)
print(retrieved_job.status())

# %% [markdown] role=note
# **Reading counts.** Once status is `DONE`, `.result()` is free and returns the same shape
# `SamplerV2` always returns, real hardware or local: a `PrimitiveResult` you index by PUB
# position, whose `.data.meas.get_counts()` reads exactly like every `StatevectorSampler`
# result earlier in the course.

# %% role=run execute=false tags=["skip-execution"]
hw_result = retrieved_job.result()
hw_counts = hw_result[0].data.meas.get_counts()
print(hw_counts)

# %% [markdown] role=note
# ## Optional: compare your hardware counts against the local run
# If you ran the cells above with your own account, `hw_counts` just printed a dict like
# `{"00": 412, "11": 379, "01": 108, "10": 101}`. Paste it into `pasted_hw_counts` below. If
# you did not run them, leave it as `None` — the cell still runs cleanly either way, which is
# the whole point of a default that is not a real answer.

# %% role=checkpoint
pasted_hw_counts = None  # e.g. {"00": 412, "11": 379, "01": 108, "10": 101}

if pasted_hw_counts is not None:
    hw_total = sum(pasted_hw_counts.values())
    hw_matched = pasted_hw_counts.get("00", 0) + pasted_hw_counts.get("11", 0)
    hw_matched_fraction = hw_matched / hw_total
    local_matched_fraction = local_matched / local_total
    print(f"local (noiseless) matched fraction:      {local_matched_fraction:.1%}")
    print(f"hardware (real, noisy) matched fraction: {hw_matched_fraction:.1%}")
    # A wide, tolerant band: real hardware carries gate errors, readout errors and
    # crosstalk the local statevector simulation has none of, so it should land lower
    # than the near-100% local result — but a working Bell state still lands well above
    # the 50% two independent coins would give you.
    assert hw_matched_fraction > 0.55, (
        f"expected most hardware shots to still land on 00 or 11 despite noise, got "
        f"{hw_matched_fraction:.1%}"
    )
else:
    print("no hardware counts pasted in — that comparison is optional. See the note above.")

# %% [markdown] role=summary
# ## What this chapter covered
# An IBM Quantum account adds exactly one thing this course otherwise never needs: a real
# QPU, reached through `qiskit_ibm_runtime`'s `QiskitRuntimeService` and `SamplerV2`. Every
# other notebook in this course runs to completion with no account at all. The sequence is
# always connect, pick a backend, transpile to its `Target`, submit, check status, and —
# because a job outlives your kernel — retrieve it later by id. The only step that costs
# real device time and queues behind other users is the submission itself; everything else
# is a free, usually-instant call. The one rule that matters everywhere in this sequence:
# the token is an environment variable, read with `os.environ.get`, never a string literal
# in a notebook.

# %% [markdown] role=references
# ## Official resources
# - [IBM Quantum Documentation](https://quantum.cloud.ibm.com/docs/) — account setup, current
#   channel names, and API changes since this notebook was written
# - [Primitive inputs and outputs](https://quantum.cloud.ibm.com/docs/en/guides/primitive-input-output)
#   — the `SamplerV2`/`EstimatorV2` result shape this notebook's `hw_counts` line reads
# - [Transpile with pass managers](https://quantum.cloud.ibm.com/docs/en/guides/transpile-with-pass-managers)
#   — `generate_preset_pass_manager` against a real backend's `Target`
# - [Qiskit API reference](https://quantum.cloud.ibm.com/docs/en/api/qiskit) — exact,
#   version-specific signatures for anything above that looks different from what you have
#   installed
