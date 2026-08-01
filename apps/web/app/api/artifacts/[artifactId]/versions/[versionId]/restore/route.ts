import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
} from "../../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Make an earlier version current again.
 *
 * The 409 the control plane returns when the restore would lose QASM, exports,
 * estimates or a verdict is passed through untouched: its `losses` codes are what
 * the Studio dialog renders, in the reader's own language.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string; versionId: string }> },
) {
  const { artifactId, versionId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(
        `/v1/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(versionId)}/restore`,
      ),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        },
        body: await request.text(),
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
