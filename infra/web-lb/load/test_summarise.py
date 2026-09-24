#!/usr/bin/env python3
"""Self-test for summarise.py, against a synthetic k6 JSON fixture.

Proves two things a real run cannot cheaply prove, because a real run's
"correct" numbers are exactly what we're trying to compute in the first
place:
  1. the crawler/Atlas/non-Atlas class split -- a point tagged one way never
     leaks into another group's totals
  2. per-class latency is computed from exactly that class's own durations,
     never pooled across classes or scenarios

Run directly (no pytest needed): `python3 test_summarise.py`
Or with pytest, if it's on PATH: `pytest test_summarise.py`
"""

import json
import sys
import tempfile
import os

import summarise


def _point(metric, t, value, scenario, cls, code, src):
    return json.dumps({
        "metric": metric,
        "type": "Point",
        "data": {"time": t, "value": value, "tags": {"scenario": scenario, "cls": cls, "code": code, "src": src}},
    })


def make_fixture():
    """Three groups, deliberately built with non-overlapping latencies so a
    split bug (pooling durations across groups or classes) changes the p50
    printed for a group that fixture did not touch.

    - crawler/map:    3 x 200 (durations ~100-120ms), 2 x 429 src=cloudrun (durations ~5-6ms)
                       all in bucket 0 (t=0..90s)
    - crawler/node:   2 x 200 (durations ~50-60ms), all in bucket 0
    - browse/map (Atlas, legit user): 4 x 200 (durations ~900-1100ms), 1 x 429 src=cloudflare
                       -- deliberately an order of magnitude slower than the crawler's, so a
                       group-pooling bug is visible immediately in p50
    - browse/home (non-Atlas, legit user): 5 x 200 (durations ~150-200ms), all in bucket 1 (t=360..450s,
                       i.e. the SECOND 5-minute bucket) to prove bucketing separates the transient
                       from steady state
    """
    lines = []

    def add(metric_pairs, t, scenario, cls, code, src):
        for metric, value in metric_pairs:
            lines.append(_point(metric, t, value, scenario, cls, code, src))

    # crawler / map: successes
    for i, (t, dur) in enumerate([(0, 100), (10, 110), (20, 120)]):
        ts = f"2026-09-24T12:00:{t:02d}Z"
        add([("resp", 1)], ts, "crawler", "map", "200", "app")
        add([("resp_duration", dur)], ts, "crawler", "map", "200", "app")
    # crawler / map: refused (429 by cloudrun)
    for t, dur in [(30, 5), (40, 6)]:
        ts = f"2026-09-24T12:00:{t:02d}Z"
        add([("resp", 1)], ts, "crawler", "map", "429", "cloudrun")
        add([("resp_duration", dur)], ts, "crawler", "map", "429", "cloudrun")
    # crawler / node: successes
    for t, dur in [(5, 50), (15, 60)]:
        ts = f"2026-09-24T12:00:{t:02d}Z"
        add([("resp", 1)], ts, "crawler", "node", "200", "app")
        add([("resp_duration", dur)], ts, "crawler", "node", "200", "app")

    # legit users' Atlas (browse/map): successes, MUCH slower than the crawler's map class
    for t, dur in [(1, 900), (11, 1000), (21, 1000), (31, 1100)]:
        ts = f"2026-09-24T12:00:{t:02d}Z"
        add([("resp", 1)], ts, "browse", "map", "200", "app")
        add([("resp_duration", dur)], ts, "browse", "map", "200", "app")
    # legit users' Atlas: one refused, by Cloudflare (not Cloud Run)
    ts = "2026-09-24T12:00:41Z"
    add([("resp", 1)], ts, "browse", "map", "429", "cloudflare")
    add([("resp_duration", 3)], ts, "browse", "map", "429", "cloudflare")

    # legit users' non-Atlas (browse/home): all successes, all in the SECOND bucket
    for t, dur in [(0, 150), (30, 160), (60, 170), (90, 180), (120, 200)]:
        ts = f"2026-09-24T12:06:{t%60:02d}Z" if t < 60 else f"2026-09-24T12:0{6+t//60}:{t%60:02d}Z"
        add([("resp", 1)], ts, "browse", "home", "200", "app")
        add([("resp_duration", dur)], ts, "browse", "home", "200", "app")

    return "\n".join(lines) + "\n"


def with_fixture(fn):
    fixture = make_fixture()
    fd, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(fixture)
        return fn(path)
    finally:
        os.unlink(path)


