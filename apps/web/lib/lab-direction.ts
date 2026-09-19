// `/lab` is an unratified visual direction (docs/ui/tokens.md: the `--lab-*`
// ramp and this route are accepted or deleted together). It is auth-gated but
// nothing links to it, so before this gate any signed-in account that typed the
// URL on leonaqt.com got a second, contradictory landing page.
//
// Shaped like isPublicDemoEnabled(): reachable where the direction is being
// reviewed — a preview deployment or a local dev server — and unreachable on
// production, with no environment variable that can open it there.
//
// `deployEnv()` reads LEONA_DEPLOY_ENV first, VERCEL_ENV as the fallback
// (lib/deploy-env.ts) — on Vercel that is VERCEL_ENV, unchanged. NODE_ENV is
// read directly here, not through that module: it is not a platform variable.
import { deployEnv } from "./deploy-env.ts";

export function isLabDirectionEnabled(): boolean {
  return deployEnv() === "preview" || process.env.NODE_ENV === "development";
}
