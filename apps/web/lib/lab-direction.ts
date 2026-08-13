// `/lab` is an unratified visual direction (docs/ui/tokens.md: the `--lab-*`
// ramp and this route are accepted or deleted together). It is auth-gated but
// nothing links to it, so before this gate any signed-in account that typed the
// URL on leonaqt.com got a second, contradictory landing page.
//
// Shaped like isPublicDemoEnabled(): reachable where the direction is being
// reviewed — a preview deployment or a local dev server — and unreachable on
// production, with no environment variable that can open it there.
export function isLabDirectionEnabled(): boolean {
  return process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development";
}