def test_group_split_counts():
    def run(path):
        counts, durations, first, last = summarise.load([path])
        report = summarise.build_report(counts, durations)
        g = report["groups"]
        assert set(g) == {"a_crawler", "b_users_atlas", "c_users_other"}, g.keys()
        assert g["a_crawler"]["total"]["n"] == 7, g["a_crawler"]["total"]  # 3+2 map, 2 node
        assert g["a_crawler"]["total"]["success"] == 5
        assert g["a_crawler"]["total"]["429"] == 2
        assert g["a_crawler"]["total"]["429_by_src"] == {"cloudrun": 2}
        assert g["b_users_atlas"]["total"]["n"] == 5  # 4 success + 1 refused, all cls=map
        assert g["b_users_atlas"]["total"]["success"] == 4
        assert g["b_users_atlas"]["total"]["429_by_src"] == {"cloudflare": 1}
        assert g["c_users_other"]["total"]["n"] == 5
        assert g["c_users_other"]["total"]["success"] == 5
        # the crawler's own "map" class must never be confused with the users' "map" class
        assert g["a_crawler"]["by_class"]["map"]["n"] == 5
        assert g["b_users_atlas"]["by_class"]["map"]["n"] == 5
    with_fixture(run)
    print("test_group_split_counts: OK")


def test_per_class_latency_not_pooled():
    def run(path):
        counts, durations, first, last = summarise.load([path])
        report = summarise.build_report(counts, durations)
        crawler_map_p50 = report["groups"]["a_crawler"]["by_class"]["map"]["latency_ok_ms"]["p50"]
        users_map_p50 = report["groups"]["b_users_atlas"]["by_class"]["map"]["latency_ok_ms"]["p50"]
        crawler_node_p50 = report["groups"]["a_crawler"]["by_class"]["node"]["latency_ok_ms"]["p50"]
        # crawler/map successes were 100,110,120 -> pct()'s index = round(0.5*2) = 1 -> 110
        assert crawler_map_p50 == 110, crawler_map_p50
        # crawler/node successes were 50,60 -> pct()'s index = round(0.5*1) = 0 (banker's
        # rounding: 0.5 -> 0, the even choice) -> 50
        assert crawler_node_p50 == 50, crawler_node_p50
        # legit users' Atlas successes were 900,1000,1000,1100 -> index round(0.5*3)=round(1.5)=2 -> 1000
        assert users_map_p50 == 1000, users_map_p50
        # THE key assertion: a class-split or scenario-split bug that pools durations
        # would drag these toward each other. They must stay an order of magnitude apart.
        assert users_map_p50 > 5 * crawler_map_p50, (users_map_p50, crawler_map_p50)
        # refused-response latency is reported separately from successful-response latency
        crawler_map_refused = report["groups"]["a_crawler"]["by_class"]["map"]["latency_refused_ms"]
        assert crawler_map_refused["n"] == 2
        assert crawler_map_refused["p50"] == 5  # sorted [5,6], index round(0.5*1)=0 -> 5, disjoint from the 100-120 success range
    with_fixture(run)
    print("test_per_class_latency_not_pooled: OK")


def test_time_buckets_separate_transient_from_steady_state():
    def run(path):
        counts, durations, first, last = summarise.load([path])
        buckets = summarise.populate_buckets([path], 5, first)
        by_key = {(b["bucket"], b["group"]): b for b in buckets}
        # crawler + legit Atlas traffic is all in bucket 0 (t=0..41s)
        assert (0, "a_crawler") in by_key
        assert (0, "b_users_atlas") in by_key
        # legit non-Atlas (browse/home) traffic was placed 360s+ into the run -> bucket 1
        assert (1, "c_users_other") in by_key, sorted(by_key)
        assert (0, "c_users_other") not in by_key, "non-Atlas traffic leaked into the wrong bucket"
        assert by_key[(1, "c_users_other")]["n"] == 5
    with_fixture(run)
    print("test_time_buckets_separate_transient_from_steady_state: OK")


