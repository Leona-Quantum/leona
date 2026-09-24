#!/usr/bin/env python3
"""Summarise one or more k6 `--out json=` runs of atlas-flood.js and/or browse.js.

Reads the `resp` and `resp_duration` points the scripts emit (never the
rendered k6 summary), which is what lets every number here trace back to a
line in the raw JSON rather than to a paraphrase of it. `resp` and
`resp_duration` carry IDENTICAL tags (scenario, cls, code, src) per response
-- see lib.js -- so a class's latency is always the latency of exactly the
responses counted in that class, never a separately-sampled series.

Reports three blocks, because they answer three different questions:
  (a) the crawler         -- what a distributed scraper meets
  (b) legitimate users' Atlas requests     -- map index, map states, records
  (c) legitimate users' non-Atlas requests -- home, other pages, static
                                               chunks, RSC prefetches, session
"the crawler" is anything tagged scenario=crawler (atlas-flood.js); anything
else (browse.js's `browse`, or atlas-flood.js's simpler `visitor`) is a
legitimate user, split into (b)/(c) by page class.

    python3 summarise.py run.json [run2.json ...] [--json out.json] [--bucket-minutes N]
"""

import argparse
import collections
import datetime
import gzip
import json
import re
import sys

ATLAS_CLASSES = {"atlas", "map", "record"}
SUCCESS_CODE_RE = re.compile(r"^[23]\d\d$")


def pct(values, p):
    if not values:
        return None
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))]


def lat_stats(values):
    if not values:
        return None
    return {
        "n": len(values),
        "p50": pct(values, 50),
        "p95": pct(values, 95),
        "p99": pct(values, 99),
        "max": max(values),
    }


_TS_RE = re.compile(
    r"^(?P<base>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"
    r"(?:\.(?P<frac>\d+))?"
    r"(?P<tz>Z|[+-]\d{2}:\d{2})?$"
)


def parse_ts(t):
    """Epoch seconds (float) from a k6 JSON timestamp. Handles 'Z', a numeric
    UTC offset (k6 on a machine not set to UTC emits e.g. '-07:00'), and any
    fractional-second precision -- k6 has been seen to emit more than the six
    digits Python's %f accepts, so this truncates rather than raising."""
    m = _TS_RE.match(t)
    if not m:
        raise ValueError(f"unparseable k6 timestamp: {t!r}")
    base, frac, tz = m.group("base"), m.group("frac"), m.group("tz")
    norm = base + "." + (frac[:6].ljust(6, "0") if frac else "000000")
    norm += "+00:00" if (tz in (None, "Z")) else tz
    dt = datetime.datetime.strptime(norm, "%Y-%m-%dT%H:%M:%S.%f%z")
    return dt.timestamp()


def open_maybe_gzip(path):
    if path.endswith(".gz"):
        return gzip.open(path, "rt")
    return open(path)


