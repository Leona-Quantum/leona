import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** Query params this proxy forwards. Anything else is dropped, as on /api/artifacts. */
const FORWARDED = ["before_seq", "limit"];

/**
 * One artifact's version history.
 *
 * Ordered by `seq`, which is authoring order — not "which is current". A restore
 * moves `artifacts.current_version_id` without writing a row, so the row flagged
 * `is_current` is regularly not the first one.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  const { artifactId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const incoming = new URL(request.url).searchParams;
  const url = controlPlaneUrl(`/v1/artifacts/${encodeURIComponent(artifactId)}/versions`);
  for (const key of FORWARDED) {
    const value = incoming.get(key);
    if (value !== null) url.searchParams.set(key, value);
  }
  try {
    const upstream = await fetchControlPlane(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
