import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ALLOWED = [
  new RegExp(`^experiments/${UUID}$`),
  new RegExp(`^experiments/${UUID}/executions$`),
  new RegExp(`^experiments/${UUID}/events$`),
  new RegExp(`^experiments/${UUID}/cancel$`),
  new RegExp(`^experiments/${UUID}/materialize$`),
  new RegExp(`^executions/${UUID}$`),
];

function allowed(path: string, method: string): boolean {
  if (!ALLOWED.some((pattern) => pattern.test(path))) return false;
  if (method === "GET") return !path.endsWith("/cancel") && !path.endsWith("/materialize");
  if (method === "POST") {
    return path.endsWith("/executions")
      || path.endsWith("/cancel")
      || path.endsWith("/materialize");
  }
  return false;
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join("/");
  if (!allowed(path, request.method)) {
    return NextResponse.json({ error: "unsupported VQE proxy path" }, { status: 404 });
  }
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (contentType) headers["Content-Type"] = contentType;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  try {
    const upstream = await fetch(new URL(`/v1/vqe/${path}`, API_URL), {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.text() : undefined,
      cache: "no-store",
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json({ error: "control plane unavailable" }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
