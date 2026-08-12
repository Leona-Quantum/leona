import { NextResponse, type NextRequest } from "next/server";
import {
  getMajoranaAuthorizationUrl,
  isMajoranaAuthConfigured,
} from "../../../lib/auth";
import { isLocalDevAuthEnabled } from "../../../lib/local-dev-auth";
import { safeReturnTo } from "../../../lib/return-to";
import { signInFailurePath } from "../../../lib/sign-in";

export const dynamic = "force-dynamic";

function localUrl(request: NextRequest, path: string): URL {
  return new URL(path, request.nextUrl.origin);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));

  if (isLocalDevAuthEnabled()) {
    return NextResponse.redirect(localUrl(request, returnTo), 307);
  }

  const requestId = crypto.randomUUID();
  if (!isMajoranaAuthConfigured()) {
    console.error("sign-in redirect refused: authentication is not configured", { requestId });
    return NextResponse.redirect(
      localUrl(request, signInFailurePath("not_configured", requestId, returnTo)),
      303,
    );
  }

  try {
    // Generate only after the click: the provider hop stays fresh and every
    // attempt becomes visible at this deployment boundary.
    const authorizationUrl = await getMajoranaAuthorizationUrl(returnTo);
    console.info("sign-in redirect started", { requestId });
    return NextResponse.redirect(authorizationUrl, 307);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error("unknown sign-in provider error");
    console.error("sign-in redirect failed", {
      requestId,
      errorName: error.name,
    });
    return NextResponse.redirect(
      localUrl(request, signInFailurePath("provider_unavailable", requestId, returnTo)),
      303,
    );
  }
}
