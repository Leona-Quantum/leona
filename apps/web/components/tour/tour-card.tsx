"use client";

import Link from "next/link";
import type { FormEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { PublicLocale } from "../../lib/public-locale";
import { askNala, shortAnswer, waitForAnswer } from "../../lib/tour/ask.ts";
import { matchShow } from "../../lib/tour/intent.ts";
import { tourSignal } from "../../lib/tour/signal.ts";
import type { TourShowId } from "../../lib/tour/types.ts";
import type { ToursCopy, TourStepCopy } from "../../lib/workspace-locale";

export type TourCardButton = { label: string; onClick: () => void; disabled?: boolean };
export type TourStatusLine = { text: string; tone: "ok" | "warn" | "info" };

export const TOUR_CARD_BODY_ID = "mj-tour-card-body";

type Props = {
  copy: ToursCopy;
  locale: PublicLocale;
  cardRef: RefObject<HTMLDivElement | null>;
  stepKey: string;
  tourName: string;
  tourId: string;
  index: number;
  total: number;
  words: TourStepCopy;
  position: { left: number; top: number };
  origin: string;
  reduced: boolean;
  status: TourStatusLine[];
  primary: TourCardButton | null;
  secondary: TourCardButton[];
  canBack: boolean;
  onBack: () => void;
  onSkipTour: () => void;
  focusPrimary: boolean;
  onShowMe: (show: TourShowId) => void;
};

/**
 * The guide's chat box. It emerges from the point of light, types its line, and
 * carries the step's controls. The typed text is decoration for sighted readers;
 * assistive technology gets the whole sentence at once from a hidden copy, which
 * is also what the highlighted control's `aria-describedby` points at.
 */
export function TourCard(props: Props) {
  const { copy, words, stepKey, reduced, cardRef } = props;
  const [typed, setTyped] = useState(reduced ? words.action.length : 0);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const total = words.action.length;
    if (reduced) {
      setTyped(total);
      return;
    }
    setTyped(0);
    let count = 0;
    const timer = window.setInterval(() => {
      count = Math.min(total, count + 2);
      setTyped(count);
      if (count >= total) window.clearInterval(timer);
    }, 16);
    return () => window.clearInterval(timer);
  }, [stepKey, words.action, reduced]);

  useEffect(() => {
    if (props.focusPrimary) primaryRef.current?.focus({ preventScroll: true });
    // Only when the step changes: re-focusing on every render would pull focus
    // out of the Ask box while someone types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, props.focusPrimary]);

  const typing = typed < words.action.length;

  return (
    <div
      ref={cardRef}
      className="mj-tour-card"
      role="region"
      aria-label={copy.card.label}
      style={{ left: props.position.left, top: props.position.top, ["--mj-tour-origin" as string]: props.origin }}
      data-tour-card=""
    >
      <div key={stepKey} className="mj-tour-card-body">
        <p className="mj-tour-kicker">
          <strong>{props.tourName}</strong>
          <span>{copy.card.stepOf(props.index + 1, props.total)}</span>
        </p>
        <p className="mj-tour-title" aria-hidden="true">{words.title}</p>
        <p className="mj-tour-line" aria-hidden="true">
          {words.action.slice(0, typed)}
          {typing ? <span className="mj-tour-caret" /> : null}
        </p>
        <p className="mj-tour-sr" id={TOUR_CARD_BODY_ID} aria-live="polite">
          {words.title}. {words.action}
        </p>
        {props.status.map((line) => (
          <p key={line.text} className="mj-tour-status" data-tone={line.tone} role={line.tone === "warn" ? "alert" : "status"}>
            {line.text}
          </p>
        ))}
      </div>

      <div className="mj-tour-actions">
        {props.canBack ? <button type="button" className="mj-tour-button" onClick={props.onBack}>{copy.card.back}</button> : null}
        {props.secondary.map((button) => (
          <button key={button.label} type="button" className="mj-tour-button" onClick={button.onClick} disabled={button.disabled}>
            {button.label}
          </button>
        ))}
        <span className="mj-tour-spacer" />
        {props.primary ? (
          <button
            ref={primaryRef}
            type="button"
            className="mj-tour-button"
            data-primary="true"
            onClick={props.primary.onClick}
            disabled={props.primary.disabled}
          >
            {props.primary.label}
          </button>
        ) : null}
      </div>
      <div className="mj-tour-actions">
        <button type="button" className="mj-tour-link" onClick={props.onSkipTour}>{copy.card.skipTour}</button>
        <TourAsk copy={copy} locale={props.locale} tourName={props.tourName} tourId={props.tourId} stepTitle={words.title} onShowMe={props.onShowMe} />
      </div>
    </div>
  );
}

type NalaState =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "answer"; text: string; runId: string }
  | { kind: "pending"; runId: string }
  | { kind: "offline" }
  | { kind: "refused"; message: string | null }
  | { kind: "failed"; runId: string | null };

