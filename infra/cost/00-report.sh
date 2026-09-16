#!/usr/bin/env bash
#
# What this project is standing to spend on Google Cloud, read from the live
# project rather than from anybody's notes.
#
# ## Why this is a script and not a paragraph
#
# The last written estimate of the standing cost - "~$76-80/mo at zero users" -
# was correct when it was written on 2026-08-15 and wrong by the end of that
# week, because ai-ops 91's database upgrade landed two days later and doubled
# the largest line. Nothing about the paragraph changed to show that. A costing
# goes stale silently, always in the same direction, and the only fix is to make
# re-deriving it cheaper than trusting the copy you already have.
#
# This prints measurements and the arithmetic over them. It does NOT print the
# bill: Google exposes actual charges only through a BigQuery billing export,
# and this billing account has none configured (checked 2026-09-16). Setting one
# up is free and is the single thing that would make this script unnecessary.
# Until then these are list prices applied to measured quantities, and they are
# labelled as such - "about $100" here means the arithmetic, not the invoice.
#
#   ./00-report.sh          # measure and cost the standing resources
#
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

# us-west1 Enterprise-edition list prices, read 2026-09-16. They move; the
# quantities above them are what this script exists to measure.
SQL_VCPU_HR=0.0413
SQL_GB_HR=0.0070
SQL_SSD_GB_MO=0.17
RUN_VCPU_S_ALWAYS=0.000018      # CPU always allocated (--no-cpu-throttling)
RUN_GIB_S_ALWAYS=0.000002
RUN_VCPU_S_REQ=0.000024         # CPU allocated during requests only
RUN_GIB_S_REQ=0.0000025
AR_GB_MO=0.10
IP_UNUSED_HR=0.010
HOURS_MO=730

step "Cloud SQL"
read -r TIER AVAIL DISK <<<"$(g sql instances describe majorana-pg \
  --format='value(settings.tier,settings.availabilityType,settings.dataDiskSizeGb)' | tr '\t' ' ')"
note "tier=${TIER} availability=${AVAIL} disk=${DISK}GB"
VCPU=$(sed -E 's/^db-custom-([0-9]+)-([0-9]+)$/\1/' <<<"$TIER")
MEMMB=$(sed -E 's/^db-custom-([0-9]+)-([0-9]+)$/\2/' <<<"$TIER")
if [ "$VCPU" = "$TIER" ]; then
  note "not a db-custom-N-M tier; skipping the arithmetic rather than guessing"
else
  MULT=1; [ "$AVAIL" = "REGIONAL" ] && MULT=2
  python3 -c "
v,m,d,mult=$VCPU,$MEMMB/1024,$DISK,$MULT
c=(v*$SQL_VCPU_HR + m*$SQL_GB_HR)*$HOURS_MO*mult
s=d*$SQL_SSD_GB_MO*mult
print(f'   {v:g} vCPU + {m:.2f} GiB, x{mult} for {\"REGIONAL\" if mult==2 else \"ZONAL\"}')
print(f'   compute \${c:,.2f}/mo + storage \${s:,.2f}/mo = \${c+s:,.2f}/mo')
print(f'   ZONAL instead would be \${(c+s)/mult:,.2f}/mo' if mult==2 else '')
"
  step "Cloud SQL headroom, 7 days"
  TOK=$(gcloud auth print-access-token 2>/dev/null | tail -1)
  python3 - "$TOK" "$PROJECT" <<'PY'
import sys, json, urllib.request, urllib.parse, datetime
tok, project = sys.argv[1], sys.argv[2]
end = datetime.datetime.now(datetime.timezone.utc)
start = end - datetime.timedelta(days=7)
for metric, label in (("cpu/utilization", "CPU"), ("memory/utilization", "memory")):
    p = {"filter": f'metric.type="cloudsql.googleapis.com/database/{metric}"',
         "interval.startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
         "interval.endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
         "aggregation.alignmentPeriod": "300s",
         "aggregation.perSeriesAligner": "ALIGN_MAX"}
    u = "https://monitoring.googleapis.com/v3/projects/%s/timeSeries?%s" % (project, urllib.parse.urlencode(p))
    d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"Authorization": "Bearer " + tok})))
    vals = [float(pt["value"].get("doubleValue", 0)) for ts in d.get("timeSeries", []) for pt in ts["points"]]
    if vals:
        vals.sort()
        med = vals[len(vals) // 2]
        hot = sum(1 for v in vals if v >= 0.8)
        # Peak alone is the wrong number here and it points the wrong way. Read
        # as daily MEANS this database looks like 12% of one vCPU; read as
        # 5-minute maxima it touches 100%. Both are true. What decides anything
        # is how LONG it is hot, so the count is printed beside the peak.
        print(f"   {label}: median {med*100:.1f}%, peak {vals[-1]*100:.1f}%, "
              f"{hot} of {len(vals)} 5-min windows at or above 80% "
              f"(~{hot*5/60:.1f} of 168 hours)")
    else:
        print(f"   no {label} samples returned - not the same finding as low usage")
PY
fi

step "Cloud Run, billed instance time over 7 days"
TOK=$(gcloud auth print-access-token 2>/dev/null | tail -1)
python3 - "$TOK" "$PROJECT" "$REGION" "$RUN_VCPU_S_ALWAYS" "$RUN_GIB_S_ALWAYS" "$RUN_VCPU_S_REQ" "$RUN_GIB_S_REQ" <<'PY'
import sys, json, urllib.request, urllib.parse, datetime
tok, project, region, va, ma, vr, mr = sys.argv[1], sys.argv[2], sys.argv[3], *map(float, sys.argv[4:8])
end = datetime.datetime.now(datetime.timezone.utc); start = end - datetime.timedelta(days=7)
def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"Authorization": "Bearer " + tok})))
p = {"filter": 'metric.type="run.googleapis.com/container/billable_instance_time"',
     "interval.startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
     "interval.endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
     "aggregation.alignmentPeriod": "604800s", "aggregation.perSeriesAligner": "ALIGN_SUM",
     "aggregation.crossSeriesReducer": "REDUCE_SUM",
     "aggregation.groupByFields": 'resource.label."service_name"'}
