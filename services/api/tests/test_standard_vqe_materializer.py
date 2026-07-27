from majorana_api.standard_vqe_materializer import (
    StandardCatalogDriftError,
    _canonical_bytes,
    _json_value,
    _slug,
)
from majorana_vqe.standard_catalog import STANDARD_COMPONENTS


def test_standard_seed_serialization_and_slug_are_deterministic():
    definition = STANDARD_COMPONENTS[0]
    first = _canonical_bytes(_json_value(definition))
    second = _canonical_bytes(_json_value(definition))
    assert first == second
    assert _slug("component", definition.semantic_key) == _slug(
        "component", definition.semantic_key
    )
    assert definition.semantic_key.encode() in first


def test_standard_seed_slug_separates_definitions_and_workflows():
    key = "same.semantic.key"
    assert _slug("component", key) != _slug("workflow", key)


def test_catalog_drift_has_a_distinct_failure_type():
    assert issubclass(StandardCatalogDriftError, RuntimeError)
