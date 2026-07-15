"use client";

import { type FormEvent, useState } from "react";
import { CONTACT_EMAIL } from "../../lib/public-contact";

const TOPICS = ["Product access", "Research workflow", "Enterprise R&D", "Open-source contribution", "Other"];

export function ContactForm() {
  const [status, setStatus] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const topic = String(form.get("topic") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();
    const subject = `[LeonaQ] ${topic || "Inquiry"}`;
    const body = [
      `Name: ${name}`,
      `Reply-to: ${email}`,
      `Topic: ${topic}`,
      "",
      message,
    ].join("\n");
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setStatus("Your email app should open with the inquiry prepared. Send it to add the note to the queue.");
  }

  return (
    <form className="mj-contact-form" onSubmit={submit}>
      <label><span>Name</span><input name="name" required autoComplete="name" /></label>
      <label><span>Email</span><input name="email" required type="email" autoComplete="email" /></label>
      <label><span>What is this about?</span><select name="topic" defaultValue={TOPICS[0]}>{TOPICS.map((topic) => <option key={topic}>{topic}</option>)}</select></label>
      <label className="mj-contact-form-wide"><span>Message</span><textarea name="message" required rows={7} placeholder="What are you building, and what evidence or access would help?" /></label>
      <div className="mj-contact-form-actions">
        <button className="mj-primary-button" type="submit">Prepare email to {CONTACT_EMAIL}</button>
        {status ? <p role="status">{status}</p> : null}
      </div>
    </form>
  );
}
