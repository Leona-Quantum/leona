"""The finder's rules, the record rendering, and "not stated", on real catalog rows.

Every expected verdict and sentence below is what `apps/web/lib/repository/finder.ts`
produces for the same row (with `estimatesAvailable` false), so a failure here means
this package and the site now disagree about a record.
"""

from __future__ import annotations

import pytest
from leona_client_fixtures import raw_rows, record, row, rows

from leona_client.atlas import (
    MAX_RESULTS,
    NOT_STATED,
    AtlasRow,
    SearchLimits,
    UnrenderableCircuit,
    check_hardware,
    check_numeric_limit,
    literature,
    method_detail,
    normalize_slug,
    openqasm,
    parse_rows,
    portable_circuit_to_openqasm,
    problem_area_counts,
    resolve_problem_area,
    search,
    similar_slugs,
    stated_cost,
    stated_regime,
    verification,
)


def slugs(result: dict) -> list[str]:
    return [item["slug"] for item in result["results"]]


# --- reading rows ---------------------------------------------------------------------


def test_every_fixture_row_parses_with_its_envelope():
    parsed = rows()
    assert len(parsed) == 10
    first = parsed[0]
    assert first.execution_state == "template_only"
    assert first.updated_at and first.updated_at.endswith("Z")


def test_a_row_without_a_readable_record_is_dropped_and_named():
    good = raw_rows()[0]
    payload = [
        good,
        {"slug": "no-record", "record": None},
        {"slug": "not-an-object", "record": ["x"]},
        {"slug": "no-title", "record": {"slug": "no-title"}},
        "not a row",
    ]
    parsed, rejected = parse_rows(payload)
    assert [r.slug for r in parsed] == [good["slug"]]
    assert rejected == ["no-record", "not-an-object", "no-title", "index:4"]


def test_a_payload_that_is_not_a_list_is_refused():
    assert parse_rows({"rows": []}) == ([], ["<payload is not a list>"])


# --- numeric limits, as checkNumericLimit ---------------------------------------------


def test_a_stated_qubit_count_within_the_limit_is_satisfied():
    c = check_numeric_limit(record("hadamard-gate"), "Qubits", 1)
    assert (c.verdict, c.detail) == ("satisfied", "Qubits: 1 ≤ 1.")


def test_a_stated_qubit_count_over_the_limit_is_violated():
    c = check_numeric_limit(record("benchmark-ghz-chain-3q"), "Qubits", 2)
    assert (c.verdict, c.detail) == ("violated", "Qubits: 3 exceeds your limit of 2.")


def test_the_leading_integer_of_a_worded_value_is_what_is_compared():
    # "2 toy" parses to 2, exactly as parseLeadingInt does; "1 gate" parses to 1.
    assert check_numeric_limit(record("grover-unstructured-search"), "Qubits", 2).verdict == (
        "satisfied"
    )
    assert check_numeric_limit(record("grover-unstructured-search"), "Qubits", 1).verdict == (
        "violated"
    )
    depth = check_numeric_limit(record("hadamard-gate"), "Depth", 0)
    assert (depth.verdict, depth.detail) == ("violated", "Depth: 1 gate exceeds your limit of 0.")


def test_a_value_that_is_not_a_number_is_not_stated_and_says_what_it_was():
    c = check_numeric_limit(record("bernstein-vazirani-qiskit"), "Qubits", 1)
    assert c.verdict == "not-stated"
    assert c.detail == (
        'Qubits: "n + 1" (stated, but not a single number to compare against your limit).'
    )
    d = check_numeric_limit(record("grover-unstructured-search"), "Depth", 5)
    assert d.verdict == "not-stated"
    assert '"Oracle + diffusion"' in d.detail


def test_a_record_with_no_qubit_row_is_not_stated():
    c = check_numeric_limit(record("quantum-phase-estimation"), "Qubits", 5)
    assert (c.verdict, c.detail) == ("not-stated", "Qubits: not stated in the source.")


# --- hardware, as checkHardwareEra with estimatesAvailable false ----------------------


def test_nisq_needs_a_published_runnable_circuit():
    ok = check_hardware(record("benchmark-ghz-chain-3q"), "nisq")
    assert (ok.verdict, ok.detail) == ("satisfied", "Publishes a runnable 3-qubit circuit.")
    no = check_hardware(record("quantum-phase-estimation"), "nisq")
    assert (no.verdict, no.detail) == (
        "violated",
        "No runnable circuit is published for this record.",
    )


def test_fault_tolerant_is_satisfied_only_by_a_stated_readiness_and_never_excludes():
    shor = check_hardware(record("shor-period-finding"), "fault-tolerant")
    assert (shor.verdict, shor.detail) == ("satisfied", 'The record states: "FTQC required".')
    other = check_hardware(record("quantum-phase-estimation"), "fault-tolerant")
    assert other.verdict == "not-stated"
    result = search(rows(), SearchLimits(hardware="fault-tolerant"))
    assert result["total_matches"] == 10


