import { NextResponse } from "next/server";
import { validateInquiry } from "../../../lib/contact-inquiry";
import { contactSender, sendContactEmail } from "../../../lib/send-contact-email";
import { admitContact, contactAddress, type RateLimitStore } from "../../../lib/contact-rate-limit";

/**
 * The public contact form's server half (ai-ops issue 125, owner chose a
 * transactional sender over a mailbox).
 *
 * ## What this replaces
 *
 * The form used to build a `mailto:` and set `window.location`. That works only
 * for a visitor whose browser has a mail client wired up; for everyone else —
 * most people on a work laptop, most people on a phone browser that is not the
 * default one — pressing the button did nothing observable and the message was
 * simply lost. It also meant the destination had to ship inside the client
 * bundle, where it is harvestable: the owner's personal Gmail was in
 * `/_next/static/…/*.js` on production, confirmed by fetching the chunk.
 *
 * ## The address never reaches the browser
 *
 * `CONTACT_INBOX` is read on the server and only there. Even the mailto
 * FALLBACK below is served from this route rather than baked into the page, so
 * a scraper pulling the static assets finds no address at all. That is the half
 * of this change that works with no provider account and no DNS.
 *
 * ## Degrading honestly
 *
 * Until `RESEND_API_KEY`, `CONTACT_FROM` and `CONTACT_INBOX` are all set this
 * route cannot send, and it says so — 503 with a `mailto` the form opens
 * instead. What it must never do is accept a message, drop it, and show a
 * thank-you: a contact form that lies is worse than one that is obviously
 * manual. So `delivered` is reported only after the provider has accepted it.
 *
 * The outbound call itself lives in `lib/send-contact-email.ts`; see that file
 * for why it is not in here.
 */
export const dynamic = "force-dynamic";

/**
 * The address the form falls back to while no sender is configured.
 *
 * Separate from `CONTACT_INBOX` so the two can differ: this one is public by
 * construction, since it goes to a browser, and the inbox is not. With no
 * fallback set, none is offered — better a form that reports it is unavailable
 * than one that publishes an address the owner did not choose to publish.
 */
function fallbackMailto(): string | null {
  const raw = process.env.CONTACT_FALLBACK?.trim();
  if (!raw) return null;
  // Normalised rather than assumed to be a bare address. Setting this to a full
  // `mailto:` URL is the obvious misconfiguration, and it used to produce
  // `mailto:mailto:…` — which still passes the scheme check on the client and
  // yields a dead link, i.e. the failure is invisible until someone tries to
  // write in. Raised by Sourcery on PR 661.
  const address = raw.replace(/^mailto:/i, "").split("?")[0].trim();
  if (!address || !address.includes("@")) return null;
  return `mailto:${address}?subject=${encodeURIComponent("Leona Quantum inquiry")}`;
}

const noStore = { "Cache-Control": "private, no-store" } as const;

/** Lets the form know, before anyone types, whether it will be able to send. */
export async function GET() {
  const configured = contactSender() !== null;
  return NextResponse.json(
    { configured, mailto: configured ? null : fallbackMailto() },
    { headers: noStore },
  );
}

/**
 * Refuse an oversize body BEFORE parsing it.
 *
 * `CONTACT_LIMITS` bounds the fields, but it only runs after `request.json()`
 * has already parsed whatever arrived — so the caps protect what we send, not
 * what we are willing to read. This is the guard on the second one. The number
 * is the sum of the field caps with generous room for JSON overhead, so no
 * legitimate submission is anywhere near it. Raised by CodeRabbit on PR 661.
 */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The one long-lived counter table, per function instance.
 *
 * Module scope rather than per-request, which is the whole point — and the
 * reason the logic itself lives in `lib/contact-rate-limit.ts` as a pure
 * function over a store passed in, where the suite can drive the clock. See
 * that file for what a per-instance window is and is not worth here.
 */
const rateLimitStore: RateLimitStore = new Map();

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "that message is too large" }, { status: 413, headers: noStore });
  }

  let payload: Record<string, unknown>;
  try {
    // Read as text first so an absent or lying `Content-Length` is still
    // bounded — the header check above is a cheap early exit, not the guard.
    const raw = await request.text();
    // BYTES, not `raw.length`. A JS string length counts UTF-16 code units, so
    // a Japanese message — and this site ships a full ja locale — is one unit
    // per character but three bytes in UTF-8. Measuring the wrong one lets a
    // body roughly three times the intended cap through, and it would have been
    // the JA half of the audience that found it. Raised by Sourcery on PR 661.
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "that message is too large" }, { status: 413, headers: noStore });
    }
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400, headers: noStore });
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400, headers: noStore });
  }

  const validation = validateInquiry(payload);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400, headers: noStore });
  }

  const sender = contactSender();
  if (!sender) {
    return NextResponse.json(
      { error: "not-configured", mailto: fallbackMailto() },
      { status: 503, headers: noStore },
    );
  }

  // Metered HERE — after validation and after the sender check, immediately
  // before the only line that spends anything.
  //
  // The first version metered at the top of the handler, and review was right
  // that this is better. The resource being protected is EMAIL SENDS: a
  // malformed body, a tripped honeypot, or the 503 when no sender is configured
  // all cost nothing and send nothing, so counting them bought no protection and
  // did real damage — somebody who mistyped their address five times, or five
  // people behind one office address who did once each, were locked out of a
  // contact form for ten minutes by their own typos.
  //
  // Nothing is lost on the abuse side. A flood of INVALID requests is already
  // bounded by the 64KB body cap and never reaches a provider; a flood of VALID
  // ones is exactly what still gets counted. And requests that fail validation
  // are refused earlier and more cheaply than the limiter would have refused
  // them anyway.
  const decision = admitContact(rateLimitStore, contactAddress(request.headers), Date.now());
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "too many messages from this address — please try again shortly" },
      {
        status: 429,
        headers: { ...noStore, "Retry-After": String(decision.retryAfterSeconds) },
      },
    );
  }

  const outcome = await sendContactEmail(sender, validation.inquiry);
  if (!outcome.delivered) {
    // Deliberately no `mailto` on this branch: the form IS configured, so this
    // is a transient fault, and offering the fallback would publish the
    // fallback address on every provider blip.
    return NextResponse.json({ error: "send-failed" }, { status: 502, headers: noStore });
  }
  return NextResponse.json({ delivered: true }, { headers: noStore });
}
