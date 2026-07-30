import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
} from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/runs/${encodeURIComponent(taskId)}/cancel`),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
