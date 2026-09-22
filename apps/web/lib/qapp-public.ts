import type { components } from "@majorana/contracts-gen";
import { cache } from "react";
import { controlPlaneUrl, fetchControlPlane } from "./control-plane.ts";

export type PublicQapp = components["schemas"]["PublicQapp"];

/**
 * One control-plane read per request, shared by every surface that shows a
 * published Qapp to an anonymous reader: `/q/[slug]` (the public page) and
 * `/embed/q/[slug]` (ai-ops 355, the view-only embed).
 *
 * This is the ONE visibility check both surfaces get. The control plane's
 * `GET /v1/qapps/public/{slug}` already refuses anything that is not
 * `visibility == public` and published — `services/api/.../routes/qapps.py`'s
 * `public_qapp()` — so there is nothing left for either Next route to decide
 * on its own. A route that re-derived "is this visible" from `PublicQapp`
 * fields instead of calling this would be a second copy of that check, and the
 * two would drift the day one of them is wrong.
 *
 * `cache()` dedupes within one render — see `loadPublicQapp`'s original
 * docstring on `/q/[slug]/page.tsx`, which is why the title can be the Qapp's
 * own title rather than the slug with its uuid tail. Moved here unchanged so
 * `/embed/q/[slug]` gets the same behaviour rather than a second copy of it.
 */
export const loadPublicQapp = cache(async (slug: string): Promise<PublicQapp | null> => {
  const response = await fetchControlPlane(controlPlaneUrl(`/v1/qapps/public/${encodeURIComponent(slug)}`));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Qapp is temporarily unavailable");
  return await response.json() as PublicQapp;
});
