import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  areLockCredentialsValid,
  isSingleUserLockEnabled,
  issueSessionCookieValue,
  LOCK_COOKIE,
} from "../../../../lib/single-user-lock";

// Best-effort brute-force throttle. Keyed by client IP, this slows repeated
// guesses against the single credential. NOTE: it is per-instance in-memory, so
// on serverless it does not coordinate across cold-started instances — a durable
// KV store would be needed for a hard guarantee. For a temporary dev-stage gate
// this raises the cost of casual brute-forcing without new infra.
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Returns true when the caller is currently over the failure threshold.
function isRateLimited(ip: string): boolean {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || now > entry.resetAt) {
    failures.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

// Sign-in endpoint for the temporary single-user lock (Owner Inbox 2026-07-19).
// Validates the one username/password and, on success, sets the signed session
// cookie so the rest of the app behaves like a normal WorkOS session. Returns
// JSON so the sign-in form can show inline errors and then navigate.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSingleUserLockEnabled()) {
    return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  }

  const ip = clientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }

  let username = "";
  let password = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    username = typeof body.username === "string" ? body.username : "";
    password = typeof body.password === "string" ? body.password : "";
  } else {
    const form = await request.formData();
    username = String(form.get("username") ?? "");
    password = String(form.get("password") ?? "");
  }

  if (!areLockCredentialsValid(username, password)) {
    recordFailure(ip);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // Clear the failure counter on success so a legitimate operator isn't locked
  // out by earlier typos.
  failures.delete(ip);

  const token = await issueSessionCookieValue();
  if (!token) {
    return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  }

  const store = await cookies();
  store.set(LOCK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // ~30 days; the operator stays signed in across sessions like a normal login.
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({ ok: true });
}
