"""AD-10: OTel once, exported twice — Sentry for errors, OTLP for traces.

Everything is env-gated so local dev and CI run with zero observability
config: SENTRY_DSN wires Sentry, the standard OTEL_EXPORTER_OTLP_* variables
wire the OTLP exporter (Grafana Cloud). Both services (api, worker) call
init_telemetry; the FastAPI auto-instrumentation stays in app.py.
"""

import os

from opentelemetry.sdk.trace import TracerProvider


def init_telemetry(service_name: str) -> TracerProvider | None:
    """Idempotent per-process init. Returns the tracer provider when OTLP is
    configured (callers that want spans get a tracer from the global API)."""
    if os.environ.get("SENTRY_DSN"):
        import sentry_sdk

        sentry_sdk.init(
            dsn=os.environ["SENTRY_DSN"],
            environment=os.environ.get("MAJORANA_ENV", "dev"),
            traces_sample_rate=0.1,
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
