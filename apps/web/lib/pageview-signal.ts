/**
 * What counts as a public pageview, and what we are willing to write down.
 *
 * ## Why this exists
 *
 * The public site had no analytics of any kind, so "does anyone read the map?"
 * was being answered from taste. This module is the decision half of a counter
 * that answers it; `middleware.ts` is the only caller and does nothing but log
 * whatever this returns.
 *
 * ## Why it records no identifier
 *
 * There is no cookie, no localStorage key, no IP, no user-agent string, and no
 * hash of any of those. That is a deliberate ceiling, not an oversight: the
 * owner's approval was for a "free, no-cookie pageview counter", and a
 * day-rotating hash of IP+UA — which is how most cookieless analytics count
 * "unique visitors" — is still a client identifier wearing a disguise. The cost
 * of that choice is real and must not be papered over anywhere downstream:
 *
 *   **this counts pageviews, never people.** One reader refreshing four times
 *   is four. There is no de-duplication and no way to add one without adding
 *   an identifier, which is an owner decision rather than an implementation
 *   detail.
 *
 * ## Why the route is a pattern and not the URL
 *
 * `/repository/<slug>` collapses to the literal string `/repository/[slug]`.
 * Writing the slug would make the log unbounded in cardinality and would turn a
 * counter into a record of what each visitor read, which is a different and
 * more sensitive artifact than the one that was approved. The four patterns
 * below are the whole vocabulary; anything else returns null and is not logged.
 *
 * ## Why it is import-free
 *
 * Same reason as `site-origin.ts`: the web app's test script is a bare
 * `node --test` invocation, so a module that pulls in `next/server` cannot be
 * unit tested. The caller adapts `NextRequest` to the tiny `HeaderLookup` shape
 * at the call site instead.
 */

/**
 * Prefix on every emitted line. Grep target for the read-back procedure in
 * `docs/runbooks/pageviews.md` — if this string changes, that runbook is wrong.
 */
export const PAGEVIEW_LOG_MARKER = "leona.pageview";

/** The only routes this counter knows. Anything else is not a public page. */
export const PAGEVIEW_ROUTES = ["/", "/repository", "/repository/layers", "/repository/[slug]"] as const;

export type PageviewRoute = (typeof PAGEVIEW_ROUTES)[number];

export type PageviewSignal = {
  evt: typeof PAGEVIEW_LOG_MARKER;
  /** One of `PAGEVIEW_ROUTES` — a pattern, never a visited URL. */
  route: PageviewRoute;
  /** UTC calendar day, `YYYY-MM-DD`. UTC, not the owner's timezone. */
  day: string;
  /** Referring host only, and only when it is somebody else's. */
  ref: string | null;
};

/** The part of `Headers` this module needs, so tests need no `next/server`. */
export type HeaderLookup = { get(name: string): string | null };

/**
 * A slug we are willing to believe is a real entry rather than scanner noise.
 *
 * Vulnerability scanners spray paths like `/repository/wp-login.php` and
 * `/repository/.env` at every public site, and each one renders a 404 that
 * middleware cannot distinguish from a real read. Requiring the lowercase
 * slug shape the corpus actually uses throws most of that away before it
 * becomes a number somebody quotes. It is a filter, not a guarantee: a 404 on
 * a well-shaped slug still counts, because middleware runs before the render
 * and never learns the status code.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Substrings that mark a non-human client. Deliberately crude — a precise bot
 * list is a maintenance burden with no owner, and the failure mode of missing
 * one is an overcount we have said is possible rather than a wrong claim.
 */
const BOT_HINTS = [
  "bot",
  "crawler",
  "spider",
  "slurp",
  "curl",
  "wget",
  "python-requests",
  "node-fetch",
  "headlesschrome",
  "lighthouse",
  "pingdom",
  "uptime",
  "monitor",
  "preview",
  "facebookexternalhit",
  "embedly",
];

/** The route pattern for a pathname, or null when it is not a public page. */
export function publicRoute(pathname: string): PageviewRoute | null {
  // A trailing slash is the same page; "//" is not a path we serve.
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "") return "/";
  if (path === "/") return "/";
  if (path === "/repository") return "/repository";
  // Checked before the slug branch on purpose: "layers" is a real slug shape,
  // and matching it as `[slug]` would silently merge the layers page — one of
  // the two surfaces the map question is actually about — into the entry bucket.
  if (path === "/repository/layers") return "/repository/layers";
  const entry = path.startsWith("/repository/") ? path.slice("/repository/".length) : null;
  if (entry !== null && SLUG.test(entry)) return "/repository/[slug]";
  return null;
}

