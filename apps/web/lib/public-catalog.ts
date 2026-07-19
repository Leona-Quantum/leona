// Slice D flag: serve /repository from the API's published system catalog
// instead of the committed static corpus. Off by default — the static corpus
// stays the source of truth until the Neon cutover is verified in production.
//
// Deliberately NOT gated on VERCEL_ENV (unlike lib/public-demo.ts): this flag's
// whole purpose is to eventually be true in production. It is a plain opt-in so
// the rollout is a config change, not a redeploy of different code.
export function isPublicCatalogApiEnabled(): boolean {
  return process.env.MAJORANA_PUBLIC_CATALOG_API === "true";
}
