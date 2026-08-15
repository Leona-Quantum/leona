"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronIcon, PlusIcon } from "./icons";
import { ComposerGhostOverlay } from "./composer-ghost-overlay";
import { DELETE_MS_PER_CHARACTER, TYPE_MS_PER_CHARACTER, ghostFrame } from "../lib/composer-ghost";
import { writeLandingPromptHandoff } from "../lib/landing-prompt-handoff";

/**
 * The one destination this component links to, and the reason it is a constant.
 *
 * The page that renders this is prerendered at build time and held by the CDN
 * for five minutes (`app/[locale]/page.tsx`), so it may not mint a WorkOS
 * authorization URL: that URL is per-request by construction and, with PKCE on,
 * carries a one-shot challenge that a shared cache would hand to every visitor.
 * `app/auth/sign-in/route.ts` exists to keep the per-request half per-request —
 * it is a `force-dynamic` route handler that redirects — which leaves this
 * component with a plain string and the page fully static.
 *
 * There is no `/auth/sign-up` counterpart in the app today, so the sign-up call
 * to action lands on the AuthKit sign-in screen and its "Sign up" link. Adding
 * one is a ten-line mirror of the sign-in route; it is deliberately not part of
 * this change.
 */
const SIGN_IN_HREF = "/auth/sign-in";

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
  close: string;
};

export function LandingPrompt({ copy }: { copy: LandingPromptCopy }) {
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
    // Sampled at the faster of the two per-character durations, not a fixed
    // 55ms: at 30ms/typed-character and 12ms/deleted-character (ai-ops 108),
    // a slower poll would skip characters — deletion in particular would jump
    // several at once instead of reading as "quick" one at a time.
    const timer = window.setInterval(
      () => setElapsedMs(Date.now() - started),
      Math.min(TYPE_MS_PER_CHARACTER, DELETE_MS_PER_CHARACTER),
    );
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

  // No ghost at all under reduced motion: the animation (and its caret) does
  // not run, so there is nothing for `ComposerGhostOverlay` to draw, and the
  // textarea's own `placeholder` carries the first prompt instead, sitting
  // still (owner, ai-ops 108 — "no blink, and ideally no typing animation").
  const ghost = reduceMotion ? null : ghostFrame(elapsedMs, copy.prompts);
  // Never `copy.label` here: it used to double as the placeholder fallback,
  // which put "Describe the quantum circuit you want to build" on screen for
  // every render before the typing animation had produced its first
  // character. The label still exists for the screen-reader-only <label>
  // below; it just never becomes visible text (owner, ai-ops#94).
  //
  // And never `ghost?.text || copy.prompts[0]`: `""` is a real, correct frame
  // — it is what plays during the pause between one prompt deleting and the
  // next typing in — and `||` treats that empty string as absent, resurrecting
  // the first prompt as a flash of static text in every single gap. That *was*
  // the "text that appears in between each rotation" the owner asked to have
  // removed (ai-ops 108). The fallback below is only for when there is no
  // ghost animation running at all (reduced motion, or no prompts to show).
  const placeholder = ghost ? "" : copy.prompts[0];

  // Every visitor gets the same dialog, because a prerendered page cannot know
  // who is reading it. A visitor who already has a session is not sent the long
  // way round: `/auth/sign-in` hands them to WorkOS, which recognises the
  // session and returns them straight to `/run`.
  function act(event?: FormEvent) {
    event?.preventDefault();
    setDialogOpen(true);
  }

  return (
    <>
      <form className="mj-landing-prompt" onSubmit={act}>
        <label className="sr-only" htmlFor="mj-landing-prompt-input">{copy.label}</label>
        <div className="mj-composer-ghost-wrap">
          {ghost ? <ComposerGhostOverlay frame={ghost} /> : null}
          <textarea
            id="mj-landing-prompt-input"
            rows={1}
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
        </div>
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
            {/* The one write point (ai-ops 102): committed only on the click that
                actually leaves for sign-in, never earlier. Opening this dialog
                commits nothing, so closing it without clicking through carries
                nothing forward — which is the correct behaviour for the
                abandoned case, not a special case of it. */}
            <a
              className="mj-primary-button"
              href={SIGN_IN_HREF}
              onClick={() => writeLandingPromptHandoff(value)}
            >
              {copy.modalPrimary}
            </a>
          </section>
        </div>
      ) : null}
    </>
  );
}
