/**
 * Reading the control plane's response envelope, in one place.
 *
 * ## The shape, as the server actually sends it
 *
 * `services/api/src/majorana_api/app.py::_problem` turns EVERY refusal into an
 * RFC 9457 problem document:
 *
 * ```json
 * { "type": "about:blank", "title": "…", "status": 429, "code": "http_error",
 *   "reason": "qpu_spend_exhausted", "spent_usd": 25.0 }
 * ```
 *
 * The route handlers raise FastAPI's `HTTPException(detail=…)`, but nothing
 * with a `detail` key ever reaches a browser. `_http_exc` unpacks it: a typed
 * refusal's `error` becomes `title`, and every OTHER key in that dict —
 * `reason`, `diagnostics`, `losses`, `blocked_reason`, `spent_usd` — is
 * re-emitted as a SIBLING of `title`, never nested. The BFF route handlers in
 * `app/api/**` stream `upstream.body` through untouched, so this is byte for
 * byte what client code parses.
 *
 * ## Why this module exists rather than a rule everyone remembers
 *
 * Because the rule was not remembered. `lib/project-shares.ts` learned it the
 * expensive way — its first draft read `detail`, nothing threw, every refusal
 * silently degraded to a generic sentence, and the conflict dialog's "open
 * theirs" button was dead on arrival because `parseConflict` never found a
 * version id. That was fixed there, in that file, and the same mistake stayed
 * in six other call sites across the signed-in app (ai-ops issue 153): the
 * studio's two submit paths, the run page's cancel and follow-up, the run
 * workspace, and the artifact restore dialog. Every one of them replaced a
 * sentence the server had written for the user with client-side filler.
 *
 * `account/qpu-credentials.tsx` is the counter-example and the reason this is a
 * module: it was found and fixed on its own, in place, by a review bot noticing
 * its TEST stubbed a body the API never sends. That fix did not travel, because
 * a fix in a file is not a fix in a contract.
 *
 * A shared reader is the fix rather than a lint rule because the failure has no
 * symptom: `payload.detail` on a problem document is `undefined`, `??` moves on,
 * and the fallback text is plausible. Nothing is thrown, nothing is logged, and
 * no test that stubs its own fixture will ever notice. The only defence is that
 * there is exactly one function that knows the shape.
 *
 * ## `detail` is still read, deliberately
 *
 * Not every error body on these paths is a problem document. The BFF answers
 * its own 400s with `{error}` (`app/api/workspaces/delete/route.ts` and
 * friends), `controlPlaneUnavailable` produces a 502/504 that never reached the
 * API at all, and a proxy inserted in front of either could produce anything.
 * So `detail` stays as a late fallback: it costs one comparison and it means a
 * body from outside this contract still yields its sentence instead of null.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * The sentence to put in front of a person, or null if the body carries none.
 *
 * Order is the order of authority: `title` is what this API sends, `detail` in
 * either of its two FastAPI-ish spellings is what something else might, and
 * `error` is the BFF's own shape. A caller that has a better fallback than
 * "something went wrong" should use `?? itsOwnSentence` rather than passing one
 * in, so the fallback stays next to the code that knows the operation.
 */
export function refusalSentence(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return (
    nonEmptyString(payload.title)
    ?? nonEmptyString(payload.detail)
    ?? (isRecord(payload.detail) ? nonEmptyString(payload.detail.error) : null)
    ?? nonEmptyString(payload.error)
  );
}

/**
 * The machine-readable `reason` on a refusal, when it carries one.
 *
 * The `title` beside it is an English sentence written by the control plane,
 * and this app renders Japanese too. A reason code is the only part of a
 * refusal that can be translated — anything keyed off the sentence would either
 * read English to a Japanese reader or match on prose that changes.
 */
export function refusalReason(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return nonEmptyString(payload.reason);
}

/**
 * One extension field off a problem document, by name.
 *
 * Typed refusals carry structure beside the sentence — `diagnostics` on a
 * framework-contract failure, `losses` on a restore that would drop
 * capabilities, `current_version_id` on a save conflict. They are siblings of
 * `title`; this is the accessor that says so, so no caller reaches for
 * `payload.detail.<field>` again.
 */
export function refusalField(payload: unknown, key: string): unknown {
  return isRecord(payload) ? payload[key] : undefined;
}

/** A refusal's `diagnostics`, kept to the strings the server actually sent. */
export function refusalStrings(payload: unknown, key: string): string[] {
  const value = refusalField(payload, key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * The id out of a create/submit response, or null if the body did not carry one.
 *
 * Every one of these endpoints is identified by the id it returns, and every
 * call site used to write `(await response.json()) as { id?: string }` and then
 * test `!payload.id`. That pair looks like validation and is not: the cast is an
 * assertion the compiler takes on trust, and the truthiness test accepts any
 * non-zero number. A `{"id": 1}` would pass both and then be carried into a URL,
 * a stored chat title and a subscription key as though it were the string those
 * require. Raised by CodeRabbit on the PR that unified the refusal readers.
 */
export function submittedId(payload: unknown): string | null {
  return responseString(payload, "id");
}

/**
 * One string field off a response body, or null if it is absent or not a string.
 *
 * The same reasoning as `submittedId`, for the fields that ride alongside it —
 * `conversation_id` in particular, which is written into local chat state and
 * later interpolated into a request path.
 */
export function responseString(payload: unknown, key: string): string | null {
  return isRecord(payload) ? nonEmptyString(payload[key]) : null;
}
