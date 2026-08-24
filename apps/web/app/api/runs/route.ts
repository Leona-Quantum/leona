import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../lib/control-plane";
import { getAccountTier } from "../../../lib/account-tier-server";
import { artifactAllowanceRefusal } from "../../../lib/run-allowance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const requestUrl = new URL(request.url);
  const upstreamUrl = controlPlaneUrl("/v1/runs");
  for (const key of ["status", "cursor", "limit"]) {
    const value = requestUrl.searchParams.get(key);
    if (value) upstreamUrl.searchParams.set(key, value);
  }
  try {
    const upstream = await fetchControlPlane(upstreamUrl, {
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

async function fetchJsonArray(path: string, accessToken: string): Promise<unknown[] | null> {
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl(path), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!upstream.ok) return null;
    const payload = (await upstream.json()) as unknown;
    return Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * The saved-artifact cap, enforced where the submission enters the product.
 * Metered tiers pay one upstream list read per submission; unmetered tiers skip
 * it entirely. If that read itself fails the submission proceeds — a metering
 * outage must degrade to the pre-metering behaviour, not lock paying users out.
 *
 * The weekly allowance is NOT checked here. It is the control plane's, it is
 * metered in tokens, and this route passes its 429 through unchanged.
 */
export async function POST(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const body = await request.text();
  const idempotencyKey = request.headers.get("Idempotency-Key");

  let submission: { mode?: string; artifact_version_id?: string | null; circuit_optimization?: unknown } = {};
  try {
    submission = JSON.parse(body) as typeof submission;
  } catch {
    // The control plane validates the body; enforcement only reads two fields.
  }

  if (submission.mode === "execute") {
    const { limits } = await getAccountTier();
    // The weekly RUN pre-check that used to live here is gone, and its absence
    // is the fix rather than a simplification.
    //
    // The control plane stopped metering runs on 2026-08-03 and started metering
    // tokens; `agent_runs_per_week` is now only what the plan is SOLD as. This
    // pre-check was left comparing against it, which made the BFF the stricter
    // of the two gates: a free account doing cheap work — the exact case the
    // token switch exists to serve, since a Bell run costs about half a
    // run-equivalent — was refused here at its 6th run of the week and never
    // reached the server that would have admitted it.
    //
    // Not replaced with a token pre-check. The BFF holds no token figure without
    // another round trip, and a second copy of the gate is what produced this
    // bug in the first place. `POST /v1/runs` answers 429 with the allowance
    // actually enforced, and this route already passes an upstream response
    // through untouched.
    //
    // A run without a parent artifact version can add a new artifact to the
    // workspace; refuse it at the cap. Reruns against an existing version append
    // evidence and stay allowed. `/v1/artifacts` counts kept artifacts only, so
    // a run the user never kept does not spend their allowance.
    if (limits.privateArtifacts !== null && !submission.artifact_version_id && !submission.circuit_optimization) {
      const artifacts = await fetchJsonArray(
        `/v1/artifacts?limit=${limits.privateArtifacts + 1}`,
        accessToken,
      );
      if (artifacts && artifacts.length >= limits.privateArtifacts) {
        return NextResponse.json(
          artifactAllowanceRefusal(artifacts.length, limits.privateArtifacts),
          { status: 429 },
        );
      }
    }
  }

  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/runs"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body,
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
