import type { ReactNode } from "react";
import { JetBrains_Mono, Space_Grotesk, Zen_Kaku_Gothic_New } from "next/font/google";
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
const zenKaku = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-lab-jp",
});

export default function LabLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-surface="lab"
      className={`lab-root ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${zenKaku.variable}`}
    >
      {children}
    </div>
  );
}
