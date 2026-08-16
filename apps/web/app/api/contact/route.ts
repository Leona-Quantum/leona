import { NextResponse } from "next/server";
import { validateInquiry } from "../../../lib/contact-inquiry";
import { contactSender, sendContactEmail } from "../../../lib/send-contact-email";

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
  const address = process.env.CONTACT_FALLBACK?.trim();
  if (!address) return null;
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

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
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

  const outcome = await sendContactEmail(sender, validation.inquiry);
  if (!outcome.delivered) {
    // Deliberately no `mailto` on this branch: the form IS configured, so this
    // is a transient fault, and offering the fallback would publish the
    // fallback address on every provider blip.
    return NextResponse.json({ error: "send-failed" }, { status: 502, headers: noStore });
  }
  return NextResponse.json({ delivered: true }, { headers: noStore });
}
