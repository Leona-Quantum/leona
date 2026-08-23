import type { ReactNode } from "react";
import { JetBrains_Mono, Space_Grotesk, Zen_Kaku_Gothic_New } from "next/font/google";
import { RootDocument, rootMetadata } from "../../components/root-document";
import "./lab.css";

/* Exploration route. Its own type stack, deliberately not the shipped
 * Instrument Sans / Instrument Serif pairing: Space Grotesk carries the
 * technical-instrument character the direction is built on, and the display
 * weight is a sans, so no borrowed-serif "premium" tell. */
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-lab-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-lab-mono" });
/* Space Grotesk has no Japanese coverage at all, so Japanese was falling back
 * to whatever the OS picked (Hiragino on macOS, Yu Gothic on Windows) and the
 * page rendered in a different voice per machine. Zen Kaku Gothic New is a
 * modern gothic whose even, geometric construction sits with Space Grotesk
 * instead of fighting it. Latin still resolves to Space Grotesk because it
 * comes first in the stack; this face only picks up the Japanese glyphs. */
/* Only the weights lab.css actually sets, and only weights this face actually
 * has. next/font self-hosts every requested weight at build time — Google
 * serves 121 unicode-range chunks per weight for this family — and `subsets`
 * only decides which get preloaded, so an unused weight is build output nobody
 * renders. lab.css sets 500 nine times and 600 once; Zen Kaku Gothic New ships
 * 300/400/500/700 and 900 and has no 600, so the brand row's 600 resolves to
 * the 500 face for Japanese either way. Requesting 700 for it would have been a
 * different weight than the Latin brand row renders at. */
const zenKaku = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-lab-jp",
});

// A ROOT layout since `app/layout.tsx` was removed (ai-ops issue 151) — it is
// the top-most layout on this segment, so it owns the document. The lab keeps
// its own type stack inside that document rather than replacing it: `RootDocument`
// still supplies the head, the bootstrap scripts and the shipped font variables,
// and the three faces below override them on `.lab-root` only.
export const metadata = rootMetadata;

export default function LabLayout({ children }: { children: ReactNode }) {
  return (
    <RootDocument lang="en">
    <div
      data-surface="lab"
      className={`lab-root ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${zenKaku.variable}`}
    >
      {children}
    </div>
    </RootDocument>
  );
}