/**
 * True when this request is somebody reading the page.
 *
 * A pageview is a GET. `HEAD` is what uptime monitors, link checkers and
 * `curl -I` send; `OPTIONS` is a CORS preflight. Neither renders anything for
 * anyone, and both reach middleware looking exactly like a visit — so counting
 * them would fold our own health checks into the number. A client-side
 * navigation is still a GET, so this excludes nothing a reader did.
 *
 * The check lives here rather than in the caller because this module is the
 * decision half and `middleware.ts` only logs what it returns; a filter in the
 * caller could not be unit tested, which is how the counter would come to
 * disagree with its own tests.
 */
export function isReadRequest(method: string): boolean {
  return method.toUpperCase() === "GET";
}

/**
 * True when the browser asked for this page speculatively.
 *
 * `next/link` prefetches on hover and on viewport entry, and a prefetch is a
 * full middleware invocation that looks exactly like a visit from here. The
 * repository index links to every entry, so counting prefetches would report
 * the whole corpus as read every time one person scrolled the list — the
 * single largest way this counter could lie.
 *
 * A client-side navigation is deliberately NOT excluded: it carries `RSC: 1`
 * but no prefetch header, and it is a real pageview that a server-render-only
 * counter would miss.
 */
export function isPrefetch(headers: HeaderLookup): boolean {
  if (headers.get("next-router-prefetch")) return true;
  if (headers.get("x-middleware-prefetch")) return true;
  if (headers.get("purpose")?.toLowerCase() === "prefetch") return true;
  // Chrome's speculation-rules header; "prefetch" and "prerender" both appear.
  const secPurpose = headers.get("sec-purpose")?.toLowerCase() ?? "";
  return secPurpose.includes("prefetch") || secPurpose.includes("prerender");
}

/**
 * True when the user agent looks automated.
 *
 * An absent or empty UA counts as automated: browsers always send one, and the
 * things that do not are our own SSR fetches, health probes, and scripts.
 */
export function isProbablyBot(userAgent: string | null): boolean {
  const ua = userAgent?.trim().toLowerCase() ?? "";
  if (ua === "") return true;
  return BOT_HINTS.some((hint) => ua.includes(hint));
}

/**
 * The referring host, when somebody else sent the reader here.
 *
 * Host only. A full referrer URL can carry someone else's query string —
 * search terms, tokens — into our logs, and the question this counter answers
 * ("did anyone link to us?") is fully served by the host. Same-origin
 * referrers are dropped because they describe our own navigation, not an
 * arrival.
 */
export function referrerHost(referer: string | null, selfHost: string | null): string | null {
  if (!referer) return null;
  let host: string;
  try {
    host = new URL(referer).host;
  } catch {
    return null;
  }
  if (host === "" || host === selfHost) return null;
  return host.toLowerCase();
}

/**
 * The line to log for this request, or null when this request is not a
 * countable public pageview.
 *
 * Never throws. The only caller is auth middleware on the live site, where an
 * exception is a 500 on every page rather than a missing metric; the caller
 * also wraps this, and both belts are intentional.
 */
export function pageviewSignal(input: {
  method: string;
  pathname: string;
  headers: HeaderLookup;
  selfHost: string | null;
  now: Date;
}): PageviewSignal | null {
  try {
    if (!isReadRequest(input.method)) return null;
    const route = publicRoute(input.pathname);
    if (route === null) return null;
    if (isPrefetch(input.headers)) return null;
    if (isProbablyBot(input.headers.get("user-agent"))) return null;
    const day = input.now.toISOString().slice(0, 10);
    return {
      evt: PAGEVIEW_LOG_MARKER,
      route,
      day,
      ref: referrerHost(input.headers.get("referer"), input.selfHost),
    };
  } catch {
    return null;
  }
}

/**
 * Whether the counter should emit at all.
 *
 * Default-on with an explicit opt-out, rather than opt-in behind a flag
 * somebody has to remember to set in the Vercel dashboard. An opt-in counter
 * that nobody arms produces the same zero as no counter at all, and looks
 * identical to "nobody visited" — which is the exact question it was built to
 * answer.
 *
 * The caller must pass the value in with the key named literally
 * (`{ LEONA_PAGEVIEW_LOG: process.env.LEONA_PAGEVIEW_LOG }`). The default
 * `process.env` here is for tests and for any future server-runtime caller;
 * in edge middleware a dynamic lookup resolves to undefined, which would make
 * the off switch unable to switch anything off.
 */
export function pageviewLoggingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const setting = env.LEONA_PAGEVIEW_LOG?.trim().toLowerCase();
  return setting !== "off" && setting !== "0" && setting !== "false";
}
