"use client";

import "./tour.css";
import { usePathname, useRouter } from "next/navigation";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cueNala } from "../../lib/nala-cue";
import type { PublicLocale } from "../../lib/public-locale";
import {
  IDLE_NUDGE_MS,
  classifyPrompt,
  clickOutcome,
  correctionFor,
  finishTour,
  formatTourHash,
  leaveTour,
  mayWriteTourHash,
  moveTo,
  nextRunnableStep,
  offersHelp,
  parseTourHash,
  restartTour,
  routeMatches,
  setPaused,
  startTour,
  tourStatus,
  valueMatches,
} from "../../lib/tour/engine.ts";
import { TOUR_COMMAND_EVENT, WORKSPACE_ACCOUNT_MENU_EVENT, WORKSPACE_SIDEBAR_EVENT, type TourCommand } from "../../lib/tour/events.ts";
import { centreCard, holeFor, orbAnchor, placeCard, type Rect } from "../../lib/tour/geometry.ts";
import { tourSignal } from "../../lib/tour/signal.ts";
import { stepCopyKey, stepGo, stepRoute, tourById } from "../../lib/tour/tracks.ts";
import type { TourId, TourPlacement, TourShowId, TourStep, TourTrack, TourTrackId } from "../../lib/tour/types.ts";
import { TOURS_COPY, type TourPlaceKey, type TourStepCopy, type ToursCopy } from "../../lib/workspace-locale";
import { GuideOrb } from "./guide-orb";
import { TOUR_CARD_BODY_ID, TourCard, type TourCardButton, type TourStatusLine } from "./tour-card";
import { TourChooser } from "./tour-chooser";
import {
  controlIn,
  coverOver,
  type CoverKind,
  describeWith,
  fieldIn,
  fieldValue,
  findTarget,
  inertByPage,
  inertOutside,
  isEditable,
  prefersReducedMotion,
  pressTarget,
  routeModal,
  typeInto,
  wait,
} from "./tour-dom";
import { loadTourProgress, useTourProgress } from "./use-tour-progress";

/**
 * The guided tour on the live product (TUTORIAL.md; owner ruling ai-ops 298).
 *
 * The page dims, a spotlight opens around one real control, and the guide — a
 * breathing point of light, not a character — travels there and types one line
 * into its chat box. The step finishes when the reader does the thing (a click,
 * a value, a route, something appearing), never on a timer. The guide notices
 * what else happens: a click elsewhere gets a specific correction and, after
 * two, "Do it for me"; a reader's own prompt is acknowledged; leaving the page
 * offers the way back or a pause; twenty quiet seconds bring a nudge.
 *
 * It lives in the workspace shell (and the Atlas layouts), so it survives route
 * changes and the Settings popout. Progress is per browser, in
 * `majorana.tour.v1`, and mirrored to the URL as `#tour=build.4`.
 */

type Phase = "locating" | "reading" | "waiting" | "satisfied" | "success" | "away" | "wandered" | "hidden" | "offline";
type Notice = { ownPrompt?: boolean; ownValue?: boolean; skipped?: number };
type StepUi = { key: string; phase: Phase; misses: number; missLine: string | null; missTick: number; nudged: boolean; doing: boolean; notice: Notice };
type Outcome = "done" | "skipped" | "offline";

function freshUi(key: string, notice: Notice = {}): StepUi {
  return { key, phase: "locating", misses: 0, missLine: null, missTick: 0, nudged: false, doing: false, notice };
}

function placeFor(path: string): TourPlaceKey {
  if (path.includes("/notebooks/courses")) return "courses";
  if (path.includes("/studio")) return "studio";
  if (path.includes("/notebooks")) return "notebooks";
  if (path.includes("/qapps")) return "qapps";
  if (path.includes("/repository")) return "atlas";
  if (path.includes("/account")) return "settings";
  if (path.includes("/run")) return "run";
  return "workspace";
}

function tourTitle(copy: ToursCopy, tour: TourTrack): string {
  return tour.kind === "track" ? copy.tracks[tour.id as TourTrackId].title : copy.shows[tour.id as TourShowId];
}

function stepWords(copy: ToursCopy, tour: TourTrack, step: TourStep): TourStepCopy {
  return copy.steps[stepCopyKey(tour, step)] ?? { title: tourTitle(copy, tour), action: "" };
}

function initialPhase(step: TourStep, target: HTMLElement): Phase {
  if (!step.expect) return "reading";
  if (step.expect.kind === "value") {
    const value = fieldValue(target);
    return value !== null && valueMatches(step.expect.match, value) ? "satisfied" : "waiting";
  }
  return "waiting";
}

/** The `data-tour` control under a point, found by geometry so an inert page does not hide it. */
function tourNameAt(x: number, y: number, layer: Element | null): string | null {
  let best: { name: string; area: number } | null = null;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-tour]"))) {
    if (layer?.contains(element)) continue;
    const box = element.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
    const area = box.width * box.height;
    if (area > 0 && (!best || area < best.area)) best = { name: element.dataset.tour ?? "", area };
  }
  return best?.name || null;
}

