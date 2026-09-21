// A deliberately narrow showcase seam: public only on explicitly enabled
// preview deployments (or local development), never on production.
//
// deployEnv() reads LEONA_DEPLOY_ENV (lib/deploy-env.ts), set by
// deploy-web.yml/cloudbuild.web.yaml on Cloud Run.
import { deployEnv } from "./deploy-env.ts";

export function isPublicDemoEnabled(): boolean {
  return (
    process.env.MAJORANA_PUBLIC_DEMO === "true" &&
    (deployEnv() === "preview" || process.env.NODE_ENV === "development")
  );
}
