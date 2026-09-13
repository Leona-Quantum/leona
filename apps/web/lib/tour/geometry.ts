import type { TourPlacement } from "./types.ts";

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Viewport = { width: number; height: number };

const GAP = 16;
const MARGIN = 12;

/** The spotlight hole: the target's box, padded, never past the viewport. */
export function holeFor(target: Rect, viewport: Viewport, padding = 6): Rect {
  const left = Math.max(MARGIN / 2, target.left - padding);
  const top = Math.max(MARGIN / 2, target.top - padding);
  const right = Math.min(viewport.width - MARGIN / 2, target.left + target.width + padding);
  const bottom = Math.min(viewport.height - MARGIN / 2, target.top + target.height + padding);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function fits(left: number, top: number, card: Size, viewport: Viewport): boolean {
  return left >= MARGIN && top >= MARGIN && left + card.width <= viewport.width - MARGIN && top + card.height <= viewport.height - MARGIN;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function candidate(side: TourPlacement, hole: Rect, card: Size): { left: number; top: number } {
  switch (side) {
    case "top":
      return { left: hole.left + hole.width / 2 - card.width / 2, top: hole.top - GAP - card.height };
    case "bottom":
      return { left: hole.left + hole.width / 2 - card.width / 2, top: hole.top + hole.height + GAP };
    case "left":
      return { left: hole.left - GAP - card.width, top: hole.top + hole.height / 2 - card.height / 2 };
    case "right":
      return { left: hole.left + hole.width + GAP, top: hole.top + hole.height / 2 - card.height / 2 };
  }
}

const OPPOSITE: Record<TourPlacement, TourPlacement> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * Where the card goes: the preferred side, then its opposite, then the rest.
 * The first side whose box fits (after sliding along its own axis) wins; if none
 * fits — a narrow phone and a tall target — the card sits at the bottom of the
 * screen, clamped, rather than off it.
 */
export function placeCard(hole: Rect, card: Size, preferred: TourPlacement, viewport: Viewport): { left: number; top: number; side: TourPlacement | "floating" } {
  const order: TourPlacement[] = [preferred, OPPOSITE[preferred], ...(["bottom", "top", "right", "left"] as const).filter((side) => side !== preferred && side !== OPPOSITE[preferred])];
  for (const side of order) {
    const raw = candidate(side, hole, card);
    const slid = side === "top" || side === "bottom"
      ? { left: clamp(raw.left, MARGIN, viewport.width - MARGIN - card.width), top: raw.top }
      : { left: raw.left, top: clamp(raw.top, MARGIN, viewport.height - MARGIN - card.height) };
    if (fits(slid.left, slid.top, card, viewport)) return { ...slid, side };
  }
  return {
    left: clamp((viewport.width - card.width) / 2, MARGIN, viewport.width - MARGIN - card.width),
    top: clamp(viewport.height - card.height - MARGIN, MARGIN, viewport.height - MARGIN - card.height),
    side: "floating",
  };
}

/** A centred card, for steps with nothing to point at. */
export function centreCard(card: Size, viewport: Viewport): { left: number; top: number } {
  return {
    left: clamp((viewport.width - card.width) / 2, MARGIN, viewport.width - MARGIN - card.width),
    top: clamp(viewport.height * 0.32 - card.height / 2, MARGIN, viewport.height - MARGIN - card.height),
  };
}

/** Where the guide's point of light rests: at the card corner that faces the spotlight. */
export function orbAnchor(cardBox: Rect, side: TourPlacement | "floating" | "centre"): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: cardBox.left + cardBox.width / 2, y: cardBox.top + cardBox.height + 2 };
    case "bottom":
      return { x: cardBox.left + cardBox.width / 2, y: cardBox.top - 2 };
    case "left":
      return { x: cardBox.left + cardBox.width + 2, y: cardBox.top + 24 };
    case "right":
      return { x: cardBox.left - 2, y: cardBox.top + 24 };
    default:
      return { x: cardBox.left + 22, y: cardBox.top - 2 };
  }
}
