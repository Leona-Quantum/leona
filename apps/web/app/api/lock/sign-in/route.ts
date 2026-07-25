import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  areLockCredentialsValid,
  isSingleUserLockEnabled,
  issueSessionCookieValue,
  LOCK_COOKIE,
} from "../../../../lib/single-user-lock";
import { createLockThrottle, throttleKeyFromHeaders } from "../../../../lib/lock-throttle";

// Brute-force throttle. The logic and the rationale for how the key is derived
// live in lib/lock-throttle.ts, where they are unit-tested; keeping them here
// meant the only guard on the deployment's only credential had no test at all.
const throttle = createLockThrottle();

// Sign-in endpoint for the temporary single-user lock (Owner Inbox 2026-07-19).
// Validates the one username/password and, on success, sets the signed session
// cookie so the rest of the app behaves like a normal WorkOS session. Returns
// JSON so the sign-in form can show inline errors and then navigate.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSingleUserLockEnabled()) {
    return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  }

  const throttleKey = throttleKeyFromHeaders(request.headers);
  if (throttle.isRateLimited(throttleKey)) {
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
    throttle.recordFailure(throttleKey);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // Clear the failure counter on success so a legitimate operator isn't locked
  // out by earlier typos.
  throttle.clearFailures(throttleKey);

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
