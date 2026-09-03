# Pinned by digest, not by tag (05-security.md §1: "pinned digests").
#
# `python:3.13-slim-bookworm` is a MOVING tag — it is republished on every
# patch release and on every base-image rebuild. This image is the root
# filesystem that untrusted, LLM-generated code executes in, which makes the
# tag the one input to the isolation boundary that a third party can change
# without anything here changing. A rebuild would then produce a different
# sandbox than the one that was reviewed and scanned, and nothing in the repo,
# the diff, or the weekly container scan would say so.
#
# The digest below is `3.13-slim-bookworm` as of 2026-08-15. Updating it is a
# deliberate edit with a reviewable diff, which is the entire point; the tag is
# kept alongside so the next person knows which line to re-resolve.
FROM python:3.13-slim-bookworm@sha256:00faa2debb87529f9f0764e9491d8ba400a3678976616c3bd7cb193745ac20d1

# This image is the Vercel Sandbox root filesystem for generated quantum code.
# Keep it dependency-complete because production sandboxes are created with the
# explicit deny-all network policy and cannot install packages at runtime.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Both of these exist so that `import matplotlib.pyplot` inside a sandbox is
# silent, and neither is cosmetic.
#
# MPLBACKEND: there is no display here and no display is ever coming, so the
# backend is decided at build time rather than left to matplotlib's autodetect.
# Agg is the headless raster backend and the one that writes a PNG.
#
# MPLCONFIGDIR: matplotlib wants a writable cache directory at import and
# defaults to $HOME/.config/matplotlib. When it cannot write there it does not
# fail — it falls back to a temp dir and emits a UserWarning on **stderr**.
# In this image that stderr belongs to generated code whose output a reader
# sees, so a permissions detail would surface inside the product as a warning
# attached to their lesson. The directory is created with mode 777 in the RUN
# below because the USER question above is unsettled: the probe says this runs
# as root today, and a mode that only works for root would break quietly on the
# day that changes.
ENV MPLBACKEND=Agg \
    MPLCONFIGDIR=/opt/mplconfig

