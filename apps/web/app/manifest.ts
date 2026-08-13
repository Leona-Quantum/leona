/**
 * /manifest.webmanifest — the install metadata the document has been linking to
 * since `middleware.ts` first excluded this path from the auth gate, and which
 * has 404'd ever since.
 *
 * **No `background_color` or `theme_color`.** Both fields take a literal colour
 * and nothing else — a manifest cannot reference a CSS custom property — and
 * `scripts/check-raw-hex.mjs` allows raw hex only in `packages/ts/ui/tokens.css`
 * for the reason that a colour written twice drifts. There is a second reason
 * to leave them out here even if the gate allowed it: this site ships a light
 * and a dark theme chosen at load, so any single splash colour would be wrong
 * for half the visitors. Omitted is a defined state for both fields; the
 * browser uses its own.
 *
 * The strings match `app/layout.tsx`'s default metadata rather than restating
 * the product in different words. English only: the locale is a cookie
 * (`public-locale-server`), and reading it here would make an install manifest
 * a per-request render for one string.
 */
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Leona Quantum · Evidence for quantum work",
    short_name: "Leona Quantum",
    description:
      "Leona Quantum connects public research, private workspaces, and verifiable quantum execution.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [
      // Both are the App Router's own file conventions — `app/icon.svg` and
      // `app/apple-icon.png` are served at these addresses, which is why the
      // middleware matcher already names them.
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
