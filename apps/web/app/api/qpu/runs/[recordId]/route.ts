import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ recordId: string }> },
) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const { recordId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(recordId)) {
    return NextResponse.json({ error: "invalid qpu run id" }, { status: 400 });
  }
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl(`/v1/qpu/runs/${recordId}`), {
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
