#!/usr/bin/env python3
"""Summarise a k6 `--out json=` run of atlas-flood.js or browse.js.

Prints, per scenario and page class, how many responses came back with each
status and who answered them (cloudrun / armor / cloudflare / app / network),
plus latency percentiles from `http_req_duration`. Reads the `resp` counter the
scripts emit, never the rendered k6 summary, so the numbers here are the ones
the scripts recorded rather than a paraphrase of them.

    python3 summarise.py run.json [--json out.json]
"""

import collections
import json
import sys


def pct(values, p):
    if not values:
        return None
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))]


def main(path, out=None):
    counts = collections.Counter()
    lat = collections.defaultdict(list)
    first = last = None
    with open(path) as f:
        for line in f:
            row = json.loads(line)
            if row.get("type") != "Point":
                continue
            data = row["data"]
            tags = data.get("tags", {})
            t = data.get("time")
            first = t if first is None or t < first else first
            last = t if last is None or t > last else last
            if row["metric"] == "resp":
                counts[
                    (tags.get("scenario"), tags.get("cls"), tags.get("code"), tags.get("src"))
                ] += int(data["value"])
            elif row["metric"] == "http_req_duration":
                lat[tags.get("scenario")].append(data["value"])
    total = sum(counts.values())
    print(f"window {first} -> {last}; {total} responses recorded")
    by = collections.defaultdict(collections.Counter)
    for (sc, cls, code, src), n in counts.items():
        by[(sc, cls)][f"{code}/{src}"] += n
    for key in sorted(by):
        c = by[key]
        n = sum(c.values())
        n429 = sum(v for k, v in c.items() if k.startswith("429"))
        print(
            f"{key[0]:8} {key[1]:7} n={n:6}  429={n429:6} ({100 * n429 / n:5.1f}%)  "
            + ", ".join(f"{k}:{v}" for k, v in c.most_common())
        )
    for sc, v in sorted(lat.items()):
        print(
            f"latency {sc:8} p50={pct(v, 50):.0f}ms p95={pct(v, 95):.0f}ms p99={pct(v, 99):.0f}ms max={max(v):.0f}ms"
        )
    if out:
        json.dump(
            {
                "window": [first, last],
                "counts": [
                    {"scenario": k[0], "cls": k[1], "code": k[2], "src": k[3], "n": n}
                    for k, n in sorted(counts.items(), key=lambda x: tuple(map(str, x[0])))
                ],
                "latency_ms": {
                    sc: {"p50": pct(v, 50), "p95": pct(v, 95), "p99": pct(v, 99), "max": max(v)}
                    for sc, v in lat.items()
                },
            },
            open(out, "w"),
            indent=1,
        )


if __name__ == "__main__":
    args = sys.argv[1:]
    out = None
    if "--json" in args:
        i = args.index("--json")
        out = args[i + 1]
        del args[i : i + 2]
    main(args[0], out)
