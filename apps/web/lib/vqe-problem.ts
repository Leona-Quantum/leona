/** Render RFC 9457 VQE failures without discarding their support identity. */
export function formatVqeProblem(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const problem = value as Record<string, unknown>;
  const title = typeof problem.title === "string"
    ? problem.title
    : typeof problem.detail === "string"
      ? problem.detail
      : typeof problem.error === "string"
        ? problem.error
        : fallback;
  const reason = typeof problem.reason_code === "string"
    ? ` [${problem.reason_code}]`
    : "";
  const request = typeof problem.request_id === "string"
    ? ` (request ${problem.request_id})`
    : "";
  return `${title}${reason}${request}`;
}