def test_suffixed_class_still_classifies_as_atlas():
    """browse.js tags an RSC/prefetch request's class with a suffix
    ("atlas:prefetch", "map:rsc", ...) so the per-class breakdown can show the
    request-type mix. Once map clicks became RSC requests (2026-09-24 21:40
    UTC correction), MOST of the legitimate users' Atlas traffic carries a
    suffix -- so if group_of() ever goes back to matching the raw tag against
    ATLAS_CLASSES, this is the test that catches it: every one of these rows
    would silently move from block (b) to block (c)."""
    lines = [
        _point("resp", "2026-09-24T12:00:00Z", 1, "browse", "atlas:prefetch", "200", "app"),
        _point("resp", "2026-09-24T12:00:01Z", 1, "browse", "atlas:rsc", "200", "app"),
        _point("resp", "2026-09-24T12:00:02Z", 1, "browse", "map:rsc", "200", "app"),
        _point("resp", "2026-09-24T12:00:03Z", 1, "browse", "map:rsc", "200", "app"),
        _point("resp", "2026-09-24T12:00:04Z", 1, "browse", "record:rsc", "200", "app"),
        _point("resp", "2026-09-24T12:00:05Z", 1, "browse", "home:prefetch", "200", "app"),
        _point("resp", "2026-09-24T12:00:06Z", 1, "browse", "page:prefetch", "200", "app"),
    ]
    fixture = "\n".join(lines) + "\n"
    fd, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(fixture)
        counts, durations, first, last = summarise.load([path])
        report = summarise.build_report(counts, durations)
        assert report["groups"]["b_users_atlas"]["total"]["n"] == 5, report["groups"].get("b_users_atlas")
        assert report["groups"]["c_users_other"]["total"]["n"] == 2, report["groups"].get("c_users_other")
        # per-class rows keep the suffix, for the request-type breakdown
        assert set(report["groups"]["b_users_atlas"]["by_class"]) == {"atlas:prefetch", "atlas:rsc", "map:rsc", "record:rsc"}
    finally:
        os.unlink(path)
    print("test_suffixed_class_still_classifies_as_atlas: OK")


def test_challenged_is_reported_separately_from_refused():
    """Cloudflare's Managed Challenge on /repository/layers* (added 2026-09-24
    21:29 UTC) answers 403 with cf-mitigated: challenge -- who() in lib.js
    tags that src=cf-challenge. It is an expected outcome for a raw crawler
    GET, not a failure, so it must not be silently folded into "refused"."""
    lines = [
        _point("resp", "2026-09-24T12:00:00Z", 1, "crawler", "map", "200", "app"),
        _point("resp_duration", "2026-09-24T12:00:00Z", 50, "crawler", "map", "200", "app"),
        _point("resp", "2026-09-24T12:00:01Z", 1, "crawler", "map", "403", "cf-challenge"),
        _point("resp_duration", "2026-09-24T12:00:01Z", 20, "crawler", "map", "403", "cf-challenge"),
        _point("resp", "2026-09-24T12:00:02Z", 1, "crawler", "map", "403", "cf-challenge"),
        _point("resp_duration", "2026-09-24T12:00:02Z", 22, "crawler", "map", "403", "cf-challenge"),
        _point("resp", "2026-09-24T12:00:03Z", 1, "crawler", "map", "429", "cloudrun"),
        _point("resp_duration", "2026-09-24T12:00:03Z", 5, "crawler", "map", "429", "cloudrun"),
    ]
    fixture = "\n".join(lines) + "\n"
    fd, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(fixture)
        counts, durations, first, last = summarise.load([path])
        report = summarise.build_report(counts, durations)
        s = report["groups"]["a_crawler"]["by_class"]["map"]
        assert s["n"] == 4
        assert s["success"] == 1
        assert s["challenged"] == 2
        assert s["429"] == 1
        assert s["other"] == 0, s  # the two challenges must NOT land in "other" either
        assert s["latency_challenged_ms"]["n"] == 2
        assert s["latency_refused_ms"]["n"] == 1  # only the 429, not the challenges
    finally:
        os.unlink(path)
    print("test_challenged_is_reported_separately_from_refused: OK")


def test_ts_parsing_handles_offset_and_long_fraction():
    # k6 has been observed to emit a local-timezone offset (not just Z) and
    # more than six fractional-second digits; both must parse, not raise, and
    # both must land on the SAME instant as their plain-UTC equivalent.
    a = summarise.parse_ts("2026-09-24T14:25:36.158506-07:00")
    b = summarise.parse_ts("2026-09-24T21:25:36.158506Z")  # same instant, UTC
    assert abs(a - b) < 1e-6, (a, b)
    c = summarise.parse_ts("2026-09-24T21:25:36.1585067890Z")  # 9 fractional digits (>%f's 6)
    assert abs(c - b) < 1e-6, (c, b)
    print("test_ts_parsing_handles_offset_and_long_fraction: OK")


ALL_TESTS = [
    test_group_split_counts,
    test_per_class_latency_not_pooled,
    test_time_buckets_separate_transient_from_steady_state,
    test_suffixed_class_still_classifies_as_atlas,
    test_challenged_is_reported_separately_from_refused,
    test_ts_parsing_handles_offset_and_long_fraction,
]


if __name__ == "__main__":
    failures = 0
    for t in ALL_TESTS:
        try:
            t()
        except AssertionError as e:
            failures += 1
            print(f"{t.__name__}: FAILED -- {e}")
    if failures:
        print(f"\n{failures}/{len(ALL_TESTS)} tests failed")
        sys.exit(1)
    print(f"\nall {len(ALL_TESTS)} tests passed")