# Two HIGH findings that `container_scan` (trivy, HIGH+CRITICAL) reports against
# this image:
#
#   setuptools 70.3.0  CVE-2025-47273        path traversal        fixed in 78.1.1
#   msgpack    1.1.2   GHSA-6v7p-g79w-8964   OOB read / crash      fixed in 1.2.1
#
# They matter more here than the severities alone suggest. This image is the root
# filesystem in which *generated, unreviewed* code executes, so its dependency
# surface is reachable by an attacker who can influence what the model writes — a
# path traversal in a package that generated code can `import` is a boundary
# problem, not a housekeeping one.
#
# ## Neither one is an installed package, which is why pinning them did nothing
#
# The first attempt pinned both to their fixed versions in the install below.
# The scan still reported 70.3.0 and 1.1.2, unchanged, because those two
# versions are not installed anywhere: they are **pip's own vendored copies**,
# and the base image ships no installed setuptools at all — `import setuptools`
# in a bare `python:3.13-slim-bookworm` raises ModuleNotFoundError. Installing a
# newer copy alongside left pip's untouched.
#
# What trivy is actually reading is `pip/_vendor/bom.cdx.json`, a CycloneDX SBOM
# that pip ships describing everything under `pip/_vendor/` — and `msgpack` and
# `pkg_resources` (setuptools) are both really there as vendored source. That
# file is also the whole reason this appeared to arrive out of nowhere: pip
# **26.1.2**, in the previous digest, did not ship it, and pip **26.2.1**, in the
# digest above, does. Both digests vendor the same two versions; only one of them
# tells the scanner so. Checked in both images rather than inferred.
#
# So the fix is to remove pip, not to out-pin it. That is not a way around the
# scanner — it is the end state this file's own second paragraph already implies:
# production sandboxes are created with the deny-all network policy and cannot
# install anything at runtime, so pip has no function here once the build is
# over. Removing it takes both findings out at the root rather than arguing with
# them, and drops a package manager out of the filesystem that untrusted code
# executes in. It would be worth doing with no CVE attached. It is not a size
# win — the image measures 1.58 GB either way, since pip is a rounding error
# next to the wheels.
#
# The `build` job in `.github/workflows/sandbox-image.yml` is what makes this
# safe to do: it imports every framework and runs a Bell pair on each, with
# `--network none`, against the image this file produces. Anything that needed
# pip or `pkg_resources` at runtime fails there rather than in production.
#
# setuptools is still installed, and still exactly 81.0.0, for a reason unrelated
# to the CVE: `amazon-braket-default-simulator==1.39.5` declares
# `setuptools==81.0.0` as an EXACT requirement, and 78.1.1 makes the resolve
# impossible (verified — the build fails with `ResolutionImpossible` naming those
# two). The msgpack pin is gone: nothing here required it, it was only ever an
# attempt to out-pin the vendored copy, and it never did.
#
# Worth knowing when this next changes: a scan can go red against a base-image
# refresh that changed no version at all, because trivy's database updates daily
# AND — as here — because the base image can start *declaring* what it always
# contained. Check what the scanner is reading before believing the diff.
# ## The Studio compiler lane lives here now (ai-ops#186, owner ruling: option A)
#
# `pytket`, `pyzx` and `bqskit` are not here for generated code. They are the
# three compilers Studio's circuit-compression lane needs that this image did
# not already carry (qiskit, cirq-core and pennylane were here for the
# execution lane). The lane ships its own kernel —
# `majorana_frameworks/optimizer_kernel.py` — into this rootfs as source and
# runs it through `majorana_sandbox.run_trusted`.
#
# The measurement that moved them, from ai-ops#186: installing all six into
# `services/api/Dockerfile` took that image from 129 packages to 151, and 21 of
# the 22 added existed only because PyZX declares `ipywidgets` — ipython, jedi,
# prompt-toolkit, and pexpect + ptyprocess, which spawn PTYs. That image is the
# ONE image `deploy.yml` runs both `majorana-api` and `majorana-worker` from,
# so a notebook stack landed in both processes that hold database, WorkOS and
# provider credentials.
#
# That stack is still installed — it arrives with pyzx and cannot be dropped
# without breaking `import pyzx` — but it is installed HERE, and here is the
# rootfs with deny-all egress and an empty environment, where the credentials
# it could reach do not exist. Moving a supply-chain surface out of a
# credentialed process and into an isolated one with nothing to steal is
# exactly what option A buys; it is not a claim that the surface is gone.
#
# Versions are pinned to what this image's existing qiskit 2.5.0 resolves
# against. `bqskit` and `pyzx` both hand their output back through Qiskit
# (`bqskit.ext.qiskit`, `qasm2.loads`), so a qiskit bump here is a compiler
# change, not just a simulator change — the `build` job below compiles a real
# circuit through all six for that reason, rather than importing them.
# ## The figure lane (ai-ops#239, owner ruling: "Yes, add them")
#
# Notebook lessons draw histograms and circuit diagrams. Neither package was
# here, so every figure a lesson asked for was missing inside the product —
# and missing in the one way that is hardest to notice from outside, because
# the notebook still ran and still produced a result.
#
# `matplotlib` is the renderer. `pylatexenc` is what Qiskit imports to typeset
# gate labels in `QuantumCircuit.draw("mpl")`; without it Qiskit does not fail,
# it silently degrades the labels, which is again a defect that looks like
# working software.
#
# **`pylatexenc==2.11` is load-bearing and is not simply "the latest".** This
# install runs `--only-binary=:all:`, and 2.11 is the FIRST release in the
# entire 2.x line to publish a wheel — 2.10, 2.9 and every earlier stable are
# sdist-only on PyPI, checked against the index rather than assumed. Pinning
# the version most people would reach for therefore fails the build outright
# with "no binary distribution available". The 3.0aNN alphas do ship wheels;
# they are alphas of a rewritten API and are not what Qiskit expects.
#
# ## matplotlib was ALREADY here, by accident. That is why it is pinned now.
#
# ai-ops#239 says "the image has neither package". Measured against the build
# log rather than believed: it had matplotlib 3.11.1, and pillow, fonttools,
# contourpy, kiwisolver, cycler, pyparsing and python-dateutil with it. They
# arrive transitively down the pyzx -> ipywidgets -> ipython chain the compiler
# lane note above describes — `matplotlib-inline` in the install list is the
# fingerprint. So histograms already rendered; only the circuit drawer was
# broken, because that is the half that needs pylatexenc.
#
# Naming matplotlib explicitly therefore adds nothing to the image and removes
# a real fragility: the figure lane was depending on a package that no line in
# this file asked for, held in place only by an optional dependency of a
# CIRCUIT COMPILER. Anything that loosened pyzx's extras would have taken every
# figure in the product with it, silently, and no diff here would have said so.
#
# The dependency surface consequently barely moves — pylatexenc is the one
# genuinely new package, and the image grows about 3 MB, most of it that plus a
# fonttools and kiwisolver patch bump. The containment argument from the
# compiler lane above still holds and is worth stating rather than implying:
# this widening is HERE, in the rootfs with deny-all egress and an empty
# environment, not in the credentialed API image.
RUN python -m pip install --no-cache-dir --only-binary=:all: \
    "setuptools==81.0.0" \
    "qiskit==2.5.0" \
    "qiskit-aer==0.17.2" \
    "pennylane==0.43.1" \
    "cirq-core==1.6.1" \
    "amazon-braket-sdk==1.122.0" \
    "amazon-braket-default-simulator==1.39.5" \
    "numba==0.66.0" \
    "qibo==0.3.4" \
    "qulacs==0.6.14" \
    "gast==0.7.0" \
    "pytket==2.18.1" \
    "pyzx==0.10.5" \
    "bqskit==1.2.1" \
    "matplotlib==3.11.1" \
    "pylatexenc==2.11" \
 && python -m pip uninstall --yes pip \
 && rm -rf /usr/local/lib/python3.13/ensurepip \
           /usr/local/lib/python3.13/site-packages/pip \
           /usr/local/lib/python3.13/site-packages/pip-*.dist-info \
           /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.13 \
 && mkdir -p "$MPLCONFIGDIR" \
 && chmod 777 "$MPLCONFIGDIR" \
 && python -c "import matplotlib.pyplot as plt; plt.subplots()" \
 && chmod -R a+rwX "$MPLCONFIGDIR"

