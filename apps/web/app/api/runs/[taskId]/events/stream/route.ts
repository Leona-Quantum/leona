import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  openControlPlaneStream,
} from "../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const requestUrl = new URL(request.url);
  const upstreamUrl = controlPlaneUrl(
    `/v1/runs/${encodeURIComponent(taskId)}/events/stream`,
  );
  const after = requestUrl.searchParams.get("after");
  if (after) upstreamUrl.searchParams.set("after", after);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  const lastEventId = request.headers.get("Last-Event-ID");
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;

  try {
    const upstream = await openControlPlaneStream(upstreamUrl, {
      headers,
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
