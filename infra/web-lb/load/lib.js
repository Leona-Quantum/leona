// Shared between atlas-flood.js and browse.js so both scripts record a
// response the same way: one `resp` Counter point and one `resp_duration`
// Trend point per response, under IDENTICAL tags (scenario, cls, code, src).
// That is what lets summarise.py report "the latency of the requests it just
// counted" instead of a separately-sampled http_req_duration series that
// only happens to share a scenario name.
import { Counter, Trend } from "k6/metrics";

export const UA_BASE = "leona-loadtest/1 (+infra/web-lb/load)";

const resp = new Counter("resp");
const respDuration = new Trend("resp_duration", true);

// `Via: 1.1 google` is added by Google's front end, so it is on everything
// that reached the load balancer -- including a response Cloudflare then
// cached, which is why `Cf-Cache-Status: HIT` is read first.
// `X-Cloud-Trace-Context` is NOT a usable witness through k6: Cloudflare
// passes it to curl and it was absent on every k6 response measured, so this
// does not key on it.
export function who(r) {
  if (r.status === 0) return "network";
  const body = typeof r.body === "string" ? r.body.slice(0, 40) : "";
  if (r.status === 429 && body.startsWith("Rate exceeded.")) return "cloudrun";
  if ((r.headers["Cf-Cache-Status"] || "") === "HIT") return "cf-cache";
  // Bot Fight Mode / a managed challenge: Cloudflare answers for the origin.
  if (r.headers["Cf-Mitigated"]) return "cf-challenge";
  const google = /google/i.test(r.headers["Via"] || "");
  if (!google) return "cloudflare";
  if (r.status === 429 || r.status === 403) return r.headers["X-Leona-Shed"] ? "app" : "armor";
  return "app";
}

// Records one response: a count and its latency, both under the same tags,
// so summarise.py can always answer "latency of exactly the responses it
// counted in this class" rather than reconstructing the join itself.
export function record(scenario, cls, r) {
  const tags = { scenario, cls, code: String(r.status), src: who(r) };
  resp.add(1, tags);
  respDuration.add(r.timings.duration, tags);
}

// Unix seconds; every process waits for it so that separately started
// machines (or GitHub Actions runners) load the origin at the same time.
export function startDelay(startAt) {
  if (!startAt) return 0;
  return Math.max(0, Math.round(startAt - Date.now() / 1000));
}
