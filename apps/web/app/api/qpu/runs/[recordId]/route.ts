import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
    const upstream = await fetch(`${API_URL}/v1/qpu/runs/${recordId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "control plane unavailable" }, { status: 502 });
  }
}
