import { NextResponse } from "next/server";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * The anonymous notebook share view. Proxies `POST /v1/notebooks/shared/lookup`.
 *
 * No `getMajoranaAuth` here, on purpose: this is the one route in the app a
 * signed-out visitor is expected to reach on purpose, carrying nothing but the
 * token their link gave them. It takes no Authorization header and forwards
 * none — see `apps/web/app/shared/notebooks/page.tsx` for why the token
 * travels to the browser in a URL FRAGMENT rather than a path segment, and why
 * this route is a POST with the token in its JSON body rather than a
 * `GET .../{token}`: a path- or query-embedded secret ends up in every access
 * log between here and the control plane, and a POST body does not.
 *
 * `Cache-Control: private, no-store` is set explicitly rather than left to a
 * framework default (PR 923's lesson). Cloudflare's default cache rules do not
 * cache POST responses at all, which is one whole class of that PR's
 * cache-poisoning risk this route never has a chance to hit — the explicit
 * header is defence in depth on top of that, not instead of it.
 */
export async function POST(request: Request) {
  const body = await request.text();
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/notebooks/shared/lookup"), {
      method: "POST",
      headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/json" },
      body,
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
