import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ commentId: string }> };

/** The author rewrites their comment. Anyone else is refused upstream. */
export async function PATCH(request: Request, context: Context) {
  const [{ accessToken }, { commentId }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    context.params,
    request.text(),
  ]);
  return proxy(`/v1/comments/${encodeURIComponent(commentId)}`, {
    method: "PATCH",
    accessToken,
    body,
  });
}

/** Remove a comment from its thread: the author, or an owner or admin. */
export async function DELETE(_request: Request, context: Context) {
  const [{ accessToken }, { commentId }] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    context.params,
  ]);
  return proxy(`/v1/comments/${encodeURIComponent(commentId)}`, { method: "DELETE", accessToken });
}

async function proxy(
  path: string,
  options: { method: string; accessToken: string; body?: string },
): Promise<Response> {
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl(path), {
      method: options.method,
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body,
    });
    // 204 carries no body, and constructing a NextResponse with one for a 204
    // throws in the Node runtime.
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
