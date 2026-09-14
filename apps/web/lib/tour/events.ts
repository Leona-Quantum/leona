import type { TourId } from "./types.ts";

/**
 * How the rest of the app talks to the tour runtime, which lives in the shell.
 * The header `?`, Settings → Guided tours and the guide's own Ask box all send
 * one of these; the runtime is the only thing that changes progress in response.
 */
export const TOUR_COMMAND_EVENT = "leona:tour";
/** Fired after progress is written, so a Settings list can re-read it. */
export const TOUR_PROGRESS_EVENT = "leona:tour-progress";
/**
 * Asks the workspace shell to open its navigation drawer. On a phone the rail and the
 * sidebar sit in a collapsed drawer, so a step pointing at one of them would otherwise
 * report its control as not on screen. The shell opens the drawer only at phone width.
 */
export const WORKSPACE_SIDEBAR_EVENT = "leona:workspace-sidebar";

export type TourCommand =
  | { action: "start"; tour: TourId; fromStart?: boolean }
  | { action: "resume" }
  | { action: "leave" }
  | { action: "open-chooser" }
  | { action: "invite-again" };

export function sendTourCommand(command: TourCommand): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TourCommand>(TOUR_COMMAND_EVENT, { detail: command }));
}
