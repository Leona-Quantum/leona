import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";
import { blockCatalog } from "../../../lib/notebook-block-catalog";

export const dynamic = "force-dynamic";

/**
 * The Atlas slice a notebook page needs to draw block cells (ai-ops 382, Phase B S1):
 * every method's name, cost text and citations, the planner's lean graph and the formula
 * audit's rows (`lib/notebook-block-catalog.ts`). Asked for only by a notebook that has a
 * block cell or is adding one, so no other notebook load carries it.
 *
 * Signed-in, like every other notebook route, although the data itself is the public
 * Atlas. Built once per language per server process and cached by the browser for an
 * hour: it changes only when the site is deployed.
 */
export async function GET(request: Request) {
  await getMajoranaAuth({ ensureSignedIn: true });
  const locale = new URL(request.url).searchParams.get("locale") === "ja" ? "ja" : "en";
  return NextResponse.json(blockCatalog(locale), {
    headers: { "Cache-Control": "private, max-age=3600" },
  });
}
