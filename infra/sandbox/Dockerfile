FROM python:3.13-slim-bookworm

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
