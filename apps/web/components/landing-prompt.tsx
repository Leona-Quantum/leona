"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronIcon, PlusIcon } from "./icons";
import { ghostFrame } from "../lib/composer-ghost";

type LandingPromptCopy = {
  label: string;
  attach: string;
  mode: string;
  submit: string;
  prompts: string[];
  modalLabel: string;
  modalTitle: string;
  modalBody: string;
  modalPrimary: string;
  authUnavailable: string;
  close: string;
};

export function LandingPrompt({
  copy,
  signUpHref,
  isSignedIn,
}: {
  copy: LandingPromptCopy;
  signUpHref: string | null;
  isSignedIn: boolean;
}) {
  const [value, setValue] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduceMotion || value) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - started), 55);
    return () => window.clearInterval(timer);
  }, [reduceMotion, value]);

  useEffect(() => {
    if (!dialogOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("mj-modal-open");
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("mj-modal-open");
      previousFocus?.focus({ preventScroll: true });
    };
  }, [dialogOpen]);

  const ghost = ghostFrame(reduceMotion ? 0 : elapsedMs, copy.prompts);
  const placeholder = reduceMotion ? copy.prompts[0] ?? copy.label : ghost?.text || copy.label;

  function act(event?: FormEvent) {
    event?.preventDefault();
    if (isSignedIn) {
      window.location.assign("/run");
      return;
    }
    setDialogOpen(true);
  }

  return (
    <>
      <form className="mj-landing-prompt" onSubmit={act}>
        <label className="sr-only" htmlFor="mj-landing-prompt-input">{copy.label}</label>
        <textarea
          id="mj-landing-prompt-input"
          rows={2}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="mj-landing-prompt-controls">
          <button className="mj-landing-prompt-icon" type="button" aria-label={copy.attach} title={copy.attach} onClick={() => act()}>
            <PlusIcon size={20} />
          </button>
          <div className="mj-landing-prompt-actions">
            <button className="mj-landing-prompt-mode" type="button" onClick={() => act()}>
              <span aria-hidden="true">✦</span>
              {copy.mode}
            </button>
            <button className="mj-landing-prompt-submit" type="submit">
              {copy.submit}
              <ChevronIcon size={18} />
            </button>
          </div>
        </div>
      </form>

      {dialogOpen ? (
        <div className="mj-landing-signup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
          <section
            ref={dialogRef}
            className="mj-landing-signup-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mj-landing-signup-title"
          >
            <button ref={closeRef} className="mj-landing-signup-close" type="button" aria-label={copy.close} title={copy.close} onClick={() => setDialogOpen(false)}>×</button>
            <p className="mj-section-label">{copy.modalLabel}</p>
            <h2 id="mj-landing-signup-title">{copy.modalTitle}</h2>
            <p>{copy.modalBody}</p>
            {value ? <blockquote>{value}</blockquote> : null}
            {signUpHref ? (
              <a className="mj-primary-button" href={signUpHref}>{copy.modalPrimary}</a>
            ) : (
              <p className="mj-landing-signup-note">{copy.authUnavailable}</p>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
