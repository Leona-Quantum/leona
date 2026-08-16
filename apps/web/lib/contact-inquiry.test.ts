import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CONTACT_LIMITS,
  inquiryBody,
  inquiryReplyTo,
  inquirySubject,
  validateInquiry,
} from "./contact-inquiry.ts";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...segments: string[]) => readFileSync(join(...segments), "utf8");

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.org",
  topic: "Research workflow",
  message: "We are looking at amplitude estimation for a pricing model.",
};

test("a well-formed inquiry is accepted and trimmed", () => {
  const result = validateInquiry({ ...valid, name: "  Ada Lovelace  " });
  assert.ok(result.ok);
  assert.equal(result.inquiry.name, "Ada Lovelace");
  assert.equal(result.inquiry.email, "ada@example.org");
});

test("the honeypot rejects a filled hidden field without saying why", () => {
  // The form hides `website` from people. Anything in it filled every input it
  // could find, which is a bot. The error is deliberately opaque — naming the
  // signal tells the next attempt what to skip.
  const result = validateInquiry({ ...valid, website: "http://spam.example" });
  assert.ok(!result.ok);
  assert.equal(result.error, "rejected");
});

test("an empty honeypot is the normal case and passes", () => {
  assert.ok(validateInquiry({ ...valid, website: "" }).ok);
  assert.ok(validateInquiry({ ...valid, website: "   " }).ok);
});

test("the required fields are actually required", () => {
  for (const field of ["name", "email", "message"] as const) {
    const result = validateInquiry({ ...valid, [field]: "" });
    assert.ok(!result.ok, `${field} must be required`);
  }
});

test("topic is optional and defaults rather than failing", () => {
  const result = validateInquiry({ ...valid, topic: "" });
  assert.ok(result.ok);
  assert.equal(result.inquiry.topic, "Inquiry");
});

test("obviously wrong email shapes are refused and legal ones are not", () => {
  for (const bad of ["ada", "ada@", "@example.org", "ada example.org", "ada@example"]) {
    assert.ok(!validateInquiry({ ...valid, email: bad }).ok, `${bad} should be refused`);
  }
  // The false-reject direction matters more: each of these is legal and in use,
  // and refusing one tells a prospective user their own address is wrong.
  for (const good of [
    "ada+quantum@example.org",
    "ada.lovelace@sub.example.co.uk",
    "a@b.io",
    "ada@example.quantum",
  ]) {
    assert.ok(validateInquiry({ ...valid, email: good }).ok, `${good} should be accepted`);
  }
});

test("oversize fields are refused rather than truncated", () => {
  // Truncating would deliver a message whose end is missing with no sign that
  // anything was cut, which is worse than telling the sender to shorten it.
  const result = validateInquiry({ ...valid, message: "x".repeat(CONTACT_LIMITS.message + 1) });
  assert.ok(!result.ok);
  assert.match(result.error, /5000/);
  assert.ok(validateInquiry({ ...valid, message: "x".repeat(CONTACT_LIMITS.message) }).ok);
});

test("a newline in a field cannot inject a mail header", () => {
  // The load-bearing one. `name` reaches a Subject: and `email` a Reply-To:,
  // both newline-delimited — so a CR or LF that survived would let a stranger
  // append a Bcc: of their own and turn this form into an open relay sending
  // from our verified domain.
  const injected = validateInquiry({
    ...valid,
    name: "Ada\r\nBcc: everyone@example.com",
    email: "ada@example.org",
  });
  assert.ok(injected.ok);
  const subject = inquirySubject(injected.inquiry);
  assert.ok(!subject.includes("\n") && !subject.includes("\r"), "subject must be one line");
  assert.ok(subject.includes("Bcc:"), "the text is kept — only the line break is neutralised");

  const replyTo = inquiryReplyTo({ ...injected.inquiry, email: "ada@example.org\r\nBcc: x@y.z" });
  assert.ok(!replyTo.includes("\n") && !replyTo.includes("\r"), "reply-to must be one line");
});

test("the body carries who wrote in, so a reply has somewhere to go", () => {
  const result = validateInquiry(valid);
  assert.ok(result.ok);
  const body = inquiryBody(result.inquiry);
  assert.match(body, /Ada Lovelace <ada@example\.org>/);
  assert.match(body, /Research workflow/);
  assert.ok(body.includes(valid.message));
});

test("no destination address is baked into anything the browser downloads", () => {
  // This is the finding that started it (ai-ops issue 125): the owner's personal
  // Gmail was a module constant reachable from the contact page, which put it in
  // a static JS chunk on production where a scraper could pull it out. The
  // address now lives only in a server-read environment variable, and even the
  // fallback arrives from `/api/contact` at submit time.
  const form = read(webRoot, "app", "[locale]", "contact", "contact-form.tsx");
  const publicSite = read(webRoot, "components", "public-site.tsx");
  for (const [name, source] of [
    ["contact-form", form],
    ["public-site", publicSite],
  ] as const) {
    assert.ok(!/@gmail\.com/.test(source), `${name} must not carry a personal address`);
    assert.ok(
      !/public-contact/.test(source),
      `${name} must not import the deleted address module`,
    );
  }
  assert.ok(!/mailto:[a-zA-Z0-9._%+-]+@/.test(form), "no literal mailto address in the client");
});

test("the sender reads the inbox from the environment, all three or nothing", () => {
  const sender = read(webRoot, "lib", "send-contact-email.ts");
  assert.match(sender, /env\.CONTACT_INBOX/);
  assert.match(sender, /env\.RESEND_API_KEY/);
  // A partial configuration must not read as configured — a key with no inbox
  // would send mail to nobody and report success.
  assert.match(sender, /if \(!apiKey \|\| !from \|\| !inbox\) return null;/);
});

test("the outbound provider call is timed, which is what the no-fetch ban protects", () => {
  // `control-plane-routes.test.ts` bans a bare `fetch` inside app/api/** so an
  // UNTIMED outbound call cannot be reintroduced. Its two sanctioned escapes
  // both build a control-plane URL, and this call goes to a third party, so it
  // lives in lib/ instead. That would be a way around the ban rather than a
  // reason for one unless the invariant follows it here — so it does.
  const sender = read(webRoot, "lib", "send-contact-email.ts");
  assert.match(sender, /signal: AbortSignal\.timeout\(CONTACT_SEND_TIMEOUT_MS\)/);
  assert.match(sender, /CONTACT_SEND_TIMEOUT_MS = 10_000/);
  // And the route must still not grow one of its own.
  const route = read(webRoot, "app", "api", "contact", "route.ts");
  assert.ok(!/\bfetch\s*\(/.test(route), "the route must delegate the call, not make it");
  // Success is only ever reported after the provider accepted it.
  assert.match(route, /if \(!outcome\.delivered\)/);
});
