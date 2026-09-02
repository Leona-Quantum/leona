import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * An uploaded `.ipynb` becomes a new notebook the reader can edit with Nala.
 * Body is `ImportNotebookRequest` (`ipynb`, optional `title`, `execute`); the
 * reader's own file content is what crosses this boundary, so this stays
 * body-shape-agnostic and forwards whatever the client sent.
 */
export async function POST(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const body = await request.text();
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/notebooks/import"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
      },
      body,
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
