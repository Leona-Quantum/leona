"""Decide which Cloud Run revisions of one service are safe to delete.

Prints a one-line summary, then one revision name per line. Called by
20-revision-reaper.sh.

The two exclusions are deliberately computed from different sources: traffic
from the SERVICE's own traffic block, recency from the REVISION list's create
times. A revision can be old and still serving - `latestRevision: true` routing
does not mean the newest revision by name is the one taking requests, and a
pinned rollback is exactly the case where the two disagree.
"""

import json
import sys

svc_path, revs_path, keep = sys.argv[1], sys.argv[2], int(sys.argv[3])
svc = json.load(open(svc_path))
revs = json.load(open(revs_path)).get("revisions", [])

serving = {
    t["revision"].split("/")[-1] for t in svc.get("trafficStatuses", []) if t.get("revision")
}
serving |= {t["revision"].split("/")[-1] for t in svc.get("traffic", []) if t.get("revision")}
latest = (svc.get("latestReadyRevision") or "").split("/")[-1]
if latest:
    serving.add(latest)

revs.sort(key=lambda r: r.get("createTime", ""), reverse=True)
names = [r["name"].split("/")[-1] for r in revs]
protected = set(names[:keep]) | serving
doomed = [n for n in names if n not in protected]

print(
    f"   {len(names)} revisions, keeping the newest {min(keep, len(names))}"
    f" plus {len(serving)} serving/latest -> {len(doomed)} to remove"
)
for n in doomed:
    print(n)
