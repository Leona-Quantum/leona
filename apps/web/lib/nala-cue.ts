export type NalaCue = "flick" | "tilt" | "nod";

export const NALA_CUE_EVENT = "leona:nala";

export function cueNala(cue: NalaCue): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NALA_CUE_EVENT, { detail: { cue } }));
}
