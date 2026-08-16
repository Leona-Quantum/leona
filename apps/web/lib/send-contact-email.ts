import { inquiryBody, inquiryReplyTo, inquirySubject, type ContactInquiry } from "./contact-inquiry";

/**
 * Hands a contact-form message to the transactional sender (ai-ops issue 125).
 *
 * ## Why this is not in the route
 *
 * `lib/control-plane-routes.test.ts` bans a bare `fetch` inside `app/api/**`,
 * because that is the one way to reintroduce an **untimed** outbound call
 * without tripping any of the checks above it. The ban is right and is left
 * exactly as it is. But its two sanctioned escapes, `fetchControlPlane` and
 * `openControlPlaneStream`, both build a URL against our own control plane, and
 * this call goes to a third party instead — so neither fits, and widening the
 * ban to admit a special case would weaken a guard that is currently absolute.
 *
 * So the call lives here, out of the route tree, and the invariant the ban
 * actually protects is asserted directly on this file: a test in
 * `send-contact-email.test.ts` fails if this stops passing an abort signal.
 * The rule keeps its teeth and the outbound call keeps its timeout.
 */

/** One provider round trip. A visitor is watching a spinner, so this is short. */
export const CONTACT_SEND_TIMEOUT_MS = 10_000;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type ContactSender = { apiKey: string; from: string; inbox: string };

export type SendOutcome = { delivered: true } | { delivered: false; reason: string };

/**
 * Read the sender from the environment.
 *
 * All three or nothing. A partial configuration — an API key with no inbox, say
 * — would otherwise look configured, send to nobody, and report success, which
 * is the one failure mode a contact form must not have.
 */
export function contactSender(env: NodeJS.ProcessEnv = process.env): ContactSender | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.CONTACT_FROM?.trim();
  const inbox = env.CONTACT_INBOX?.trim();
  if (!apiKey || !from || !inbox) return null;
  return { apiKey, from, inbox };
}

export async function sendContactEmail(
  sender: ContactSender,
  inquiry: ContactInquiry,
): Promise<SendOutcome> {
  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sender.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender.from,
        to: [sender.inbox],
        // So a reply in the mail client goes to whoever wrote in. The envelope
        // sender stays our own verified domain, which is what DKIM and DMARC
        // are checked against — putting the visitor's address in `from` would
        // fail both and land the message in spam.
        reply_to: inquiryReplyTo(inquiry),
        subject: inquirySubject(inquiry),
        text: inquiryBody(inquiry),
      }),
      signal: AbortSignal.timeout(CONTACT_SEND_TIMEOUT_MS),
    });
  } catch (error) {
    // Logged for the same reason the rejection below is. Without this the two
    // failure modes are not symmetric in the logs: a provider 4xx is visible
    // and a DNS failure or a timeout is silent, so "nobody is receiving contact
    // mail" looks like "nobody wrote in". The timeout is included because it is
    // the likeliest cause and the number is not otherwise in the log line.
    console.error("contact: could not reach the provider", {
      timeoutMs: CONTACT_SEND_TIMEOUT_MS,
      cause: error instanceof Error ? error.name : "unknown",
    });
    return { delivered: false, reason: "unreachable" };
  }

  if (!response.ok) {
    // The provider's error body can echo the request back, key included, so the
    // status is logged and the body is never read into anything returned.
    console.error("contact: provider rejected the message", { status: response.status });
    return { delivered: false, reason: "rejected" };
  }
  return { delivered: true };
}