/**
 * "Ask": first the cheap, certain answer — is there a Show-me for this? — and
 * only on request the real one from Nala, with its cost stated up front.
 */
function TourAsk({ copy, locale, tourName, tourId, stepTitle, onShowMe }: { copy: ToursCopy; locale: PublicLocale; tourName: string; tourId: string; stepTitle: string; onShowMe: (show: TourShowId) => void }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [match, setMatch] = useState<TourShowId | null>(null);
  const [nala, setNala] = useState<NalaState>({ kind: "idle" });
  const alive = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    setAsked(text);
    setMatch(matchShow(text));
    setNala({ kind: "idle" });
  }

  async function askTheRealNala() {
    if (!asked || nala.kind === "asking") return;
    setNala({ kind: "asking" });
    tourSignal({ event: "ask_nala", tour: tourId });
    const start = await askNala({ prompt: copy.ask.context(tourName, stepTitle, asked), question: asked, locale });
    if (!alive.current) return;
    if (start.kind !== "started") {
      setNala(start.kind === "offline" ? { kind: "offline" } : { kind: "refused", message: start.message });
      return;
    }
    const answer = await waitForAnswer(start.runId, { cancelled: () => !alive.current });
    if (!alive.current) return;
    setNala(answer.kind === "answer" ? { kind: "answer", text: shortAnswer(answer.text), runId: answer.runId } : answer.kind === "pending" ? { kind: "pending", runId: answer.runId } : { kind: "failed", runId: answer.runId });
  }

  if (!open) {
    return (
      <button type="button" className="mj-tour-link" onClick={() => setOpen(true)} aria-expanded="false">
        {copy.card.ask}
      </button>
    );
  }

  return (
    <div className="mj-tour-ask" style={{ flexBasis: "100%" }}>
      <form onSubmit={submit}>
        <label className="mj-tour-sr" htmlFor="mj-tour-ask-input">{copy.ask.label}</label>
        <input
          ref={inputRef}
          id="mj-tour-ask-input"
          type="text"
          value={question}
          maxLength={400}
          placeholder={copy.ask.placeholder}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <button type="submit" className="mj-tour-button" disabled={!question.trim()}>{copy.ask.submit}</button>
        <button type="button" className="mj-tour-link" onClick={() => setOpen(false)}>{copy.card.hideAsk}</button>
      </form>
      {asked ? (
        <div aria-live="polite">
          <p className="mj-tour-ask-reply">{match ? copy.ask.match(copy.shows[match]) : copy.ask.noMatch}</p>
          <div className="mj-tour-ask-actions">
            {match ? (
              <button
                type="button"
                className="mj-tour-button"
                data-primary="true"
                onClick={() => {
                  tourSignal({ event: "ask_show_me", tour: match });
                  onShowMe(match);
                }}
              >
                {copy.ask.showMe}
              </button>
            ) : null}
            {nala.kind === "idle" ? (
              <button type="button" className="mj-tour-button" onClick={() => void askTheRealNala()}>{copy.ask.askNala}</button>
            ) : null}
          </div>
          {nala.kind === "idle" ? <p className="mj-tour-ask-cost">{copy.ask.cost}</p> : null}
          {nala.kind === "asking" ? <p className="mj-tour-ask-reply" role="status">{copy.ask.asking}</p> : null}
          {nala.kind === "answer" ? (
            <>
              <p className="mj-tour-ask-reply"><strong>{copy.ask.answered}</strong> {nala.text}</p>
              <Link className="mj-tour-link" href={`/run/${encodeURIComponent(nala.runId)}`}>{copy.ask.openAnswer}</Link>
            </>
          ) : null}
          {nala.kind === "pending" ? (
            <>
              <p className="mj-tour-ask-reply">{copy.ask.notReady}</p>
              <Link className="mj-tour-link" href={`/run/${encodeURIComponent(nala.runId)}`}>{copy.ask.openAnswer}</Link>
            </>
          ) : null}
          {nala.kind === "offline" ? <p className="mj-tour-ask-reply" role="alert">{copy.ask.offline}</p> : null}
          {nala.kind === "refused" ? <p className="mj-tour-ask-reply" role="alert">{nala.message ?? copy.ask.failed}</p> : null}
          {nala.kind === "failed" ? (
            <>
              <p className="mj-tour-ask-reply" role="alert">{copy.ask.failed}</p>
              {nala.runId ? <Link className="mj-tour-link" href={`/run/${encodeURIComponent(nala.runId)}`}>{copy.ask.openAnswer}</Link> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