# Chained into the RUN above rather than written as its own layer, on purpose: a
# `rm` in a later layer hides the files from the merged filesystem but leaves
# them in the image's history, where an operator can still recover them and where
# they still cost download bytes. Same layer means they were never committed.
#
# `ensurepip` goes with pip because it bundles its own pip wheel — the same
# vendored payload again, in archive form, and the obvious way to reinstall the
# thing this line just removed.

WORKDIR /tmp/run

# The missing-USER finding below is suppressed as UNRESOLVED, not as answered.
# Vercel Sandbox does not run this image under normal container semantics: it
# documents that ENTRYPOINT/CMD are never executed (execution goes through
# run_command) and that WORKDIR *is* honoured, but says nothing either way
# about USER. Adding one blind is not free — the SDK writes main.py into
# /tmp/run through its own platform layer and then runs it, so a non-root USER
# could break that handoff on file permissions, and this path is only
# exercisable against the live provider. Settle it with a `run_command("id")`
# probe against the real image before changing anything here.
#
# 2026-08-06: the probe has been run against the published image, deny-all
# egress, and it reports `uid=0(root) gid=0(root) groups=0(root)` with
# os.getcwd() == /tmp/run. So WORKDIR is honoured, the platform imposes no USER,
# and the code here runs as root. That answers "is it observable"; it does not
# answer "does a non-root USER survive the SDK's write of main.py", which is
# still untested and is the half that decides whether this line changes.
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["python"]
