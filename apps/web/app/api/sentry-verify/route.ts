import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Server half of `app/dev/sentry-verify` — see that page for why this exists. */
export async function GET() {
  if (process.env.NODE_ENV === "production" && process.env.MAJORANA_SENTRY_VERIFY !== "1") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  throw new Error("MAJORANA_SENTRY_VERIFY: deliberate server-side error");
}
