import json

import pytest

from majorana_llm import (
    LLMResponse,
    ResearchEvidenceBundle,
    ResearchEvidenceItem,
    ResearchResponseRejected,
    build_research_candidate_envelope,
    build_research_extraction_request,
    parse_research_candidate_response,
)


def _bundle() -> ResearchEvidenceBundle:
    return ResearchEvidenceBundle(
        repository_id=123,
        commit_sha="a" * 40,
        snapshot_sha256="b" * 64,
        phase8_extractor_version="v1",
        items=(
            ResearchEvidenceItem(
                evidence_id="ev_symbol",
                kind="python_syntax",
                path="example.py",
                source_sha256="c" * 64,
                locator="L1:0-L1:5",
                declared_value={"qualified_name": "example.UCCSD"},
            ),
        ),
    )


def _response(*, evidence_id: str = "ev_symbol") -> str:
    return json.dumps(
        {
            "schema_version": "atlas.research-candidate-response.v1",
            "candidates": [
                {
                    "local_id": "candidate_uccsd",
                    "candidate_type": "implementation",
                    "fields": [
                        {
                            "field": "symbol",
                            "value": "UCCSD",
                            "evidence_ids": [evidence_id],
                        }
                    ],
                    "unknowns": [],
                    "conflicts": [],
                }
            ],
        },
        separators=(",", ":"),
    )


def test_strict_parser_accepts_complete_evidence_bound_response():
    parsed = parse_research_candidate_response(_response(), bundle=_bundle())

    assert parsed.candidates[0].fields[0].evidence_ids == ("ev_symbol",)


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        (b"\xff", "invalid_response_utf8"),
        ("[1]", "response_root_not_object"),
        ("{", "invalid_response_json"),
        (
            '{"schema_version":"atlas.research-candidate-response.v1",'
            '"schema_version":"atlas.research-candidate-response.v1","candidates":[]}',
            "duplicate_response_json_key",
        ),
        (
            '{"schema_version":"atlas.research-candidate-response.v1","candidates":[],"value":NaN}',
            "nonfinite_response_number",
        ),
    ],
)
def test_parser_rejects_invalid_whole_response_with_stable_code(raw, code):
    with pytest.raises(ResearchResponseRejected) as caught:
        parse_research_candidate_response(raw, bundle=_bundle())

    assert caught.value.code == code


def test_dangling_evidence_and_extra_fields_reject_every_candidate():
    with pytest.raises(ResearchResponseRejected) as caught:
        parse_research_candidate_response(_response(evidence_id="ev_invented"), bundle=_bundle())
    assert caught.value.code == "invalid_candidate_response"

    decoded = json.loads(_response())
    decoded["candidates"][0]["review_state"] = "human_reviewed"
    with pytest.raises(ResearchResponseRejected) as caught:
        parse_research_candidate_response(json.dumps(decoded), bundle=_bundle())
    assert caught.value.code == "invalid_candidate_response"


def test_secret_like_model_output_is_rejected_without_echoing_it():
    secret = "sk-proj_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"
    decoded = json.loads(_response())
    decoded["candidates"][0]["fields"][0]["value"] = secret

    with pytest.raises(ResearchResponseRejected) as caught:
        parse_research_candidate_response(json.dumps(decoded), bundle=_bundle())

    assert caught.value.code == "potential_secret_in_candidate"
    assert secret not in str(caught.value)


def test_envelope_retains_provenance_but_cannot_be_public_or_materializable():
    bundle = _bundle()
    request = build_research_extraction_request(bundle, model="requested-model")
    provider_response = LLMResponse(
        text=_response(),
        model="served-model-revision",
        input_tokens=101,
        output_tokens=22,
    )

    first = build_research_candidate_envelope(
        provider="test-provider",
        bundle=bundle,
        request=request,
        provider_response=provider_response,
    )
    second = build_research_candidate_envelope(
        provider="test-provider",
        bundle=bundle,
        request=request,
        provider_response=provider_response,
    )

    assert first == second
    assert first.deterministic_digest == second.deterministic_digest
    assert first.requested_model == "requested-model"
    assert first.served_model == "served-model-revision"
    assert first.input_tokens == 101
    assert first.output_tokens == 22
    assert first.human_review_state == "unreviewed"
    assert first.publication_eligible is False
    assert first.materialization_eligible is False


def test_tampered_request_is_rejected_before_envelope_creation():
    bundle = _bundle()
    request = build_research_extraction_request(bundle, model="requested-model")
    tampered = request.model_copy(update={"temperature": 1.0})

    with pytest.raises(ResearchResponseRejected) as caught:
        build_research_candidate_envelope(
            provider="test-provider",
            bundle=bundle,
            request=tampered,
            provider_response=LLMResponse(
                text=_response(),
                model="served-model",
                input_tokens=1,
                output_tokens=1,
            ),
        )

    assert caught.value.code == "request_provenance_mismatch"