d = get("https://monitoring.googleapis.com/v3/projects/%s/timeSeries?%s" % (project, urllib.parse.urlencode(p)))
svc = get(f"https://run.googleapis.com/v2/projects/{project}/locations/{region}/services")
shape = {}
for s in svc.get("services", []):
    t = s.get("template", {}); c = (t.get("containers") or [{}])[0]
    lim = c.get("resources", {}).get("limits", {})
    # proto3 omits a false boolean, so an ABSENT `cpuIdle` means false, which
    # means CPU is always allocated - the expensive mode. Defaulting the other
    # way costed the always-on worker at the request-only rate and overstated
    # it by a third while looking perfectly reasonable.
    shape[s["name"].split("/")[-1]] = (lim.get("cpu", "1"), lim.get("memory", "512Mi"),
                                       not c.get("resources", {}).get("cpuIdle", False))
total = 0.0
for ts in d.get("timeSeries", []):
    name = ts["resource"]["labels"].get("service_name")
    secs = sum(float(pt["value"].get("doubleValue", pt["value"].get("int64Value", 0))) for pt in ts["points"])
    cpu_s, mem_s, always = shape.get(name, ("1", "512Mi", False))
    cpu = float(cpu_s[:-1]) / 1000 if cpu_s.endswith("m") else float(cpu_s)
    gib = float(mem_s.rstrip("MiG")) / 1024 if mem_s.endswith("Mi") else float(mem_s.rstrip("Gi"))
    mo = secs / 7 * 30.4
    cost = mo * (cpu * (va if always else vr) + gib * (ma if always else mr))
    total += cost
    hrs = secs / 7 / 3600
    flag = "  <- CPU always allocated, 24/7" if always and hrs > 23 else ""
    print(f"   {name:24} {hrs:5.2f} instance-hours/day  ~${cost:7.2f}/mo{flag}")
print(f"   {'':24} {'':21}  ~${total:7.2f}/mo total")
PY

step "Artifact Registry"
SIZE_MB=$(g artifacts repositories describe "$REPO" --location="$REGION" \
  --format='value(sizeBytes)' 2>/dev/null | tr -d ' ')
[ -n "$SIZE_MB" ] || SIZE_MB=$(g artifacts repositories describe "$REPO" --location="$REGION" \
  --format='value(format(sizeBytes))' 2>/dev/null | tr -d ' ')
api "https://artifactregistry.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/repositories/${REPO}" \
  > /tmp/.cost-repo.$$ 2>/dev/null || true
python3 - "$AR_GB_MO" <<PY
import json
try:
    d = json.load(open("/tmp/.cost-repo.$$"))
    gb = int(d.get("sizeBytes", 0)) / 1e9
    print(f"   repository holds {gb:.1f} GB  ~\${max(0.0, gb - 0.5) * $AR_GB_MO:.2f}/mo")
    print("   cleanup policies: " + (", ".join(p["id"] for p in d.get("cleanupPolicies", {}).values()) or "NONE - this grows without bound"))
except Exception as e:
    print("   could not read the repository:", e)
PY
rm -f "/tmp/.cost-repo.$$"

step "Reserved addresses"
g compute addresses list --format='value(name,address,status)' | while read -r n a s; do
  if [ "$s" = "RESERVED" ]; then
    python3 -c "print(f'   {\"$n\"} ({\"$a\"}) is RESERVED and attached to nothing: ~\${$IP_UNUSED_HR * $HOURS_MO:.2f}/mo')"
  else
    note "$n ($a) $s"
  fi
done

step "Cloud Run revisions retained"
for s in $(g run services list --region="$REGION" --format='value(metadata.name)'); do
  n=$(api "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${s}/revisions?pageSize=1000" \
      | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("revisions",[])))' 2>/dev/null || echo "?")
  note "${s}: ${n} revisions"
done
TOTAL_REVS=$(g run services list --region="$REGION" --format='value(metadata.name)' | while read -r s; do
  api "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${s}/revisions?pageSize=1000" \
    | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("revisions",[])))'
done | paste -sd+ - | bc)
QUOTA=$(api "https://cloudquotas.googleapis.com/v1/projects/${PROJECT}/locations/global/services/run.googleapis.com/quotaInfos?pageSize=200" \
  | python3 -c 'import json,sys
d=json.load(sys.stdin)
for q in d.get("quotaInfos",[]):
    if q.get("quotaId")=="ActiveRevisionsPerProject" or "ActiveRevisionsPerProject" in (q.get("quotaDisplayName") or ""):
        print(q.get("dimensionsInfos",[{}])[0].get("details",{}).get("value","?")); break
else: print("?")')
note "${TOTAL_REVS} active revisions against a project quota of ${QUOTA}."
note "Deploys FAIL at the quota; an idle revision bills nothing, so the bill never warns you."
note "20-revision-reaper.sh removes the ones nothing can reach."
