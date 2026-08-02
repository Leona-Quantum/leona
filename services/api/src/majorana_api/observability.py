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
#: This is not theoretical. sentry-sdk's `max_request_body_size` defaults to
#: "medium", which attaches JSON request bodies up to 10 KB to every event, and
#: that default is NOT gated behind `send_default_pii`. Without this scrubber,
#: one unhandled exception anywhere on the connect path puts a user's provider
#: credential into an external error tracker, permanently, with no way to know
#: whose it was.
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
            before_send=_scrub_event,
        )

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
