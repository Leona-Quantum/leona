/**
 * The site-wide Open Graph image (ai-ops 133, "Missing Open Graph image").
 *
 * ## What was actually missing
 *
 * `og:title`, `og:description`, `og:url`, `og:site_name` and `og:type` were all
 * being emitted correctly on every public page. `og:image` was the one absent
 * tag, so every link shared into Slack, iMessage, LinkedIn or X unfurled as a
 * bare text card. The root metadata even anticipated this — its `metadataBase`
 * comment reads "and any OG image added later" — it was simply never added.
 *
 * ## Why a generated image and not a checked-in PNG
 *
 * A static PNG is one more binary nobody edits when the wordmark or the palette
 * moves, and it goes stale silently because nothing renders it in review. This
 * is drawn from the same design tokens the site uses (`packages/ts/ui/tokens.css`
 * dark theme), so it cannot drift from the brand without someone changing these
 * literals on purpose.
 *
 * It is generated at BUILD time, not per request: this file exports no dynamic
 * params, so Next renders it once and serves it as a static asset from the CDN.
 * There is no per-share runtime cost, which matters because crawlers refetch OG
 * images aggressively.
 *
 * ## Why the colours are literals rather than `var(--bg-0)`
 *
 * Satori (what `ImageResponse` renders with) resolves no CSS custom properties
 * and no stylesheet — it takes inline styles on a small flexbox subset only. The
 * values below are copied from the dark theme in `tokens.css` and named in the
 * comments so a token change can be traced here. Dark is the right choice
 * regardless of the reader's theme, because an OG card is rendered by Slack or
 * X against their own chrome and has no visitor preference to honour.
 */
import { ImageResponse } from "next/og";

import { OG_IMAGE, SITE_NAME } from "../lib/public-metadata";

// Facebook, X, LinkedIn and Slack all crop toward 1.91:1. This is the size they
// all document, and it is what `twitter:card = summary_large_image` expects.
//
// Taken from `OG_IMAGE` rather than restated, because these are not two
// coincidentally-equal numbers: the metadata tells crawlers how large the image
// is and this tells Next how large to draw it, so a disagreement between them
// is a card that renders at one size and is advertised at another. Same for the
// alt text, which would otherwise be defined in two places and drift silently
// (Sourcery, PR 684).
export const size = { width: OG_IMAGE.width, height: OG_IMAGE.height };
export const contentType = "image/png";
export const alt = OG_IMAGE.alt;

// From tokens.css, dark theme: --bg-0, --bg-1, --text-0, --text-1, --accent,
// --border-0. Kept as literals because Satori cannot read CSS variables.
const BG_0 = "#131211";
const BG_1 = "#1b1917";
const TEXT_0 = "#eceae6";
const TEXT_1 = "#a29c93";
const ACCENT = "#7ba05b";
const BORDER_0 = "#332f2b";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG_0,
          padding: 72,
          // Satori has no default font stack of its own; naming a common family
          // keeps the metrics predictable if the fetch of a custom face fails.
          fontFamily: "sans-serif",
        }}
      >
        {/* Wordmark row. The mark is `app/icon.svg` redrawn inline — the ket
            with the Leo sickle asterism inside it and Regulus as the state dot.
            Inline rather than <img src="/icon.svg"> because Satori would have to
            fetch that over the network at build time, and inline rather than
            the text "|psi>" because the first attempt did exactly that and the
            U+27E9 right angle bracket rendered as a tofu box: Satori ships no
            font covering it, and there is no fallback chain to rescue it.
            Coordinates are the icon's 32x32 viewBox scaled by the width below. */}
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <svg width="72" height="72" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill={BG_1} stroke={BORDER_0} strokeWidth="0.5" />
            <g
              stroke={ACCENT}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            >
              <path d="M9.5 8.4v15.2" />
              <path d="m18.4 8.4 4.8 7.6-4.8 7.6" />
            </g>
            <path
              d="M13.9 16l-1.3-3.4 1.1-2.9 2.6-.8"
              stroke={ACCENT}
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity="0.75"
            />
            <circle cx="12.6" cy="12.6" r="1" fill={ACCENT} />
            <circle cx="13.7" cy="9.7" r="1" fill={ACCENT} />
            <circle cx="16.3" cy="8.9" r="1" fill={ACCENT} />
            <circle cx="13.9" cy="16" r="1.9" fill={ACCENT} />
          </svg>
          <div style={{ display: "flex", color: TEXT_0, fontSize: 40, fontWeight: 600 }}>
            {SITE_NAME}
          </div>
        </div>

        {/* The claim. Deliberately the product sentence rather than the tagline:
            an unfurled card is usually the first thing a reader sees of this
            site, and "what it does" travels better out of context than a
            positioning line does. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              color: TEXT_0,
              fontSize: 76,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              maxWidth: 940,
            }}
          >
            Generate, run, and reuse quantum circuits.
          </div>
          <div style={{ display: "flex", color: TEXT_1, fontSize: 32, maxWidth: 900 }}>
            An AI workspace and a public atlas of quantum algorithms — what each takes,
            returns, costs, and who proved it.
          </div>
        </div>

        {/* Footer rule + domain, so a cropped card still carries the origin. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${BORDER_0}`,
            paddingTop: 28,
          }}
        >
          <div style={{ display: "flex", color: TEXT_1, fontSize: 26 }}>leonaqt.com</div>
          <div style={{ display: "flex", color: ACCENT, fontSize: 26, letterSpacing: "0.08em" }}>
            GENERATE · VERIFY · USE
          </div>
        </div>
      </div>
    ),
    size,
  );
}
