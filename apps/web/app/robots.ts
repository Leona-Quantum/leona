/**
 * /robots.txt — crawl the public site, stay out of the application.
 *
 * The disallow list is `CRAWLER_DISALLOWED_PATHS`, read against `middleware.ts`
 * rather than guessed: everything not in that file's PUBLIC_PATHS is behind the
 * AuthKit gate, so a crawler that follows a link there is redirected to sign-in
 * and the URL it indexes is one no reader can open.
 *
 * This is not a security control and must not be treated as one — robots.txt is
 * a request, and the thing that actually keeps `/run` private is the middleware.
 * What it buys is that the search result for "Leona Quantum library" is the
 * public repository rather than a sign-in redirect.
 */
import type { MetadataRoute } from "next";
import { canonicalOrigin } from "../lib/site-origin";
import { CRAWLER_DISALLOWED_PATHS } from "../lib/sitemap-paths";

export default function robots(): MetadataRoute.Robots {
  const origin = canonicalOrigin();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...CRAWLER_DISALLOWED_PATHS],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
