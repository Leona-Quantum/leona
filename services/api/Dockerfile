# One image for api + worker (02-architecture §2): the entrypoint decides.
# Build context is the REPO ROOT (uv workspace needs all member pyprojects):
#   docker build -f services/api/Dockerfile .
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
WORKDIR /app
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
COPY pyproject.toml uv.lock ./
COPY services ./services
COPY packages/py ./packages/py
COPY evals/harness ./evals/harness
COPY db ./db
RUN uv sync --all-packages --frozen --no-dev

FROM python:3.12-slim-bookworm
WORKDIR /app
RUN useradd --uid 1001 --create-home appuser
COPY --from=build --chown=appuser /app /app
USER appuser
ENV PATH="/app/.venv/bin:$PATH" PORT=8080
# api (default): uvicorn control plane. worker: override command with
#   python -m majorana_worker  (Phase 2 — worker loop lands with the pipeline)
CMD ["sh", "-c", "exec uvicorn --factory majorana_api.app:create_app --host 0.0.0.0 --port ${PORT}"]
