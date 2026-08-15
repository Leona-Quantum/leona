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
# The digest below is `3.13-slim-bookworm` as of 2026-08-05. Updating it is a
# deliberate edit with a reviewable diff, which is the entire point; the tag is
# kept alongside so the next person knows which line to re-resolve.
FROM python:3.13-slim-bookworm@sha256:9d7f287598e1a5a978c015ee176d8216435aaf335ed69ac3c38dd1bbb10e8d64

# This image is the Vercel Sandbox root filesystem for generated quantum code.
# Keep it dependency-complete because production sandboxes are created with the
# explicit deny-all network policy and cannot install packages at runtime.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Two HIGH findings that `container_scan` (trivy, HIGH+CRITICAL) reports against
# this image, both in packages nothing here asks for directly — one ships with the
# base image, one arrives transitively:
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
# Pinned to the fixed versions rather than left to float, because everything else
# in this file is exact-pinned for the same reason: production sandboxes are
# created with the deny-all network policy and cannot install anything at runtime,
# so what is baked in here is the whole world the code gets.
#
# Worth knowing when this next changes: the scan passed on 2026-08-14 and failed on
# 2026-08-15 against a base-image digest refresh that touched nothing else. Trivy's
# vulnerability database updates daily, so a scan going red without the Dockerfile
# changing usually means the database learned something, not that the image did.
RUN python -m pip install --no-cache-dir --only-binary=:all: \
    "setuptools==78.1.1" \
    "msgpack==1.2.1" \
    "qiskit==2.5.0" \
    "qiskit-aer==0.17.2" \
    "pennylane==0.43.1" \
    "cirq-core==1.6.1" \
    "amazon-braket-sdk==1.122.0" \
    "amazon-braket-default-simulator==1.39.5" \
    "numba==0.66.0" \
    "qibo==0.3.4" \
    "qulacs==0.6.14" \
    "gast==0.7.0"

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
