/**
 * Validation and rendering for the public contact form (ai-ops issue 125).
 *
 * Pure, and separated from the route for the usual reason: the route needs a
 * network and an API key to run at all, and the part worth testing is the part
 * that decides what is accepted and what a message turns into.
 */

/** Caps chosen to be generous for a human and hostile to a bot pasting a payload. */
export const CONTACT_LIMITS = {
  name: 200,
  email: 320, // the RFC 5321 maximum for a full address
  topic: 120,
  message: 5000,
} as const;

export type ContactInquiry = {
  name: string;
  email: string;
  topic: string;
  message: string;
};

export type ContactValidation =
  | { ok: true; inquiry: ContactInquiry }
  | { ok: false; error: string };

/**
 * Deliberately permissive: one `@`, something either side, no whitespace, and a
 * dot in the domain.
 *
 * Tightening this is a trap. Every stricter regex in circulation rejects
 * addresses that are legal and in use (plus-tags, new TLDs, quoted locals), and
 * the cost of a false reject here is a prospective user who is told their own
 * email is wrong and leaves. The real check is whether the reply arrives, which
 * no regex performs.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validate one submission.
 *
 * `website` is a honeypot: a field the real form hides from people and leaves
 * empty, so anything in it came from something filling every input it found.
 * It is checked here rather than in the route so the test suite covers it —
 * a honeypot nobody tests is a honeypot that silently stops catching anything.
 */
export function validateInquiry(input: Record<string, unknown>): ContactValidation {
  if (clean(input.website) !== "") {
    // Reported to the caller as a normal rejection. Telling a bot which signal
    // caught it is free help for the next attempt.
    return { ok: false, error: "rejected" };
  }
  const name = clean(input.name);
  const email = clean(input.email);
  const topic = clean(input.topic) || "Inquiry";
  const message = clean(input.message);

  if (!name) return { ok: false, error: "a name is required" };
  if (!email) return { ok: false, error: "an email address is required" };
  if (!EMAIL_SHAPE.test(email)) return { ok: false, error: "that email address does not look right" };
  if (!message) return { ok: false, error: "a message is required" };

  if (name.length > CONTACT_LIMITS.name) return { ok: false, error: "that name is too long" };
  if (email.length > CONTACT_LIMITS.email) return { ok: false, error: "that email address is too long" };
  if (topic.length > CONTACT_LIMITS.topic) return { ok: false, error: "that topic is too long" };
  if (message.length > CONTACT_LIMITS.message) {
    return { ok: false, error: `keep the message under ${CONTACT_LIMITS.message} characters` };
  }

  return { ok: true, inquiry: { name, email, topic, message } };
}

/**
 * Strip anything that could inject a second header into the outgoing mail.
 *
 * The name and topic reach a `Subject:` and a `Reply-To:`, both of which are
 * newline-delimited. A submitted name containing CR or LF would otherwise let a
 * stranger append headers of their own — a `Bcc:` being the obvious one, which
 * turns this form into an open relay pointed at the owner's domain reputation.
 * Applied at the boundary where the header is built, not at parse time, so it
 * cannot be skipped by a future second caller of `validateInquiry`.
 */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function inquirySubject(inquiry: ContactInquiry): string {
  return headerSafe(`[Leona Quantum] ${inquiry.topic} — ${inquiry.name}`);
}

export function inquiryReplyTo(inquiry: ContactInquiry): string {
  return headerSafe(inquiry.email);
}

/**
 * The message body, as plain text.
 *
 * Plain text and not HTML on purpose: everything in here is a stranger's input,
 * and text has no escaping question to get wrong. It is read by one person in a
 * mail client, so there is nothing HTML would buy.
 */
export function inquiryBody(inquiry: ContactInquiry): string {
  return [
    `From:    ${inquiry.name} <${inquiry.email}>`,
    `Topic:   ${inquiry.topic}`,
    "",
    inquiry.message,
    "",
    "—",
    "Sent from the contact form on leonaqt.com. Reply-To is set to the sender,",
    "so replying goes to them rather than back to this form.",
  ].join("\n");
}
