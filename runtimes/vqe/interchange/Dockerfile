ARG PYTHON_BASE=python:3.12.12-slim-bookworm@sha256:2986c55feb36e6cae00fa1fefb454283e4b33f35e75ff8bdd123b134130be301
FROM ${PYTHON_BASE}

ARG UV_VERSION=0.9.8

ENV PYTHONHASHSEED=0 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    MPLCONFIGDIR=/tmp/matplotlib \
    NUMEXPR_NUM_THREADS=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_HTTP_TIMEOUT=120 \
    UV_LINK_MODE=copy \
    PYTHONPATH=/workspace/runtimes/vqe/interchange

RUN python -m pip install "uv==${UV_VERSION}" \
    && groupadd --gid 65532 vqe \
    && useradd --uid 65532 --gid 65532 --no-create-home --home-dir /nonexistent vqe

WORKDIR /workspace
COPY packages/py/vqe /workspace/packages/py/vqe
COPY runtimes/vqe/interchange/pyproject.toml runtimes/vqe/interchange/uv.lock \
    /workspace/runtimes/vqe/interchange/
RUN uv sync --project /workspace/runtimes/vqe/interchange --frozen --no-dev \
    && uv cache clean \
    && find /workspace/runtimes/vqe/interchange/.venv -type d -name __pycache__ \
       -prune -exec rm -rf '{}' +

COPY runtimes/vqe/interchange/adapter.py \
     runtimes/vqe/interchange/generate_evidence.py \
     /workspace/runtimes/vqe/interchange/
COPY docs/atlas/fixtures/h2_sto3g/manifest.json \
     /workspace/docs/atlas/fixtures/h2_sto3g/manifest.json

RUN chown -R 65532:65532 /workspace
USER 65532:65532
WORKDIR /workspace

ENTRYPOINT ["/workspace/runtimes/vqe/interchange/.venv/bin/python", \
            "/workspace/runtimes/vqe/interchange/generate_evidence.py", \
            "--stdout-only"]
