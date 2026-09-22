// A Node ESM loader hook that lets `finder-rank.mts` (this directory) import
// `apps/web/lib/public-repository.ts` and its transitive graph directly with
// plain Node, with no bundler.
//
// Why this exists: `apps/web/lib/public-repository.ts` and several of the
// entry-data modules it assembles (`./repository/entries-legacy`, etc.) import
// each other WITHOUT a file extension — valid and required for Next.js's own
// bundler resolution, but Node's native ESM loader (which is what
// `node --experimental-strip-types` uses — see `apps/web/package.json`'s own
// `test` script) requires an explicit extension for a relative specifier and
// raises `ERR_MODULE_NOT_FOUND` otherwise. `apps/web/lib/repository/topics.ts`
// documents the same trap from the other side: "The `.ts` is load-bearing:
// `node --test` resolves specifiers literally". No `apps/web` test today
// value-imports `public-repository.ts` at runtime (confirmed by inspection
// 2026-09-21: `client-catalog-leak.test.ts` only greps its *source text* for
// the string "public-repository", it never imports the module), so this gap
// in the app's own test suite was never exercised before this harness needed
// to run the module standalone.
//
// This hook does the minimum a bundler already does for that repo: if a
// relative specifier fails to resolve as written, retry once with `.ts`
// appended. It touches no file under `apps/web` — the alternative (adding
// extensions to the app's own source) is out of scope for an evaluation
// harness and is a product-code change this branch does not make.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isModuleNotFound = err && err.code === "ERR_MODULE_NOT_FOUND";
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasNoExtension = !/\.[a-zA-Z0-9]+$/.test(specifier);
    if (isModuleNotFound && isRelative && hasNoExtension) {
      return await nextResolve(`${specifier}.ts`, context);
    }
    throw err;
  }
}