# --- search_methods -------------------------------------------------------------------


def test_no_limits_returns_everything_sorted_by_slug():
    result = search(rows(), SearchLimits())
    assert result["total_matches"] == 10
    assert slugs(result) == sorted(slugs(result))
    assert result["excluded_by_only"] == {}
    assert "Not ranked" in result["order"]


def test_query_matches_any_word_case_insensitively():
    result = search(rows(), SearchLimits(query="GROVER Pell"))
    assert slugs(result) == ["grover-unstructured-search", "pell-equation-regulator"]


def test_match_all_requires_every_word():
    any_word = search(rows(), SearchLimits(query="phase benchmark"))
    all_words = search(rows(), SearchLimits(query="phase benchmark", match_all=True))
    assert "quantum-phase-estimation" in slugs(any_word)
    assert slugs(all_words) == ["benchmark-phase-feature-map-3q"]


def test_query_reads_the_same_fields_as_the_site_search():
    # algorithmFamily ("Eigenvalue estimation"), provenance ("Primary paper"), the
    # Japanese title and a tag are each enough on their own.
    assert "quantum-phase-estimation" in slugs(search(rows(), SearchLimits(query="eigenvalue")))
    assert slugs(search(rows(), SearchLimits(query="primary paper", match_all=True))) == [
        "bernstein-vazirani-qiskit"
    ]
    assert slugs(search(rows(), SearchLimits(query="アダマールゲート"))) == ["hadamard-gate"]
    assert slugs(search(rows(), SearchLimits(query="reed-solomon"))) == [
        "decoded-quantum-interferometry"
    ]


def test_query_criterion_names_the_words_that_matched():
    result = search(rows(), SearchLimits(query="phase estimation nothingmatchesthis"))
    qpe = next(r for r in result["results"] if r["slug"] == "quantum-phase-estimation")
    assert qpe["limits"] == [
        {"limit": "query", "verdict": "satisfied", "detail": "Matches: phase, estimation."}
    ]


def test_problem_area_keeps_only_records_carrying_it():
    result = search(rows(), SearchLimits(problem_area="cryptography"))
    assert slugs(result) == ["shor-period-finding"]
    assert result["excluded_by_only"] == {"problem_area": 9}


def test_not_stated_never_excludes_but_violated_does():
    result = search(rows(), SearchLimits(max_qubits=2))
    got = {r["slug"]: r["limits"][0]["verdict"] for r in result["results"]}
    # ghz (3) and the feature map (3) state more than 2; everything else stays.
    assert "benchmark-ghz-chain-3q" not in got
    assert "benchmark-phase-feature-map-3q" not in got
    assert got["hadamard-gate"] == "satisfied"
    assert got["grover-unstructured-search"] == "satisfied"
    assert got["bernstein-vazirani-qiskit"] == "not-stated"
    assert got["quantum-phase-estimation"] == "not-stated"
    assert result["total_matches"] == 8
    assert result["excluded_by_only"] == {"qubits": 2}


def test_excluded_by_only_counts_records_failing_just_that_limit():
    result = search(rows(), SearchLimits(max_qubits=2, hardware="nisq"))
    # Only the two benchmarks publish a circuit, and both break the qubit limit.
    assert result["total_matches"] == 0
    assert result["excluded_by_only"] == {"qubits": 2, "hardware": 8}


def test_results_page_with_offset_and_are_capped():
    first = search(rows(), SearchLimits(), max_results=4)
    second = search(rows(), SearchLimits(), max_results=4, offset=4)
    assert first["returned"] == 4 and second["returned"] == 4
    assert set(slugs(first)).isdisjoint(slugs(second))
    assert search(rows(), SearchLimits(), max_results=10_000)["returned"] == 10
    many = [AtlasRow(slug=f"s{i:03d}", record={"title": "t"}) for i in range(120)]
    assert search(many, SearchLimits(), max_results=10_000)["returned"] == MAX_RESULTS


def test_a_result_row_is_compact_and_links_to_the_record():
    result = search(rows(), SearchLimits(query="superposition foundations", match_all=True))
    assert result["results"] == [
        {
            "slug": "hadamard-gate",
            "title": "Hadamard gate",
            "description": record("hadamard-gate")["description"],
            "category": "Gates",
            "limits": [
                {
                    "limit": "query",
                    "verdict": "satisfied",
                    "detail": "Matches: superposition, foundations.",
                }
            ],
            "url": "https://leonaqt.com/repository/hadamard-gate",
        }
    ]


def test_a_long_description_is_cut_at_a_word_on_one_line():
    long = AtlasRow(slug="x", record={"title": "t", "description": "word " * 100})
    text = search([long], SearchLimits())["results"][0]["description"]
    assert text.endswith("...") and len(text) <= 203 and "\n" not in text