/** An evenodd path: the whole viewport, minus a rounded hole. No mask and no colour literal. */
function scrimPath(width: number, height: number, hole: Rect | null): string {
  const outer = `M0 0H${width}V${height}H0Z`;
  if (!hole) return outer;
  const r = Math.min(10, hole.width / 2, hole.height / 2);
  const { left: x, top: y, width: w, height: h } = hole;
  return `${outer}M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

function useWorkspaceOnline(enabled: boolean): "unknown" | "online" | "offline" {
  const [state, setState] = useState<"unknown" | "online" | "offline">(enabled ? "unknown" : "offline");
  useEffect(() => {
    if (!enabled) {
      setState("offline");
      return;
    }
    let active = true;
    const controller = new AbortController();
    // `/api/me` answers from the control plane. A JSON 200 is the only "online":
    // a redirect to sign-in or a 503 from an unreachable API both count as offline.
    fetch("/api/me", { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } })
      .then((response) => {
        if (!active) return;
        const json = (response.headers.get("Content-Type") ?? "").includes("json");
        setState(response.ok && json && !response.redirected ? "online" : "offline");
      })
      .catch(() => {
        if (active) setState("offline");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled]);
  return state;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(media.matches);
    read();
    media.addEventListener("change", read);
    return () => media.removeEventListener("change", read);
  }, []);
  return reduced;
}

function useViewport(): { width: number; height: number } {
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  useLayoutEffect(() => {
    const read = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return viewport;
}

const ORIGIN: Record<TourPlacement | "floating" | "centre", string> = {
  top: "50% 100%",
  bottom: "50% 0%",
  left: "100% 24px",
  right: "0% 24px",
  floating: "22px 0%",
  centre: "22px 0%",
};

export function TourRuntime({ locale: localeProp, surface, initialCommand = null }: { locale?: PublicLocale; surface: "workspace" | "atlas"; initialCommand?: TourCommand | null }) {
  const [locale, setLocale] = useState<PublicLocale>(localeProp ?? "en");
  useEffect(() => {
    if (!localeProp) setLocale(document.documentElement.lang === "ja" ? "ja" : "en");
  }, [localeProp]);
  const copy = TOURS_COPY[locale];
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [progress, update] = useTourProgress();
  const online = useWorkspaceOnline(surface === "workspace");
  const reduced = useReducedMotion();
  const viewport = useViewport();

  const [chooserOpen, setChooserOpen] = useState(false);
  const [finishedTour, setFinishedTour] = useState<TourId | null>(null);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ width: 360, height: 210 });
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false, pressing: false });
  const [orb, setOrb] = useState({ x: -60, y: -60, trail: 0 });
  const [missFlash, setMissFlash] = useState(false);
  // What the page has open on top of the step's control, if anything. While it is
  // there the spotlight is withdrawn and the card says what is in the way.
  const [covered, setCovered] = useState<CoverKind | null>(null);
  // The overlay glides only when it moves to something new (a step or a control).
  // Following a control that scrolls or resizes is immediate: a CSS transition
  // restarted on every scroll frame left the spotlight trailing the control by
  // hundreds of pixels (probe-tour-motion.mjs, scroll-follow).
  const [glide, setGlide] = useState(false);
  const glideTimer = useRef(0);
  const placedOnce = useRef(false);
  // The page must be hydrated before the tour changes attributes on it. Hydration
  // yields to the event loop, and React tags a node before it commits, so a tour
  // that begins on a full page load (the Atlas) made siblings inert mid-hydration
  // and React reported a mismatch it does not patch (headless walk, dev log).
  // The spotlight and card draw at once; only inert and aria-describedby wait.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => setSettled(true), 1500);
    };
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("load", arm);
    };
  }, []);

  const layerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const notice = useRef<Notice>({});
  const rememberedPrompt = useRef<string | null>(null);
  const completing = useRef<string | null>(null);
  const didItKey = useRef<string | null>(null);
  const hashRead = useRef(false);
  const initialDone = useRef(false);
  // Where the card last sat beside something, so a step still finding its control
  // holds the card and the veil where they were.
  const lastPlacement = useRef<{ position: { left: number; top: number }; side: TourPlacement | "floating" | "centre" } | null>(null);
  // Until when the tour itself is navigating to a step's page. The pages it passes
  // through are not the reader wandering off.
  const travelling = useRef(0);
  const [travelTick, setTravelTick] = useState(0);
  // Settings closing (one history step back), so nothing presses Back twice.
  const closing = useRef<Promise<void> | null>(null);
  // The step whose covers the tour has already dealt with. The tour closes what is on
  // top of a control once, when it brings the reader to that step; something the reader
  // opens after that is theirs, and stays.
  const coverHandled = useRef("");

  const active = progress?.active ?? null;
  const tour = active ? tourById(active.track) : null;
  const step = tour && active ? tour.steps[active.step] ?? null : null;
  const stepKey = tour && active ? `${tour.id}.${active.step}` : "";
  const running = Boolean(tour && step && active && !active.paused);
  const [ui, setUi] = useState<StepUi>(() => freshUi(""));

  const live = useRef({ tour, step, active, ui, target, pathname, online, running, orb });
  live.current = { tour, step, active, ui, target, pathname, online, running, orb };

  useEffect(() => {
    if (running) return;
    placedOnce.current = false;
    lastPlacement.current = null;
  }, [running]);
  useEffect(() => () => window.clearTimeout(glideTimer.current), []);

  // ---- progress transitions -------------------------------------------------

  function go(url: string) {
    travelling.current = Date.now() + 10_000;
    // The @modal slot keeps what it rendered across a client-side navigation, so a push
    // while Settings is open changes the page behind the popout and leaves Settings on
    // top: the tour ran on controls the reader could not see. Close it first, then go.
    if (routeModal() && !routeMatches("/account", url)) {
      void closeSettings().then(() => {
        if (`${window.location.pathname}${window.location.search}` !== url) router.push(url);
      });
      return;
    }
    router.push(url);
  }

  /** Settings closes the way its own close button does: one step back in history. */
  function closeSettings(): Promise<void> {
    if (closing.current) return closing.current;
    if (!routeModal()) return Promise.resolve();
    router.back();
    const started = Date.now();
    const done = new Promise<void>((resolve) => {
      const poll = () => {
        if (routeModal() && Date.now() - started < 2000) {
          window.setTimeout(poll, 50);
          return;
        }
        closing.current = null;
        resolve();
      };
      window.setTimeout(poll, 50);
    });
    closing.current = done;
    return done;
  }

  function closeDrawer() {
    window.dispatchEvent(new CustomEvent(WORKSPACE_SIDEBAR_EVENT, { detail: { open: false } }));
  }

  /**
   * When the tour moves on by itself (Next, Skip, Back, or the reader doing the
   * step's action where it lives), it takes the reader to the next step's page
   * instead of stopping on a "Next stop" card that needs its own click. It does
   * not when the reader's action already took them somewhere else — a notebook
   * they just created is not a page to be pulled away from.
   */
  function followTo(t: TourTrack, from: TourStep, index: number) {
    const next = t.steps[index];
    if (!next) return;
    const here = window.location.pathname;
    if (routeMatches(stepRoute(t, next), here) || !routeMatches(stepRoute(t, from), here) || !canGo(t, next)) return;
    go(stepGo(t, next));
  }

  function begin(id: TourId, fromStart: boolean) {
    const next = tourById(id);
    if (!next) return;
    setChooserOpen(false);
    setFinishedTour(null);
    setInviteVisible(false);
    coverHandled.current = "";
    const updated = update((current) => {
      const returnTo = next.kind === "show" && current.active && current.active.track !== next.id ? current.active : null;
      if (next.kind === "show") return startTour(current, next, { returnTo });
      if (fromStart) return restartTour(current, next);
      if (current.active?.track === next.id) return setPaused(current, false);
      const status = tourStatus(current, next);
      return startTour(current, next, { step: status.state === "in-progress" ? status.step : 0 });
    });
    tourSignal({ event: "tour_started", tour: next.id });
    const first = next.steps[updated.active?.step ?? 0];
    if (first && !routeMatches(stepRoute(next, first), window.location.pathname)) go(stepGo(next, first));
  }

  function leave() {
    const { tour: t, step: s } = live.current;
    if (t) tourSignal({ event: "tour_left", tour: t.id, step: s?.id });
    update(leaveTour);
    setFinishedTour(null);
  }

  function finish(t: TourTrack) {
    const resume = loadTourProgress().active?.resume ?? null;
    tourSignal({ event: "tour_done", tour: t.id });
    update((current) => finishTour(current, t));
    if (!resume) setFinishedTour(t.id);
  }

  function advance(t: TourTrack, from: number) {
    const next = nextRunnableStep(t, from, live.current.online !== "offline");
    if (next.skipped > 0) {
      notice.current = { ...notice.current, skipped: next.skipped };
      const end = next.index === -1 ? t.steps.length : next.index;
      for (let index = from + 1; index < end; index += 1) tourSignal({ event: "offline_skip", tour: t.id, step: t.steps[index]!.id });
    }
    if (next.index === -1) {
      finish(t);
      return;
    }
    update((current) => moveTo(current, t, next.index));
    followTo(t, t.steps[from]!, next.index);
  }

  function complete(outcome: Outcome) {
    const { tour: t, active: a, step: s, pathname: path } = live.current;
    if (!t || !a || !s) return;
    const key = `${t.id}.${a.step}`;
    if (completing.current === key) return;
    completing.current = key;
    const didIt = didItKey.current === key && outcome === "done";
    tourSignal({ event: outcome === "offline" ? "offline_skip" : outcome === "skipped" ? "step_skipped" : didIt ? "did_it_for_me" : "step_done", tour: t.id, step: s.id });
    if (s.remembersPrompt) {
      window.setTimeout(() => {
        const box = findTarget("run-prompt");
        rememberedPrompt.current = box ? fieldValue(box) : null;
      }, 200);
    }
    if (outcome === "done") {
      setUi((current) => (current.key === key ? { ...current, phase: "success", missLine: null, nudged: false } : current));
      if (routeMatches("/run|/run/*", path)) cueNala(s.nala?.reaction === "nod" ? "nod" : "flick");
    }
    window.setTimeout(() => advance(t, a.step), outcome === "done" ? (prefersReducedMotion() ? 250 : 700) : 0);
  }

  function back() {
    const { tour: t, active: a } = live.current;
    if (!t || !a || a.step === 0) return;
    let index = a.step - 1;
    while (index > 0 && live.current.online === "offline" && t.steps[index]!.needs === "api") index -= 1;
    update((current) => moveTo(current, t, index));
    followTo(t, t.steps[a.step]!, index);
  }

  function checkPrompt() {
    if (!rememberedPrompt.current) return;
    const box = findTarget("run-prompt");
    const value = box ? fieldValue(box) ?? "" : "";
    if (classifyPrompt(value, [rememberedPrompt.current]) === "own") notice.current = { ...notice.current, ownPrompt: true };
  }

  function canGo(t: TourTrack, s: TourStep): boolean {
    return routeMatches(stepRoute(t, s), stepGo(t, s));
  }

  async function doItForMe() {
    const { tour: t, step: s, target: element, active: a, orb: from } = live.current;
    if (!t || !s || !a || !element) return;
    const expect = s.expect;
    if (!expect || expect.kind === "wait" || didItKey.current === `${t.id}.${a.step}`) return;
    const key = `${t.id}.${a.step}`;
    didItKey.current = key;
    setUi((current) => ({ ...current, doing: true, missLine: null }));
    const quick = prefersReducedMotion();
    const box = element.getBoundingClientRect();
    setCursor({ x: from.x, y: from.y, visible: true, pressing: false });
    await wait(quick ? 0 : 40);
    setCursor({ x: box.left + box.width / 2, y: box.top + box.height / 2, visible: true, pressing: false });
    await wait(quick ? 0 : 760);
    setCursor((current) => ({ ...current, pressing: true }));
    await wait(quick ? 0 : 160);
    try {
      if (expect.kind === "value") {
        const field = fieldIn(element);
        const words = stepWords(copy, t, s);
        const text = field instanceof HTMLSelectElement ? s.fill ?? "" : words.fill ?? s.fill ?? "";
        if (field && text) await typeInto(field, text, quick, () => live.current.active?.step !== a.step);
        else complete("skipped");
      } else {
        pressTarget(element);
      }
    } finally {
      await wait(quick ? 0 : 220);
      setCursor((current) => ({ ...current, visible: false, pressing: false }));
      setUi((current) => (current.key === key ? { ...current, doing: false } : current));
    }
  }

  function onScrimPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const { tour: t, step: s, ui: current, pathname: path } = live.current;
    if (!t || !s || current.phase !== "waiting" || clickOutcome(s, "scrim") !== "miss") return;
    const words = stepWords(copy, t, s);
    const line = correctionFor(s, tourNameAt(event.clientX, event.clientY, layerRef.current), {
      wrong: words.wrong,
      targets: copy.targets,
      notQuite: copy.status.notQuite,
      generic: copy.status.notQuiteGeneric,
    });
    setUi((previous) => (previous.key !== current.key ? previous : { ...previous, misses: previous.misses + 1, missLine: line, missTick: previous.missTick + 1 }));
    setMissFlash(true);
    window.setTimeout(() => setMissFlash(false), 700);
    tourSignal({ event: "step_missed", tour: t.id, step: s.id });
    if (routeMatches("/run|/run/*", path)) cueNala("tilt");
  }

  // ---- commands from the ? button, Settings and the Ask box ----------------

  const commandRef = useRef<(command: TourCommand) => void>(() => undefined);
  commandRef.current = (command) => {
    switch (command.action) {
      case "open-chooser":
        setChooserOpen(true);
        return;
      case "start":
        begin(command.tour, Boolean(command.fromStart));
        return;
      case "resume":
        coverHandled.current = "";
        update((current) => setPaused(current, false));
        return;
      case "leave":
        leave();
        return;
      case "invite-again":
        update((current) => ({ ...current, invite: "pending" }));
        return;
    }
  };

  useEffect(() => {
    const onCommand = (event: Event) => commandRef.current((event as CustomEvent<TourCommand>).detail);
    window.addEventListener(TOUR_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(TOUR_COMMAND_EVENT, onCommand);
  }, []);

  useEffect(() => {
    if (!progress || initialDone.current || !initialCommand) return;
    initialDone.current = true;
    commandRef.current(initialCommand);
  }, [progress, initialCommand]);

  // A `#tour=build.4` link wins over what this browser remembered.
  useEffect(() => {
    if (!progress || hashRead.current) return;
    hashRead.current = true;
    const parsed = parseTourHash(window.location.hash, tourById);
    const linked = parsed ? tourById(parsed.track) : null;
    if (!parsed || !linked) return;
    if (progress.active?.track === parsed.track && progress.active.step === parsed.step && !progress.active.paused) return;
    update((current) => (current.active?.track === linked.id ? moveTo(current, linked, parsed.step) : startTour(current, linked, { step: parsed.step })));
  }, [progress, update]);

  // Keep the fragment in step, without ever taking one another feature owns.
  // Not before the link has been read, or it would erase `#tour=…` unread.
  useEffect(() => {
    if (!progress || !hashRead.current) return;
    const current = window.location.hash;
    if (running && active) {
      const next = formatTourHash(active.track, active.step);
      if (current !== next && mayWriteTourHash(current)) {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${next}`);
      }
    } else if (/^#tour=/.test(current)) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, active?.track, active?.step, pathname, progress === null]);

  // ---- the step on screen ---------------------------------------------------

  useLayoutEffect(() => {
    // Read before clearing: the updater below runs later, during render.
    const carried = notice.current;
    notice.current = {};
    setUi((current) => (current.key === stepKey ? current : freshUi(stepKey, carried)));
    completing.current = null;
    setTarget(null);
    setRect(null);
    if (placedOnce.current) {
      setGlide(true);
      window.clearTimeout(glideTimer.current);
      glideTimer.current = window.setTimeout(() => setGlide(false), 900);
    }
  }, [stepKey]);

  // Where is the step, and is its control on screen?
  useEffect(() => {
    if (!running || !tour || !step) return;
    const key = stepKey;
    if (!routeMatches(stepRoute(tour, step), pathname)) {
      if (step.expect?.kind === "route" && routeMatches(step.expect.match, pathname)) {
        complete("done");
        return;
      }
      setTarget(null);
      // On its way to this step's page: say nothing about where the reader is
      // until it arrives, or plainly failed to.
      const travel = travelling.current - Date.now();
      if (travel > 0) {
        setUi((current) => (current.key !== key || current.phase === "success" ? current : { ...current, phase: "locating" }));
        const timer = window.setTimeout(() => setTravelTick((tick) => tick + 1), travel + 50);
        return () => window.clearTimeout(timer);
      }
      setUi((current) => (current.key !== key || current.phase === "success"
        ? current
        : { ...current, phase: ["waiting", "reading", "satisfied", "hidden", "wandered"].includes(current.phase) ? "wandered" : "away" }));
      return;
    }
    travelling.current = 0;
    if (step.expect?.kind === "route" && routeMatches(step.expect.match, pathname)) {
      complete("done");
      return;
    }
    if (step.needs === "api" && online === "offline") {
      setTarget(null);
      setUi((current) => (current.key !== key ? current : { ...current, phase: "offline" }));
      return;
    }
    if (!step.target) {
      setTarget(null);
      setUi((current) => (current.key !== key || current.phase === "success" ? current : { ...current, phase: "reading" }));
      return;
    }
    let cancelled = false;
    let tries = 0;
    let timer = 0;
    let askedForDrawer = false;
    let askedForMenu = false;
    setUi((current) => (current.key === key && ["away", "wandered", "offline"].includes(current.phase) ? { ...current, phase: "locating" } : current));
    const look = () => {
      if (cancelled) return;
      // Hydrated controls only for the first five seconds (see findTarget).
      const found = findTarget(step.target!, tries >= 20);
      if (found) {
        // Something the page opened is on top of the control. Arriving at the step, that
        // is the tour's own doing — a tour started from inside Settings, Back from the
        // step inside Settings, a drawer an earlier step opened on a phone — so the tour
        // closes it, once. Opened by the reader after that, it stays (see `covered`).
        if (coverHandled.current !== key) {
          coverHandled.current = key;
          const cover = coverOver(found, layerRef.current);
          if (cover === "settings") {
            void closeSettings();
            timer = window.setTimeout(look, 120);
            return;
          }
          if (cover === "navigation") {
            closeDrawer();
            timer = window.setTimeout(look, 250);
            return;
          }
        }
        if (closing.current) {
          timer = window.setTimeout(look, 120);
          return;
        }
        setTarget((current) => (current === found ? current : found));
        setUi((current) => (current.key !== key || ["waiting", "reading", "satisfied", "success"].includes(current.phase) ? current : { ...current, phase: initialPhase(step, found) }));
        return;
      }
      // On a phone the rail and the sidebar live in a collapsed drawer. Ask the shell to
      // open it, once for this step, instead of telling the reader the control is gone.
      if (!askedForDrawer && document.querySelector(`#workspace-navigation [data-tour="${CSS.escape(step.target!)}"]`)) {
        askedForDrawer = true;
        window.dispatchEvent(new CustomEvent(WORKSPACE_SIDEBAR_EVENT));
      }
      // Usage and Settings live in the account menu, which may be shut when the reader
      // reaches their step by any way other than opening it (a resume, a link, Back).
      if (!askedForMenu && document.querySelector(`.mj-sidebar-user-drawer [data-tour="${CSS.escape(step.target!)}"]`)) {
        askedForMenu = true;
        window.dispatchEvent(new CustomEvent(WORKSPACE_ACCOUNT_MENU_EVENT));
      }
      tries += 1;
      if (tries === 16 && step.expect?.kind !== "wait") {
        setUi((current) => (current.key !== key || current.phase === "success" ? current : { ...current, phase: "hidden" }));
      }
      timer = window.setTimeout(look, tries < 16 ? 250 : 1000);
    };
    timer = window.setTimeout(look, 40);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, stepKey, pathname, online, travelTick]);

  // Follow the control as the page scrolls, resizes or re-renders it.
  useEffect(() => {
    if (!target) {
      setRect(null);
      setCovered(null);
      return;
    }
    if (placedOnce.current) {
      setGlide(true);
      window.clearTimeout(glideTimer.current);
      glideTimer.current = window.setTimeout(() => setGlide(false), 900);
    }
    placedOnce.current = true;
    let frame = 0;
    const lost = () => {
      const s = live.current.step;
      const again = s?.target ? findTarget(s.target) : null;
      setTarget(again);
      if (!again) setUi((current) => (current.phase === "success" ? current : { ...current, phase: s?.expect?.kind === "wait" ? "locating" : "hidden" }));
    };
    const measure = () => {
      frame = 0;
      if (!target.isConnected || inertByPage(target)) {
        lost();
        return;
      }
      const box = target.getBoundingClientRect();
      if (box.width < 2 && box.height < 2) {
        lost();
        return;
      }
      setRect((previous) => (previous
        && Math.abs(previous.left - box.left) < 0.5
        && Math.abs(previous.top - box.top) < 0.5
        && Math.abs(previous.width - box.width) < 0.5
        && Math.abs(previous.height - box.height) < 0.5
        ? previous
        : { left: box.left, top: box.top, width: box.width, height: box.height }));
      const cover = coverOver(target, layerRef.current);
      setCovered((previous) => (previous === cover ? previous : cover));
    };
    const schedule = () => {
      if (document.visibilityState === "hidden") measure();
      else if (!frame) frame = window.requestAnimationFrame(measure);
    };
    // Instant: a smooth scroll moves the control out from under a spotlight still gliding to it.
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const poll = window.setInterval(schedule, 350);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // What finishes the step: clicks, values and submits on the real control.
  useEffect(() => {
    if (!running || !tour || !step || !target) return;
    const expect = step.expect;
    const words = stepWords(copy, tour, step);
    let valueTimer = 0;
    const onClick = (event: MouseEvent) => {
      const node = event.target as Node | null;
      if (!node || layerRef.current?.contains(node) || !target.contains(node)) return;
      if (step.checksPrompt) checkPrompt();
      if (clickOutcome(step, "target") === "match") complete("done");
    };
    const onSubmit = (event: Event) => {
      const form = event.target as Node | null;
      if (step.checksPrompt && form && form.contains(target)) checkPrompt();
    };
    const onValue = (event: Event) => {
      if (expect?.kind !== "value") return;
      const node = event.target as Node | null;
      if (!node || !target.contains(node)) return;
      window.clearTimeout(valueTimer);
      const key = `${tour.id}.${live.current.active?.step}`;
      valueTimer = window.setTimeout(() => {
        const value = fieldValue(target) ?? "";
        if (!valueMatches(expect.match, value)) return;
        if (words.fill && !(fieldIn(target) instanceof HTMLSelectElement) && classifyPrompt(value, [words.fill]) === "own") {
          notice.current = { ...notice.current, ownValue: true };
        }
        complete("done");
      }, event.type === "change" ? 80 : didItKey.current === key ? 160 : 900);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("input", onValue, true);
    document.addEventListener("change", onValue, true);
    return () => {
      window.clearTimeout(valueTimer);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("input", onValue, true);
      document.removeEventListener("change", onValue, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, stepKey, target, locale]);

  // "wait" steps finish when their named control appears.
  useEffect(() => {
    if (!running || !step || step.expect?.kind !== "wait") return;
    if (ui.phase === "away" || ui.phase === "wandered" || ui.phase === "offline") return;
    const match = step.expect.match;
    const timer = window.setInterval(() => {
      if (findTarget(match)) complete("done");
    }, 700);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, stepKey, ui.phase]);

  // Twenty quiet seconds on a step that waits for the reader: a nudge, and help.
  useEffect(() => {
    if (!running || ui.phase !== "waiting" || ui.nudged) return;
    const key = stepKey;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setUi((current) => (current.key === key && current.phase === "waiting" ? { ...current, nudged: true } : current)), IDLE_NUDGE_MS);
    };
    arm();
    const names = ["pointerdown", "keydown", "input", "wheel"] as const;
    for (const name of names) window.addEventListener(name, arm, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const name of names) window.removeEventListener(name, arm, { capture: true });
    };
  }, [running, stepKey, ui.phase, ui.nudged]);

  // Keyboard and screen readers: the card describes the control; while a step
  // waits for an action, focus goes to the control and the rest of the page is inert.
  // Never while something covers the control: making the rest of the page inert would
  // shut the reader inside whatever is open on top of it, Settings included.
  const waitsForAction = running && ui.phase === "waiting" && !chooserOpen && !covered;
  useEffect(() => {
    if (!running || !target || !settled) return;
    const control = controlIn(target) ?? target;
    const undoDescribe = describeWith(control, TOUR_CARD_BODY_ID);
    if (!waitsForAction) return undoDescribe;
    const undoInert = inertOutside(target, layerRef.current);
    const focus = document.activeElement;
    if (!(focus && target.contains(focus))) control.focus({ preventScroll: true });
    return () => {
      undoInert();
      undoDescribe();
    };
  }, [running, target, waitsForAction, settled]);

  // Escape skips the step; arrow keys move, unless a field or a tab bar owns them.
  useEffect(() => {
    if (!running) return;
    const onKey = (event: KeyboardEvent) => {
      if (chooserOpen || event.defaultPrevented) return;
      const { ui: current, target: element, active: a, tour: t, step: s } = live.current;
      if (!t || !s || !a) return;
      const layer = layerRef.current;
      const focus = document.activeElement;
      const inLayer = Boolean(layer && focus && layer.contains(focus));
      if (event.key === "Escape") {
        if (inLayer && isEditable(focus)) return;
        const inTarget = Boolean(element && focus && element.contains(focus));
        if (!inLayer && !inTarget && focus !== document.body) return;
        event.preventDefault();
        event.stopPropagation();
        complete("skipped");
        return;
      }
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      // Only from the guide's card or with nothing focused: the Studio diagram and
      // other controls use arrow keys for themselves.
      if (isEditable(focus) || !(inLayer || focus === document.body || focus === null)) return;
      if (event.key === "ArrowLeft" && a.step > 0) {
        event.preventDefault();
        back();
      } else if (event.key === "ArrowRight" && (current.phase === "reading" || current.phase === "satisfied")) {
        event.preventDefault();
        complete("done");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, chooserOpen]);

  // The first-visit prompt: a corner, one line, never a wall.
  useEffect(() => {
    if (surface !== "workspace" || !progress || progress.active || progress.invite !== "pending" || !routeMatches("/run|/studio|/notebooks|/qapps|/library", pathname)) {
      setInviteVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setInviteVisible(true), 1200);
    return () => window.clearTimeout(timer);
  }, [surface, progress, pathname]);

  // ---- geometry --------------------------------------------------------------

  const showsHole = running && Boolean(rect) && !covered && ["waiting", "reading", "satisfied", "success"].includes(ui.phase);
  const hole = showsHole && rect ? holeFor(rect, viewport) : null;
  const centred = running && ui.phase === "reading" && !step?.target;
  // Between steps, and while the tour travels to a page, the step is "locating".
  // The card holds where it last pointed and the veil stays, instead of the page
  // flashing undimmed and the card dropping to the corner and back. With nowhere
  // to hold (a tour's first step), the card waits unseen until its control is found.
  const locating = running && ui.phase === "locating" && !hole && !centred;
  const held = locating ? lastPlacement.current : null;
  const concealed = locating && !held && step?.expect?.kind !== "wait";
  const dim = running && (hole !== null || centred || held !== null);

  let side: TourPlacement | "floating" | "centre" = "floating";
  let position = { left: Math.max(12, viewport.width - cardSize.width - 24), top: Math.max(12, viewport.height - cardSize.height - 24) };
  if (hole && step) {
    const placed = placeCard(hole, cardSize, step.placement, viewport);
    position = { left: placed.left, top: placed.top };
    side = placed.side;
  } else if (centred) {
    position = centreCard(cardSize, viewport);
    side = "centre";
  } else if (held) {
    position = held.position;
    side = held.side;
  }
  if (hole || centred) lastPlacement.current = { position, side };
  const anchor = orbAnchor({ ...position, width: cardSize.width, height: cardSize.height }, side);

  useEffect(() => {
    setOrb((previous) => {
      if (Math.abs(previous.x - anchor.x) < 1 && Math.abs(previous.y - anchor.y) < 1) return previous;
      const trail = previous.x < -20 ? previous.trail : (Math.atan2(anchor.y - previous.y, anchor.x - previous.x) * 180) / Math.PI;
      return { x: anchor.x, y: anchor.y, trail };
    });
  }, [anchor.x, anchor.y]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const read = () => setCardSize((previous) => {
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      return Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1 ? previous : { width, height };
    });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(card);
    return () => observer.disconnect();
  }, [running, stepKey]);

  // ---- render ----------------------------------------------------------------

  const portal = (node: ReactNode) => createPortal(node, document.body);

  let layer: ReactNode = null;
  if (running && tour && step && active) {
    const words = stepWords(copy, tour, step);
    const isLast = active.step === tour.steps.length - 1;
    const nextLabel = isLast ? copy.card.finish : copy.card.next;
    const skipStep: TourCardButton = { label: copy.card.skipStep, onClick: () => complete("skipped") };

    const status: TourStatusLine[] = [];
    if (ui.phase === "success") status.push({ text: copy.status.success, tone: "ok" });
    else if (ui.doing) status.push({ text: copy.status.doing, tone: "info" });
    else if (ui.missLine) status.push({ text: ui.missLine, tone: "warn" });
    else if (ui.nudged && ui.phase === "waiting") status.push({ text: copy.status.nudge, tone: "info" });
    const blocked = covered !== null && ["waiting", "reading", "satisfied"].includes(ui.phase);
    if (blocked) status.push({ text: covered === "settings" ? copy.status.wandered(copy.places.settings) : copy.status.covered, tone: "info" });
    if (ui.phase === "away") status.push({ text: copy.status.away(copy.places[placeFor(stepGo(tour, step))]), tone: "info" });
    if (ui.phase === "wandered") status.push({ text: copy.status.wandered(copy.places[placeFor(pathname)]), tone: "info" });
    if (ui.phase === "hidden") status.push({ text: copy.status.hidden, tone: "warn" });
    if (ui.phase === "offline") status.push({ text: copy.status.offline, tone: "warn" });
    if (ui.phase === "locating" && step.expect?.kind === "wait") status.push({ text: copy.status.working, tone: "info" });
    if (ui.notice.ownPrompt) status.push({ text: copy.status.ownPrompt, tone: "ok" });
    if (ui.notice.ownValue) status.push({ text: copy.status.ownValue, tone: "ok" });
    if (ui.notice.skipped) status.push({ text: copy.status.offlineSkipped(ui.notice.skipped), tone: "warn" });

    let primary: TourCardButton | null = null;
    const secondary: TourCardButton[] = [];
    if (blocked && covered === "settings") {
      primary = { label: copy.card.backToTour, onClick: () => void closeSettings() };
      secondary.push({ label: copy.card.pause, onClick: () => update((current) => setPaused(current, true)) });
    } else if (blocked && covered === "navigation") {
      primary = { label: copy.card.backToTour, onClick: closeDrawer };
      secondary.push(skipStep);
    } else if (blocked) {
      secondary.push(skipStep);
    } else switch (ui.phase) {
      case "reading":
      case "satisfied":
        primary = { label: nextLabel, onClick: () => complete("done") };
        break;
      case "waiting":
        primary = { label: nextLabel, onClick: () => undefined, disabled: true };
        if (offersHelp(ui.misses, ui.nudged) && step.expect && step.expect.kind !== "wait") secondary.push({ label: copy.card.doItForMe, onClick: () => void doItForMe(), disabled: ui.doing });
        secondary.push(skipStep);
        break;
      case "success":
        primary = { label: nextLabel, onClick: () => undefined, disabled: true };
        break;
      case "away":
        if (canGo(tour, step)) primary = { label: copy.card.takeMeThere, onClick: () => go(stepGo(tour, step)) };
        secondary.push(skipStep);
        break;
      case "wandered":
        primary = { label: copy.card.backToTour, onClick: () => (canGo(tour, step) ? go(stepGo(tour, step)) : router.back()) };
        secondary.push({ label: copy.card.pause, onClick: () => update((current) => setPaused(current, true)) });
        break;
      case "hidden":
        primary = skipStep;
        break;
      case "offline":
        primary = { label: copy.card.skipAhead, onClick: () => complete("offline") };
        break;
      default:
        primary = { label: nextLabel, onClick: () => undefined, disabled: true };
        secondary.push(skipStep);
    }

    const bands: Rect[] = hole
      ? [
          { left: 0, top: 0, width: viewport.width, height: hole.top },
          { left: 0, top: hole.top + hole.height, width: viewport.width, height: Math.max(0, viewport.height - hole.top - hole.height) },
          { left: 0, top: hole.top, width: hole.left, height: hole.height },
          { left: hole.left + hole.width, top: hole.top, width: Math.max(0, viewport.width - hole.left - hole.width), height: hole.height },
        ]
      : centred
        ? [{ left: 0, top: 0, width: viewport.width, height: viewport.height }]
        : [];
    const path = scrimPath(viewport.width, viewport.height, hole);

    layer = (
      <div
        className="mj-tour-layer"
        ref={layerRef}
        data-tour-layer=""
        data-phase={ui.phase}
        data-step={stepKey}
        data-glide={glide ? "true" : undefined}
        // A press on the guide is not a press "outside" the page's own menus. The
        // shell closes the account drawer on any window pointerdown outside it,
        // which shut the drawer under the Usage and Settings steps (headless walk).
        // React has already dispatched this at the document; stopping it here only
        // keeps it from reaching window listeners.
        onPointerDown={(event) => event.nativeEvent.stopPropagation()}
      >
        {dim ? (
          <svg className="mj-tour-scrim" width={viewport.width} height={viewport.height} aria-hidden="true" focusable="false">
            <path className="mj-tour-scrim-fill mj-tour-scrim-hole" d={path} fillRule="evenodd" style={{ d: `path("${path}")` } as CSSProperties} />
            {hole ? (
              <rect
                key={ui.missTick}
                className="mj-tour-ring"
                data-state={missFlash ? "miss" : ui.phase === "success" ? "success" : undefined}
                x={hole.left - 2}
                y={hole.top - 2}
                width={hole.width + 4}
                height={hole.height + 4}
                rx={12}
                style={{ x: hole.left - 2, y: hole.top - 2, width: hole.width + 4, height: hole.height + 4 } as CSSProperties}
              />
            ) : null}
          </svg>
        ) : null}
        {bands.map((band, index) => (
          <div key={index} className="mj-tour-block" style={band} onPointerDown={onScrimPointerDown} aria-hidden="true" />
        ))}
        {concealed ? null : <GuideOrb x={orb.x} y={orb.y} state={ui.phase === "success" ? "success" : missFlash ? "miss" : "speaking"} trail={orb.trail} />}
        {cursor.visible ? (
          <div className="mj-tour-cursor" data-pressing={cursor.pressing ? "true" : "false"} style={{ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)` }} aria-hidden="true" />
        ) : null}
        <TourCard
          copy={copy}
          locale={locale}
          cardRef={cardRef}
          concealed={concealed}
          stepKey={stepKey}
          tourName={tourTitle(copy, tour)}
          tourId={tour.id}
          index={active.step}
          total={tour.steps.length}
          words={words}
          position={position}
          origin={ORIGIN[side]}
          reduced={reduced}
          status={status}
          primary={primary}
          secondary={secondary}
          canBack={active.step > 0}
          onBack={back}
          onSkipTour={leave}
          focusPrimary={ui.phase === "reading" || ui.phase === "away" || ui.phase === "offline" || ui.phase === "hidden"}
          onShowMe={(show) => begin(show, true)}
        />
      </div>
    );
  }

  const finishedTrack = finishedTour ? tourById(finishedTour) : null;

  return (
    <>
      {layer ? portal(layer) : null}
      {finishedTrack && !running
        ? portal(
            <div className="mj-tour-invite" role="status" data-tour-finished={finishedTrack.id}>
              <span className="mj-tour-invite-orb"><GuideOrb x={0} y={0} state="success" trail={180} /></span>
              <div>
                <p>{copy.card.finished(tourTitle(copy, finishedTrack))}</p>
                <div className="mj-tour-actions">
                  <button type="button" className="mj-tour-button" data-primary="true" onClick={() => { setFinishedTour(null); setChooserOpen(true); }}>{copy.card.chooseAnother}</button>
                  <button type="button" className="mj-tour-link" onClick={() => setFinishedTour(null)}>{copy.card.close}</button>
                </div>
              </div>
            </div>,
          )
        : null}
      {active?.paused && tour && step
        ? portal(
            <div className="mj-tour-pill" role="region" aria-label={copy.card.paused}>
              <span className="mj-tour-invite-orb"><GuideOrb x={0} y={0} state="rest" trail={180} /></span>
              <span>{copy.card.paused}</span>
              <button
                type="button"
                className="mj-tour-button"
                data-primary="true"
                onClick={() => {
                  coverHandled.current = "";
                  update((current) => setPaused(current, false));
                  if (!routeMatches(stepRoute(tour, step), pathname) && canGo(tour, step)) go(stepGo(tour, step));
                }}
              >
                {copy.card.resume}
              </button>
              <button type="button" className="mj-tour-link" onClick={leave}>{copy.card.skipTour}</button>
            </div>,
          )
        : null}
      {inviteVisible && !running && !finishedTrack
        ? portal(
            <div className="mj-tour-invite" role="region" aria-label={copy.invite.label} data-tour-invite="">
              <span className="mj-tour-invite-orb"><GuideOrb x={0} y={0} state="rest" trail={180} /></span>
              <div>
                <p>{copy.invite.line}</p>
                <div className="mj-tour-actions">
                  <button type="button" className="mj-tour-button" data-primary="true" onClick={() => begin("around", true)}>{copy.invite.start}</button>
                  <button
                    type="button"
                    className="mj-tour-button"
                    onClick={() => {
                      update((current) => ({ ...current, invite: "started" }));
                      setInviteVisible(false);
                      setChooserOpen(true);
                    }}
                  >
                    {copy.invite.choose}
                  </button>
                  <button type="button" className="mj-tour-link" onClick={() => update((current) => ({ ...current, invite: "dismissed" }))}>{copy.invite.notNow}</button>
                </div>
              </div>
            </div>,
          )
        : null}
      {chooserOpen
        ? portal(<TourChooser copy={copy} progress={progress} onStart={(id, fromStart) => begin(id, fromStart)} onClose={() => setChooserOpen(false)} />)
        : null}
    </>
  );
}
