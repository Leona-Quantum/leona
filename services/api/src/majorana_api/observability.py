"""AD-10: OTel once, exported twice — Sentry for errors, OTLP for traces.

Everything is env-gated so local dev and CI run with zero observability
config: SENTRY_DSN wires Sentry, the standard OTEL_EXPORTER_OTLP_* variables
wire the OTLP exporter (Grafana Cloud). Both services (api, worker) call
init_telemetry; the FastAPI auto-instrumentation stays in app.py.
"""

import os
from typing import Any

from opentelemetry.sdk.trace import TracerProvider

#: Request-body keys whose value must never leave this process inside an error
#: report. `api_key` is `PUT /v1/qpu/credentials` — an IBM Quantum API key in
#: plaintext, in the body of a request that a 500 would ship to Sentry.
#:
#: sentry-sdk's `max_request_body_size` defaults to "medium", which attaches
#: JSON request bodies up to 10 KB to every event, and that default is NOT gated
#: behind `send_default_pii` — only cookies are.
#:
#: Belt and braces, and honestly labelled as such: sentry-sdk's own
#: `EventScrubber` already filters `request.data` by field name and `api_key` is
#: in its default denylist, so this was measured to be redundant for the job it
#: was written for. It stays because it costs nothing and does not depend on a
#: vendor default staying where it is.
#:
#: **It is not what stops the leak.** See `include_local_variables` below.
#:
#: Scrubbing by KEY rather than by route: a route can be renamed and a body can
#: be captured by a middleware nobody remembered, but the field name is carried
#: by the payload itself.
SENSITIVE_BODY_KEYS = frozenset({"api_key", "apikey", "token", "password", "secret"})


def _scrub_event(event: dict, _hint: Any) -> dict:
    """Remove sensitive request-body fields before an event is sent."""
    request = event.get("request")
    if isinstance(request, dict):
        data = request.get("data")
        if isinstance(data, dict):
            request["data"] = {
                key: ("[scrubbed]" if key.lower() in SENSITIVE_BODY_KEYS else value)
                for key, value in data.items()
            }
        elif isinstance(data, str):
            # An unparsed body. There is no safe way to redact a field out of a
            # string whose structure is unknown, and a credential route posts
            # JSON, so the whole body goes rather than a guess at part of it.
            if any(key in data.lower() for key in SENSITIVE_BODY_KEYS):
                request["data"] = "[scrubbed]"
    return event


def init_telemetry(service_name: str) -> TracerProvider | None:
    """Idempotent per-process init. Returns the tracer provider when OTLP is
    configured (callers that want spans get a tracer from the global API)."""
    if os.environ.get("SENTRY_DSN"):
        import sentry_sdk

        sentry_sdk.init(
            dsn=os.environ["SENTRY_DSN"],
            environment=os.environ.get("MAJORANA_ENV", "dev"),
            traces_sample_rate=0.1,
            # THIS is what stops a provider credential reaching Sentry, and it
            # was measured rather than reasoned about. `include_local_variables`
            # defaults to True, so every frame's locals are attached to an event.
            # sentry-sdk's own scrubber filters those BY VARIABLE NAME, and:
            #
            #   `api_key`     -> in the default denylist, filtered.
            #   `body`        -> NOT in it. The FastAPI handler parameter on
            #                    `PUT /v1/qpu/credentials` is named `body`, and
            #                    its repr is a pydantic model repr reading
            #                    `QpuCredentialRequest(provider='ibm',
            #                    api_key='<the user's real key>', ...)`.
            #   `credential`  -> NOT in it either (`credentials`, plural, IS).
            #                    That is the worker's local holding the DECRYPTED
            #                    token in `handlers.handle_qpu_run`.
            #
            # Both were captured end to end against a real `sentry_sdk.init`: a
            # 500 anywhere in that handler shipped the plaintext key. The
            # reachable trigger is ordinary — two concurrent first-time connects
            # (a double-clicked button) race `upsert`'s get-then-insert, and the
            # loser raises IntegrityError inside that frame.
            #
            # Turning locals off is the fix rather than adding "body" and
            # "credential" to a denylist, because a denylist holds the names
            # somebody thought of, and the next local holding a secret will have
            # a name nobody thought of. The cost is real — no frame values in
            # tracebacks — and it is the right trade in the two services that
            # handle other people's provider credentials.
            include_local_variables=False,
            before_send=_scrub_event,
            # MAJORANA_RELEASE is the deploy's short git SHA (deploy.yml), so an
            # event can be tied to the exact commit that produced it. Absent in
            # local dev/CI; sentry-sdk treats `release=None` as no release.
            release=os.environ.get("MAJORANA_RELEASE"),
        )
        # api and worker share one Sentry project (docs/runbooks/secrets.md) —
        # both are majorana-api's dependency tree and neither owns a project of
        # its own. Without this tag, "which service produced this event" is a
        # question only the stack trace's file paths can answer, and workers and
        # the API import from mostly-disjoint packages, so it usually can. It
        # should not have to.
        sentry_sdk.set_tag("majorana_service", service_name)

    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return None

    from opentelemetry import trace
    from opentelemetry import metrics
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    metrics.set_meter_provider(
        MeterProvider(
            resource=resource,
            metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())],
        )
    )
    return provider