# --- problem areas --------------------------------------------------------------------


def test_problem_area_resolves_by_id_or_label_and_names_the_choices_when_wrong():
    assert resolve_problem_area("Linear systems").id == "linear-algebra"
    assert resolve_problem_area(" CHEMISTRY ").id == "chemistry"
    with pytest.raises(ValueError, match="chemistry, materials, optimization"):
        resolve_problem_area("biology")


def test_problem_area_counts_skip_empty_areas_like_the_site_picker():
    counts = {a["id"]: a["records"] for a in problem_area_counts(rows())}
    assert counts == {"chemistry": 1, "optimization": 1, "machine-learning": 1, "cryptography": 1}


# --- stated cost and regime, as statedCost and statedRegime ---------------------------


def test_cost_prefers_the_reported_cost_row():
    cost = stated_cost(record("pell-equation-regulator"))
    assert isinstance(cost, dict)
    assert cost["value"].startswith("Polynomial in log Δ and log δ")


def test_a_reported_cost_that_says_not_stated_is_not_a_cost():
    assert stated_cost(record("decoded-quantum-interferometry")) == NOT_STATED


def test_cost_falls_back_to_qubits_and_depth_rows_worded_as_the_site_words_them():
    assert stated_cost(record("hadamard-gate")) == {
        "value": "1 qubits, 1 gate",
        "from": "the record's Qubits and Depth rows",
    }
    assert stated_cost(record("quantum-phase-estimation")) == NOT_STATED


def test_speedup_checked_against_the_primary_paper():
    regime = stated_regime(record("pell-equation-regulator"))
    assert isinstance(regime, dict)
    assert regime["value"] == "Superpolynomial (checked against the record's own primary paper)"
    assert regime["checked_against_primary_paper"] is True
    assert regime["primary_source_note"].startswith("Stated by the primary source")


def test_speedup_not_yet_checked_says_so():
    regime = stated_regime(record("decoded-quantum-interferometry"))
    assert isinstance(regime, dict)
    assert regime["value"] == (
        "Superpolynomial (from a secondary index; not yet checked against the record's own "
        "primary paper)"
    )
    assert regime["checked_against_primary_paper"] is False


def test_a_primary_paper_that_does_not_state_the_class_still_counts_as_checked():
    # finder.ts only treats "not checked" as unchecked. The recorded note travels with
    # the verdict so a reader can see what "checked" meant here.
    regime = stated_regime(record("quadratically-signed-weight-enumerators"))
    assert isinstance(regime, dict)
    assert regime["checked_against_primary_paper"] is True
    assert regime["primary_source_note"].startswith("Not stated by the primary source")


def test_readiness_is_the_fallback_regime_and_absence_is_not_stated():
    assert stated_regime(record("shor-period-finding")) == {
        "value": "FTQC required",
        "from": 'the record\'s "Readiness" row',
    }
    assert stated_regime(record("hadamard-gate")) == NOT_STATED


# --- verification ---------------------------------------------------------------------


def test_the_tier_is_the_strongest_of_the_record_methods():
    gate = verification(record("hadamard-gate"))
    assert (gate["tier"], gate["tier_name"]) == (1, "Exact & formal")
    assert gate["methods"] == [
        "Unitary / matrix equivalence",
        "Exact statevector simulation",
        "Peer-reviewed paper",
    ]
    assert verification(record("benchmark-ghz-chain-3q"))["tier"] == 2
    assert verification(record("pell-equation-regulator"))["tier"] == 3


def test_verification_prose_is_quoted_and_absence_is_not_stated():
    qpe = verification(record("quantum-phase-estimation"))
    details = record("quantum-phase-estimation")["verificationDetails"]
    assert qpe["summary"] == record("quantum-phase-estimation")["verification"]
    assert (qpe["method"], qpe["result"], qpe["caveat"]) == (
        details["method"],
        details["result"],
        details["caveat"],
    )
    bare = verification({"title": "t"})
    assert bare["tier"] == NOT_STATED and bare["methods"] == NOT_STATED
    assert bare["caveat"] == NOT_STATED and bare["status"] == NOT_STATED


def test_an_unknown_method_id_is_shown_raw_and_does_not_raise_the_tier():
    out = verification({"verificationMethods": ["something_new"]})
    assert out["tier"] == 4 and out["methods"] == ["something_new"]


# --- literature -----------------------------------------------------------------------


