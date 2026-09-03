import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Queue notebook generation for one or more modules (`GenerateCourseRequest`,
 * `{ module_ids }` — omitted/`null` means every module without a notebook
 * yet) -> `{ course, run_ids }`. The body may be empty (the "Generate all"
 * button sends no body at all), so this forwards whatever the client sent
 * rather than assuming a shape.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const [{ accessToken }, { courseId }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
    request.text(),
  ]);
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/courses/${encodeURIComponent(courseId)}/generate`),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        },
        body: body || "{}",
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
