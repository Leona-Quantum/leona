# Bonus — IBM Quantum hardware

An optional chapter, not a session. Nothing in Weeks 00–08 requires anything here — every
lab, challenge, and the mini project run entirely on your own machine with
`StatevectorSampler` and `StatevectorEstimator`. This chapter exists for the moment you want
to see a circuit you already understand run on a real quantum processor instead of a
simulation of one.

**Deliverable:** optional — a real QPU result, if you choose to run the guarded cells in
`guide.ipynb` yourself.

## What an account gives you

An IBM Quantum account is what lets `qiskit_ibm_runtime` talk to IBM's cloud service on your
behalf: it identifies you, tracks which backends you can reach, and meters your usage
against whatever access tier you have (a no-cost tier exists, and paid tiers exist above
it). Without an account, `qiskit_ibm_runtime` has nothing to authenticate with and none of
the hardware calls in this chapter work — which is exactly the situation every other week of
this course is in, on purpose.

Signing up costs nothing and does not commit you to using any real device time. Everything
up to and including generating an API token is free; the only thing that costs anything is
actually submitting a job to a real backend, which this chapter walks you through but never
does for you.

## Nothing else in this course needs it

Every deliverable through Week 08 is graded against a local simulation. `guide.ipynb` is
read end to end without an account: the local half runs live, and every cell that would
touch IBM's service is written to run and print real output, but is switched off by default
so the notebook never tries to reach a network or a credential you have not set up. Treat
the hardware half as something to read first and run later, on your own schedule, not
something the course is waiting on.

## Cost and queue expectations, in plain words

- **Connecting, listing backends, checking a job's status, and reading a finished job's
  result are all free and normally near-instant.** None of that touches device time.
- **Submitting a job is the one step that costs something and can make you wait.** Your job
  joins a queue behind other people's jobs on that same backend. A no-cost account shares
  the smallest allocation of device time and the longest queues; a paid tier buys priority
  and more of it. Expect anywhere from under a minute to well over an hour, depending on the
  backend, the time of day, and your tier — there is no fixed number worth memorizing here.
- **A job outlives your notebook.** Closing Jupyter, restarting your kernel, or losing your
  internet connection does not cancel a submitted job. Save the job id it gives you
  (`job.job_id()`) and look it up again later with `service.job(job_id)` — `guide.ipynb`
  shows exactly this.
- **Keep shots small for a demo like this one.** A few hundred shots is enough to see the
  pattern this chapter asks you to look for, and it is also the cheaper choice.

## The credential rule

**An IBM Quantum API token never appears in a notebook, a script, or anything that could end
up committed to git.** Every cell in `guide.ipynb` that needs one reads it from an
environment variable, `QISKIT_IBM_TOKEN`, with `os.environ.get("QISKIT_IBM_TOKEN")` — never
as a string literal. This is not a style preference: a token pasted into a cell is a token
one accidental `git add .` away from being public.

### Setting `QISKIT_IBM_TOKEN` in your shell

Set it in the same terminal session you launch Jupyter from, before you launch it:

```bash
# macOS/Linux (bash/zsh), current shell session only
export QISKIT_IBM_TOKEN="paste-your-token-here"
jupyter lab
```

```powershell
# Windows PowerShell, current shell session only
$env:QISKIT_IBM_TOKEN = "paste-your-token-here"
jupyter lab
```

Either form only lasts for that terminal session — closing the terminal clears it, which is
the point: nothing about it persists anywhere on disk unless you separately add it to your
own shell profile, which is your choice to make and not something this course asks of you.

### `save_account` writes to your home directory

`qiskit_ibm_runtime` also offers `QiskitRuntimeService.save_account(...)`, which stores your
credentials on disk under your home directory (a JSON file, not inside this repository) so
you do not have to set the environment variable every session. `guide.ipynb` does not call
it and does not require it — the environment-variable path above is enough to run everything
here. If you choose to use `save_account` yourself outside this notebook, know that it
writes real credentials to a real file on your machine, and treat that file the way you
would treat any other stored credential: never copy it into a project directory, and never
commit it.

## Next

Open `guide.ipynb`, read the local half live (it runs the same Bell circuit from Week 02,
made ISA-compatible the way Week 04 taught), then read — and, if you want to, run — the
guarded hardware half at your own pace. There is no self-evaluation checklist for this
chapter and no companion challenge; it is optional, and reading it counts as completing it.
