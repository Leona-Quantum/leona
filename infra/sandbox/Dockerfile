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

RUN python -m pip install --no-cache-dir --only-binary=:all: \
    "qiskit==2.5.0" \
    "qiskit-aer==0.17.2" \
    "pennylane==0.43.1" \
    "cirq-core==1.6.1" \
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
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["python"]
