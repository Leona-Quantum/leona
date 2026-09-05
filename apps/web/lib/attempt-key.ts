/**
 * A stable id for one submitted attempt: SHA-256 over the notebook, the version and
 * the exact body, hex-truncated to a header-safe length.
 *
 * Derived rather than random, which is where this differs from the workspace's
 * `quizMe`, whose `crypto.randomUUID()` is right for what IT does — and the
 * difference is the point.
 * The case this must survive is a retry of THIS request: a dropped 202, a double
 * press, a proxy replaying a POST. A retry reproduces the body, so it reproduces the
 * key with nothing remembered between calls; a fresh UUID per call gives a retry a
 * new key and therefore no protection at all.
 *
 * `crypto.subtle` is present on every browser that reaches this page (it is
 * secure-context only, and so is the workspace). If it is somehow absent the attempt
 * still goes through without replay protection — a learner losing a verdict is worse
 * than a learner costing one extra sandbox run.
 */
export async function attemptKey(notebookId: string, seq: number, body: string): Promise<string> {
  const material = `${notebookId}:${seq}:${body}`;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
    return Array.from(new Uint8Array(digest))
      .slice(0, 16)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}
