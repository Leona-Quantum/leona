"use client";

import { type FormEvent, useState } from "react";
import { CONTACT_EMAIL } from "../../lib/public-contact";
import { CONTACT_COPY } from "../../lib/public-copy";
import type { PublicLocale } from "../../lib/public-locale";

export function ContactForm({ locale }: { locale: PublicLocale }) {
  const [status, setStatus] = useState<string | null>(null);
  const copy = CONTACT_COPY[locale];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const topic = String(form.get("topic") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();
    const subject = `[Leona Quantum] ${topic || "Inquiry"}`;
    const body = [
      `${copy.fields.name}: ${name}`,
      `${copy.fields.email}: ${email}`,
      `${copy.fields.topic}: ${topic}`,
      "",
      message,
    ].join("\n");
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setStatus(copy.fields.status);
  }

  return (
    <form className="mj-contact-form" onSubmit={submit}>
      <label><span>{copy.fields.name}</span><input name="name" required autoComplete="name" /></label>
      <label><span>{copy.fields.email}</span><input name="email" required type="email" autoComplete="email" /></label>
      <label><span>{copy.fields.topic}</span><select name="topic" defaultValue={copy.topics[0]}>{copy.topics.map((topic) => <option key={topic}>{topic}</option>)}</select></label>
      <label className="mj-contact-form-wide"><span>{copy.fields.message}</span><textarea name="message" required rows={7} placeholder={copy.fields.placeholder} /></label>
      <div className="mj-contact-form-actions">
        <button className="mj-primary-button" type="submit">{copy.fields.submit}</button>
        {status ? <p role="status">{status}</p> : null}
      </div>
    </form>
  );
}
