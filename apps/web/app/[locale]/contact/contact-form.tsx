"use client";

import { type FormEvent, useEffect, useState } from "react";
import { CONTACT_COPY } from "../../../lib/public-copy";
import type { PublicLocale } from "../../../lib/public-locale";

/**
 * The contact form (ai-ops issue 125).
 *
 * It POSTs to `/api/contact`, which sends the message server-side. If no
 * transactional sender is configured yet, that route answers 503 with a
 * `mailto:` and the form falls back to the old behaviour — so the page works in
 * both states and neither one silently loses a message.
 *
 * No destination address appears in this file, which is the point. The address
 * used to be a module constant here, which put the owner's personal Gmail in
 * the client bundle on production where a scraper could pull it out of a static
 * chunk. Even the fallback address now arrives from the server, on demand.
 */

type Delivery = "sends" | "mailto";
type Status = { kind: "idle" | "sending" | "sent" | "failed"; detail?: string };

export function ContactForm({ locale }: { locale: PublicLocale }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // What the button will actually do. Fetched rather than built in, because
  // this page is served from the CDN and cannot know it at render time.
  //
  // Starts on "mailto", the CONSERVATIVE of the two, and that is the whole
  // reason there is no third "unknown" state: an unresolved probe rendered the
  // "Send inquiry" label, which promises server-side delivery before anything
  // has confirmed it exists. Raised by Sourcery on PR 661 — the comment below
  // already claimed this behaviour and the code did not have it.
  const [delivery, setDelivery] = useState<Delivery>("mailto");
  const copy = CONTACT_COPY[locale];

  useEffect(() => {
    let cancelled = false;
    fetch("/api/contact")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { configured?: boolean } | null) => {
        if (cancelled || !body) return;
        setDelivery(body.configured ? "sends" : "mailto");
      })
      // A failed probe leaves the label at its neutral default. The submit path
      // below does not depend on this having resolved — it asks the server
      // again and acts on that answer, so the worst case is a button whose word
      // is generic, not a form that misbehaves.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function openMailto(mailto: string | null, inquiry: Record<string, string>) {
    // `CONTACT_FALLBACK` is set by hand, so this string can be misconfigured —
    // a bare address with no scheme is the obvious way. Without this check the
    // slice below silently produces a broken href and the button appears to do
    // nothing, which is the failure this whole PR exists to remove.
    if (!mailto || !mailto.trim().toLowerCase().startsWith("mailto:")) {
      setStatus({ kind: "failed", detail: copy.fields.failed });
      return;
    }
    const subject = `[Leona Quantum] ${inquiry.topic || "Inquiry"}`;
    const body = [
      `${copy.fields.name}: ${inquiry.name}`,
      `${copy.fields.email}: ${inquiry.email}`,
      `${copy.fields.topic}: ${inquiry.topic}`,
      "",
      inquiry.message,
    ].join("\n");
    // The route hands back a mailto URL with a placeholder subject; keep the
    // address it chose and replace the query with this submission's own.
    const address = mailto.trim().slice("mailto:".length).split("?")[0];
    window.location.href = `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setStatus({ kind: "sent", detail: copy.fields.status });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const inquiry = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      topic: String(data.get("topic") ?? "").trim(),
      message: String(data.get("message") ?? "").trim(),
      website: String(data.get("website") ?? ""),
    };

    setStatus({ kind: "sending" });
    let response: Response;
    try {
      response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inquiry),
      });
    } catch {
      setStatus({ kind: "failed", detail: copy.fields.failed });
      return;
    }

    if (response.ok) {
      setStatus({ kind: "sent", detail: copy.fields.sent });
      form.reset();
      return;
    }

    // 503 means the route is reachable but has no sender wired up. That is the
    // one failure the visitor can still route around, so hand them the mailto.
    if (response.status === 503) {
      const body = (await response.json().catch(() => null)) as { mailto?: string } | null;
      openMailto(body?.mailto ?? null, inquiry);
      return;
    }

    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setStatus({
      kind: "failed",
      // A 400 carries a specific, human reason ("that email address does not
      // look right"); anything else gets the generic line, because the server's
      // wording for a 502 is about our plumbing, not about their message.
      detail: response.status === 400 && body?.error ? body.error : copy.fields.failed,
    });
  }

  const sending = status.kind === "sending";
  const label = sending
    ? copy.fields.sending
    : delivery === "sends"
      ? copy.fields.send
      : copy.fields.submit;

  return (
    <form className="mj-contact-form" onSubmit={submit}>
      <label><span>{copy.fields.name}</span><input name="name" required autoComplete="name" maxLength={200} /></label>
      <label><span>{copy.fields.email}</span><input name="email" required type="email" autoComplete="email" maxLength={320} /></label>
      <label><span>{copy.fields.topic}</span><select name="topic" defaultValue={copy.topics[0]}>{copy.topics.map((topic) => <option key={topic}>{topic}</option>)}</select></label>
      <label className="mj-contact-form-wide"><span>{copy.fields.message}</span><textarea name="message" required rows={7} maxLength={5000} placeholder={copy.fields.placeholder} /></label>
      {/*
        Honeypot. Hidden from people and from assistive technology, so anything
        that arrives filled in came from something that filled every input it
        could find. `tabIndex={-1}` and `aria-hidden` keep it off the keyboard
        path too — a hidden field a screen-reader user can still tab into is a
        trap for them rather than for a bot.
      */}
      <div className="sr-only" aria-hidden="true">
        <label>
          <span>Leave this field empty</span>
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="mj-contact-form-actions">
        <button className="mj-primary-button" type="submit" disabled={sending}>{label}</button>
        {/*
          Always mounted, never conditional. A live region has to exist in the
          DOM BEFORE its content changes or screen readers commonly announce
          nothing — mounting the element at the same moment its text appears is
          the classic way to ship a status message only sighted users receive.
          The button label is not a substitute: it is disabled while sending.
          Empty until there is something to say, so it costs no visible space.
          Raised by CodeRabbit on PR 661.
        */}
        <p role="status" aria-live="polite">{status.detail ?? ""}</p>
      </div>
      {/* Describes what the button does, so it has to live where that is known.
          Until the probe resolves it stays on the mailto wording, which is the
          conservative of the two: it promises less. */}
      <p className="mj-contact-note">{delivery === "sends" ? copy.noteSends : copy.note}</p>
    </form>
  );
}
