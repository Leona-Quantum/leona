import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Put a finished run's artifact into the Vault.
 *
 * Every successful run materializes — the Run surface's conversion tabs read the
 * saved version and the next turn forks from it — but it is only listed in the
 * Vault once the user keeps it. See migration 0036.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  const { artifactId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/artifacts/${encodeURIComponent(artifactId)}/keep`),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