def iter_points(paths):
    for path in paths:
        with open_maybe_gzip(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                if row.get("type") != "Point":
                    continue
                yield row


def load(paths):
    """Returns (counts, durations, first, last).

    counts[(scenario, cls, code, src)]    -> n
    durations[(scenario, cls, code, src)] -> [duration_ms, ...]
    Both keyed identically, and both read straight off the tags k6 recorded
    -- see the module docstring.
    """
    counts = collections.Counter()
    durations = collections.defaultdict(list)
    first = last = None
    for row in iter_points(paths):
        data = row["data"]
        t = parse_ts(data["time"])
        first = t if first is None or t < first else first
        last = t if last is None or t > last else last
        tags = data.get("tags", {})
        key = (tags.get("scenario"), tags.get("cls"), tags.get("code"), tags.get("src"))
        if row["metric"] == "resp":
            counts[key] += int(data["value"])
        elif row["metric"] == "resp_duration":
            durations[key].append(data["value"])
    return counts, durations, first, last


def group_of(scenario, cls):
    """(a) the crawler / (b) legit users' Atlas requests / (c) legit users'
    non-Atlas requests. Anything not tagged scenario=="crawler" is a
    legitimate user -- browse.js's `browse` scenario and atlas-flood.js's
    lighter `visitor` scenario both count, by design: neither one is the
    distributed scraper.

    browse.js suffixes an RSC/prefetch request's class ("atlas:prefetch",
    "map:rsc", ...) so the per-class breakdown can show the request-type mix.
    The Atlas/non-Atlas split has to match on the class BEFORE that suffix --
    matching the raw tag here previously put every RSC or prefetched Atlas
    request (which is most of them, once map clicks became RSC requests) into
    the non-Atlas block. See test_summarise.py's
    test_suffixed_class_still_classifies_as_atlas, which fails without the
    `.split(":", 1)[0]` below."""
    if scenario == "crawler":
        return "a_crawler"
    base = (cls or "").split(":", 1)[0]
    return "b_users_atlas" if base in ATLAS_CLASSES else "c_users_other"


GROUP_TITLE = {
    "a_crawler": "(a) THE CRAWLER",
    "b_users_atlas": "(b) LEGITIMATE USERS -- ATLAS requests (map index, map states, records)",
    "c_users_other": "(c) LEGITIMATE USERS -- non-Atlas requests (home, pages, static, RSC, session)",
}


def is_success(code):
    return bool(code) and bool(SUCCESS_CODE_RE.match(code))


def is_5xx(code):
    return bool(code) and code.startswith("5")


def is_challenged(code, src):
    # Cloudflare's Managed Challenge rule on /repository/layers* (added
    # 2026-09-24 21:29 UTC: any non-RSC GET with a query string, not a
    # verified bot) answers 403 with `cf-mitigated: challenge`. who() in
    # lib.js already tells this apart from a generic Cloudflare 429/403 and
    # from Armor/Cloud Run -- it is the EXPECTED outcome for a raw crawler
    # GET or a deep-link arrival, not a failure, so it gets its own bucket
    # rather than being counted as "refused".
    return code == "403" and src == "cf-challenge"


def build_class_stats(keys, counts, durations):
    """One row of stats for a single (scenario, cls) pair, pooling every
    code/src under it. `keys` is the list of (scenario, cls, code, src)
    tuples that belong to this row."""
    n = sum(counts[k] for k in keys)
    success = sum(counts[k] for k in keys if is_success(k[2]))
    fivexx = sum(counts[k] for k in keys if is_5xx(k[2]))
    n429 = sum(counts[k] for k in keys if k[2] == "429")
    challenged = sum(counts[k] for k in keys if is_challenged(k[2], k[3]))
    by_src_429 = collections.Counter()
    for k in keys:
        if k[2] == "429":
            by_src_429[k[3]] += counts[k]
    other = n - success - fivexx - n429 - challenged
    by_src_other = collections.Counter()
    for k in keys:
        if (
            not is_success(k[2])
            and k[2] != "429"
            and not is_5xx(k[2])
            and not is_challenged(k[2], k[3])
        ):
            by_src_other[k[3]] += counts[k]
    ok_lat = []
    refused_lat = []
    challenged_lat = []
    for k in keys:
        vals = durations.get(k, [])
        if is_success(k[2]):
            ok_lat.extend(vals)
        elif is_challenged(k[2], k[3]):
            challenged_lat.extend(vals)
        else:
            refused_lat.extend(vals)
    return {
        "n": n,
        "success": success,
        "429": n429,
        "429_by_src": dict(by_src_429),
        "challenged": challenged,
        "5xx": fivexx,
        "other": other,
        "other_by_src": dict(by_src_other),
        "latency_ok_ms": lat_stats(ok_lat),
        "latency_refused_ms": lat_stats(refused_lat),
        "latency_challenged_ms": lat_stats(challenged_lat),
    }


def build_report(counts, durations):
    """Groups (a)/(b)/(c), each with a TOTAL row and a per-class row. Time
    buckets are a separate pass (populate_buckets) because they need each
    point's own timestamp, which the pre-aggregated `counts`/`durations`
    dicts here no longer carry."""
    keys_by_class = collections.defaultdict(list)
    for k in counts:
        scenario, cls = k[0], k[1]
        keys_by_class[(group_of(scenario, cls), scenario, cls)].append(k)

    groups = collections.defaultdict(dict)
    for (group, scenario, cls), keys in keys_by_class.items():
        groups[group][cls] = build_class_stats(keys, counts, durations)

    group_totals = {}
    for group, by_cls in groups.items():
        keys = [k for k in counts if group_of(k[0], k[1]) == group]
        group_totals[group] = build_class_stats(keys, counts, durations)

    return {"groups": {g: {"total": group_totals[g], "by_class": groups[g]} for g in groups}}


def populate_buckets(paths, bucket_minutes, first):
    """Per-bucket (group) totals, straight from `resp` points, so a long run
    shows the start transient (cold instances, the first-arrival spike)
    separately from steady state."""
    if not bucket_minutes or bucket_minutes <= 0:
        return []
    bucket_seconds = int(bucket_minutes * 60)
    per_bucket = collections.defaultdict(lambda: collections.Counter())
    for row in iter_points(paths):
        if row["metric"] != "resp":
            continue
        data = row["data"]
        t = parse_ts(data["time"])
        idx = int((t - first) // bucket_seconds)
        tags = data.get("tags", {})
        group = group_of(tags.get("scenario"), tags.get("cls"))
        c = per_bucket[(idx, group)]
        c["n"] += int(data["value"])
        code = tags.get("code")
        src = tags.get("src")
        if is_success(code):
            c["success"] += int(data["value"])
        if code == "429":
            c["429"] += int(data["value"])
        if is_5xx(code):
            c["5xx"] += int(data["value"])
        if is_challenged(code, src):
            c["challenged"] += int(data["value"])
    out = []
    for idx, group in sorted(per_bucket):
        c = per_bucket[(idx, group)]
        out.append(
            {
                "bucket": idx,
                "window_start_s": idx * bucket_seconds,
                "group": group,
                "n": c["n"],
                "success": c["success"],
                "429": c["429"],
                "5xx": c["5xx"],
                "challenged": c["challenged"],
            }
        )
    return out


def fmt_lat(lat):
    if lat is None:
        return "n=0"
    return f"n={lat['n']:<5} p50={lat['p50']:.0f}ms p95={lat['p95']:.0f}ms p99={lat['p99']:.0f}ms max={lat['max']:.0f}ms"


def fmt_class_row(name, s, indent="  "):
    pct429 = 100 * s["429"] / s["n"] if s["n"] else 0.0
    src_str = (
        ", ".join(f"{k}:{v}" for k, v in sorted(s["429_by_src"].items(), key=lambda kv: -kv[1]))
        or "-"
    )
    other_str = (
        ", ".join(f"{k}:{v}" for k, v in sorted(s["other_by_src"].items(), key=lambda kv: -kv[1]))
        or "-"
    )
    lines = [
        f"{indent}{name:10} n={s['n']:6}  success={s['success']:6} ({100 * s['success'] / s['n'] if s['n'] else 0:5.1f}%)"
        f"  429={s['429']:6} ({pct429:5.1f}%) [{src_str}]"
        f"  challenged={s['challenged']:5}  5xx={s['5xx']:4}  other={s['other']:4} [{other_str}]",
        f"{indent}{'':10}  latency ok:         {fmt_lat(s['latency_ok_ms'])}",
        f"{indent}{'':10}  latency refused:    {fmt_lat(s['latency_refused_ms'])}",
        f"{indent}{'':10}  latency challenged: {fmt_lat(s['latency_challenged_ms'])}",
    ]
    return "\n".join(lines)


def print_report(report, first, last):
    total = sum(g["total"]["n"] for g in report["groups"].values())
    span = f"{last - first:.0f}s" if (first is not None and last is not None) else "?"
    print(f"window {span} ({total} responses recorded)")
    print()
    for group in ("a_crawler", "b_users_atlas", "c_users_other"):
        if group not in report["groups"]:
            continue
        g = report["groups"][group]
        print(f"=== {GROUP_TITLE[group]} ===")
        print(fmt_class_row("TOTAL", g["total"], indent=""))
        for cls in sorted(g["by_class"]):
            print(fmt_class_row(cls, g["by_class"][cls]))
        print()

    if report["buckets"]:
        print("=== time buckets ===")
        for b in report["buckets"]:
            pct429 = 100 * b["429"] / b["n"] if b["n"] else 0.0
            pctok = 100 * b["success"] / b["n"] if b["n"] else 0.0
            print(
                f"  t+{b['window_start_s']:6}s  {GROUP_TITLE.get(b['group'], b['group']):55}"
                f" n={b['n']:6} success={pctok:5.1f}% 429={pct429:5.1f}% challenged={b['challenged']:5} 5xx={b['5xx']:4}"
            )


def main(argv=None):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "paths",
        nargs="+",
        help="k6 --out json= file(s), plain or .gz. Pass several to summarise a merged run without a separate `cat` step.",
    )
    ap.add_argument("--json", metavar="OUT", help="also write the full structured report as JSON")
    ap.add_argument(
        "--bucket-minutes",
        type=float,
        default=5,
        help="time-bucket width; 0 disables bucketing (default: 5)",
    )
    args = ap.parse_args(argv)

    counts, durations, first, last = load(args.paths)
    if not counts:
        print(
            "no `resp` points found -- wrong file, or the scripts' lib.js is stale", file=sys.stderr
        )
        return 1
    buckets = populate_buckets(args.paths, args.bucket_minutes, first) if first is not None else []
    report = build_report(counts, durations)
    report["buckets"] = buckets

    print_report(report, first, last)

    if args.json:
        with open(args.json, "w") as f:
            json.dump(
                {
                    "window": [first, last],
                    "groups": report["groups"],
                    "buckets": report["buckets"],
                },
                f,
                indent=1,
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
