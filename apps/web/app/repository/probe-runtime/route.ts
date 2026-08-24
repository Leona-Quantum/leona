// TEMPORARY — delete before this branch merges.
//
// The sanitizer re-landing (leona 690 / 693) turns on whether the deployed
// lambda can `require()` an ES module: jsdom 30 reaches `@exodus/bytes`, which
// is ESM-only, through a CommonJS file. `require(esm)` is available from Node
// 22.12 and on by default in 24. The project is configured `nodeVersion: 24.x`
// and the preview still throws ERR_REQUIRE_ESM, so one of those two facts is
// wrong and guessing which would cost a deploy cycle either way.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let dompurify = "ok";
  try {
    const mod = await import("isomorphic-dompurify");
    dompurify = typeof mod.default === "function" ? "loaded (function)" : `loaded (${typeof mod.default})`;
  } catch (error) {
    dompurify = `${(error as { code?: string }).code ?? "ERR"}: ${(error as Error).message}`.slice(0, 800);
  }
  return Response.json({
    node: process.version,
    execArgv: process.execArgv,
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    dompurify,
  });
}
