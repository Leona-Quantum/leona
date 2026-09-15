// A deliberately narrow showcase seam: public only on explicitly enabled
// preview deployments (or local development), never on production.
//
// deployEnv() reads LEONA_DEPLOY_ENV first, VERCEL_ENV as the fallback
// (lib/deploy-env.ts) — on Vercel that is VERCEL_ENV, unchanged.
import { deployEnv } from "./deploy-env.ts";

export function isPublicDemoEnabled(): boolean {
  return (
    process.env.MAJORANA_PUBLIC_DEMO === "true" &&
    (deployEnv() === "preview" || process.env.NODE_ENV === "development")
  );
}