def test_literature_is_quoted_as_recorded():
    lit = literature(record("quantum-phase-estimation"))
    assert isinstance(lit, list) and len(lit) == 2
    first = record("quantum-phase-estimation")["literature"][0]
    assert lit[0] == {k: first[k] for k in ("title", "authors", "year", "url", "relevance")}
    assert literature({"literature": []}) == NOT_STATED
    assert literature({"literature": [{"title": "Only a title"}]}) == [
        {
            "title": "Only a title",
            "authors": NOT_STATED,
            "year": NOT_STATED,
            "url": NOT_STATED,
            "relevance": NOT_STATED,
        }
    ]


# --- OpenQASM -------------------------------------------------------------------------


def test_a_recorded_openqasm_variant_is_returned_verbatim():
    gate = record("hadamard-gate")
    recorded = next(v for v in gate["codeVariants"] if v["framework"] == "OpenQASM 3.0")
    out = openqasm(gate)
    assert isinstance(out, dict)
    assert out["code"] == recorded["code"]
    assert out["from"] == "the record's OpenQASM 3.0 code variant"


def test_a_portable_circuit_is_written_out_as_the_site_export_writes_it():
    out = openqasm(record("benchmark-ghz-chain-3q"))
    assert isinstance(out, dict)
    assert out["code"] == "\n".join(
        [
            "OPENQASM 3.0;",
            'include "stdgates.inc";',
            "qubit[3] q;",
            "bit[3] c;",
            "",
            "h q[0];",
            "cx q[0], q[1];",
            "cx q[1], q[2];",
            "c = measure q;",
        ]
    )
    assert "portable gate list" in out["from"]


def test_angles_are_copied_as_recorded():
    code = openqasm(record("benchmark-phase-feature-map-3q"))["code"]  # type: ignore[index]
    assert "rz(1*pi/8) q[0];" in code and "rz(4*pi/8) q[2];" in code


def test_no_circuit_and_no_openqasm_variant_is_not_stated():
    assert openqasm(record("quantum-phase-estimation")) == NOT_STATED


@pytest.mark.parametrize(
    ("circuit", "reason"),
    [
        ({"qubitCount": 2, "steps": [{"gate": "CX", "qubits": [0, 2]}]}, "2-qubit register"),
        ({"qubitCount": 1, "steps": [{"gate": "CCX", "qubits": [0]}]}, "outside the portable"),
        (
            {"qubitCount": 1, "steps": [{"gate": "RZ", "qubits": [0], "param": "theta; x q[0]"}]},
            "angle",
        ),
        ({"qubitCount": 0, "steps": []}, "qubit count"),
    ],
)
def test_a_circuit_that_cannot_be_written_without_guessing_is_refused(circuit, reason):
    with pytest.raises(UnrenderableCircuit, match=reason):
        portable_circuit_to_openqasm(circuit)
    out = openqasm({"portableCircuit": circuit, "codeVariants": []})
    assert isinstance(out, str) and out.startswith(NOT_STATED)


def test_an_unmeasured_circuit_declares_no_bits():
    code = portable_circuit_to_openqasm({"qubitCount": 1, "steps": [{"gate": "H", "qubits": [0]}]})
    assert code.splitlines() == [
        "OPENQASM 3.0;",
        'include "stdgates.inc";',
        "qubit[1] q;",
        "",
        "h q[0];",
    ]


# --- the whole record -----------------------------------------------------------------


def test_method_detail_carries_every_documented_field():
    detail = method_detail(row("quantum-phase-estimation"))
    assert detail["url"] == "https://leonaqt.com/repository/quantum-phase-estimation"
    assert detail["introduction"] == record("quantum-phase-estimation")["introduction"]
    assert detail["explanation"] == record("quantum-phase-estimation")["explanation"]
    assert detail["cost_as_recorded"] == NOT_STATED
    assert detail["speedup_class"] == NOT_STATED
    assert detail["openqasm"] == NOT_STATED
    assert detail["primary_source"]["url"] == "https://arxiv.org/abs/quant-ph/9511026"
    assert "not a result this server checked or ran" in detail["note"]


def test_a_bare_record_says_not_stated_everywhere_instead_of_filling_in():
    detail = method_detail(AtlasRow(slug="bare", record={"title": "Bare"}))
    filled = {k for k, v in detail.items() if v != NOT_STATED}
    assert filled == {"slug", "title", "url", "verification", "note"}
    assert all(value == NOT_STATED for key, value in detail["verification"].items())


def test_a_slug_can_be_given_as_a_record_url():
    assert normalize_slug("https://leonaqt.com/repository/hadamard-gate") == "hadamard-gate"
    assert normalize_slug("https://leonaqt.com/ja/repository/hadamard-gate/?x=1") == "hadamard-gate"
    assert normalize_slug("  hadamard-gate ") == "hadamard-gate"


def test_a_miss_suggests_slugs_containing_the_text_sorted():
    assert similar_slugs(rows(), "benchmark") == [
        "benchmark-ghz-chain-3q",
        "benchmark-phase-feature-map-3q",
    ]
    assert similar_slugs(rows(), "") == []
