// A deliberately narrow showcase seam: public only on explicitly enabled
// preview deployments (or local development), never on production.
export function isPublicDemoEnabled(): boolean {
  return (
    process.env.MAJORANA_PUBLIC_DEMO === "true" &&
    (process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development")
  );
}
