const UUID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const CANDIDATE = "candidate_[a-z0-9][a-z0-9_.-]{0,63}";

const ALLOWED = [
  /^experiments$/,
  new RegExp(`^experiments/${UUID}$`),
  new RegExp(`^experiments/${UUID}/executions$`),
  new RegExp(`^experiments/${UUID}/cancel$`),
  new RegExp(`^executions/${UUID}$`),
  new RegExp(`^executions/${UUID}/materialize$`),
  /^controlled-comparisons$/,
  new RegExp(`^controlled-comparisons/${UUID}$`),
  new RegExp(`^controlled-comparisons/${UUID}/runs$`),
  /^research-candidates$/,
  new RegExp(`^research-candidates/${UUID}/${CANDIDATE}$`),
  new RegExp(`^research-candidates/${UUID}/reviews$`),
  new RegExp(`^research-candidates/${UUID}/reviews/${UUID}/materialize$`),
];

/**
 * Fail-closed allowlist for the authenticated VQE control-plane proxy.
 *
 * Keep method policy explicit: comparison collections can be created but not
 * listed, comparison records can be reopened, and comparison runs can be
 * finalized but not addressed as a collection through GET.
 */
export function isAllowedVqeProxyRequest(path: string, method: string): boolean {
  if (!ALLOWED.some((pattern) => pattern.test(path))) return false;
  if (method === "GET") {
    return path !== "controlled-comparisons"
      && !path.endsWith("/runs")
      && !path.endsWith("/cancel")
      && !path.endsWith("/materialize")
      && !path.endsWith("/reviews");
  }
  if (method === "POST") {
    return path === "experiments"
      || path === "controlled-comparisons"
      || path.endsWith("/executions")
      || path.endsWith("/runs")
      || path.endsWith("/cancel")
      || path.endsWith("/materialize")
      || path.endsWith("/reviews");
  }
  return false;
}
