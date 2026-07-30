import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
} from "../../../../lib/control-plane";
import { isAllowedVqeProxyRequest } from "../../../../lib/vqe-proxy-policy";

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join("/");
  if (!isAllowedVqeProxyRequest(path, request.method)) {
    return NextResponse.json({ error: "unsupported VQE proxy path" }, { status: 404 });
  }
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (contentType) headers["Content-Type"] = contentType;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl(`/v1/vqe/${path}`), {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.text() : undefined,
    });
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

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
