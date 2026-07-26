import { getWorkOS, refreshSession } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasCompleteProfileName,
  isValidProfileName,
  normalizeProfileName,
} from "../../../../lib/account-profile";
import { getMajoranaAuth } from "../../../../lib/auth";
import { isWorkosAuthConfigured } from "../../../../lib/auth-config";
import { isLocalDevAuthEnabled } from "../../../../lib/local-dev-auth";
import { isSingleUserLockEnabled } from "../../../../lib/single-user-lock";

/**
 * Records the first and last name a new account is required to give
 * (Owner Inbox 2026-07-27), on the WorkOS user rather than in a table of our
 * own.
 *
 * WorkOS is the identity, so writing it there is what makes the name follow the
 * person everywhere: `auth.user.firstName` starts resolving in the app layout,
 * the account drawer stops falling back to the email local part, and the API's
 * own `users.display_name` catches up on the next token because
 * `get_or_provision_user` refreshes it from the `name` claim.
 *
 * The session refresh at the end is load-bearing, not tidiness. `withAuth()`
 * reads the sealed session cookie, which was minted before this update — without
 * a refresh the layout would still see a nameless user, redirect back to
 * /welcome, and loop forever.
 */
export async function PATCH(request: NextRequest): Promise<Response> {
  // Synthetic identities (the single-user lock, local dev auth) have no WorkOS
  // user to update. Neither can reach this in practice — both carry names, so
  // the gate never fires — but a direct call must fail honestly rather than
  // 500 inside the SDK.
  if (isSingleUserLockEnabled() || isLocalDevAuthEnabled() || !isWorkosAuthConfigured()) {
    return NextResponse.json({ error: "not_supported" }, { status: 409 });
  }

  const auth = await getMajoranaAuth();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const firstName = normalizeProfileName(
    typeof body.firstName === "string" ? body.firstName : "",
  );
  const lastName = normalizeProfileName(
    typeof body.lastName === "string" ? body.lastName : "",
  );
  if (!isValidProfileName(firstName) || !isValidProfileName(lastName)) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  try {
    await getWorkOS().userManagement.updateUser({
      userId: auth.user.id,
      firstName,
      lastName,
    });
  } catch {
    // Do not leak the provider's error text to the browser; the form retries.
    return NextResponse.json({ error: "provider_unavailable" }, { status: 502 });
  }

  // Deliberately without `ensureSignedIn`: that variant redirects when there is
  // no session, and a redirect thrown inside a route handler surfaces as an
  // opaque failure to a fetch() caller. The session was already checked above.
  try {
    const refreshed = await refreshSession();
    // A refresh that comes back without the name means the sealed cookie is
    // still the old one, and the layout would send the user straight back here.
    // Say so instead of bouncing them: the name IS saved, and signing in again
    // picks it up.
    if (!hasCompleteProfileName(refreshed.user ?? {})) {
      return NextResponse.json({ ok: true, refreshed: false });
    }
  } catch {
    return NextResponse.json({ ok: true, refreshed: false });
  }

  return NextResponse.json({ ok: true, refreshed: true });
}
