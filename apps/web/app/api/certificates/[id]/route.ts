import { NextResponse } from "next/server";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * The Open Badges 2.0 hosted assertion for a claimed certificate — anonymous,
 * no credential forwarded because none is asked for (05-security.md §1a).
 * This is `Assertion.id` in the JSON itself (`certificates_badge.
 * build_assertion`, services/api): the stable, leonaqt.com-fronted URL a
 * verifier fetches, proxying `GET /v1/certificates/{id}` on the control
 * plane, which is rate-limited and read-only on its own side.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/certificates/${encodeURIComponent(id)}`),
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
