import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";
import { getAccountTier } from "../../../lib/account-tier-server";
import {
  artifactAllowanceRefusal,
  assessRunAllowance,
  runAllowanceRefusal,
} from "../../../lib/run-allowance";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL("/v1/runs", API_URL);
  for (const key of ["status", "cursor", "limit"]) {
    const value = requestUrl.searchParams.get(key);
    if (value) upstreamUrl.searchParams.set(key, value);
  }
  try {
    const upstream = await fetch(upstreamUrl, {
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

async function fetchJsonArray(path: string, accessToken: string): Promise<unknown[] | null> {
  try {
    const upstream = await fetch(new URL(path, API_URL), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!upstream.ok) return null;
    const payload = (await upstream.json()) as unknown;
    return Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * The weekly run allowance and the Vault artifact cap, enforced where the
 * submission enters the product. Metered tiers pay one or two upstream list
 * reads per submission; unmetered tiers skip them entirely. If the usage read
 * itself fails the submission proceeds — a metering outage must degrade to
 * the pre-metering behaviour, not lock paying users out.
 */
export async function POST(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const body = await request.text();
  const idempotencyKey = request.headers.get("Idempotency-Key");

  let submission: { mode?: string; artifact_version_id?: string | null } = {};
  try {
    submission = JSON.parse(body) as typeof submission;
  } catch {
    // The control plane validates the body; enforcement only reads two fields.
  }

  if (submission.mode === "execute") {
    const { limits } = await getAccountTier();
    if (limits.agentRunsPerWeek !== null) {
      const runs = await fetchJsonArray("/v1/runs?limit=100", accessToken);
      if (runs) {
        const verdict = assessRunAllowance(
          limits.agentRunsPerWeek,
          runs as Array<{ mode?: string | null; created_at?: string | null }>,
        );
        if (!verdict.allowed) {
          return NextResponse.json(runAllowanceRefusal(verdict), { status: 429 });
        }
      }
    }
    // A run without a parent artifact version can add a new artifact to the
    // Vault; refuse it at the cap. Reruns against an existing version append
    // evidence and stay allowed. `/v1/artifacts` counts kept artifacts only, so
    // a run the user never kept does not spend their allowance.
    if (limits.privateArtifacts !== null && !submission.artifact_version_id) {
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
    const upstream = await fetch(`${API_URL}/v1/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body,
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
