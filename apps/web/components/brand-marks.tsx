import type { SVGProps } from "react";

/**
 * Refined "1a (Ket Regulus)" logo variants for Leona Quantum. Each keeps the
 * Dirac-ket bones (a bar and a closing bracket) but trades the constellation
 * sickle for a lioness cue. Drawn in currentColor with a moss `--accent`
 * highlight so they ride whatever surface color they sit on — no per-theme
 * variant. Pick one to become the product BrandMark (replace it in icons.tsx)
 * and re-cut app/icon.svg to match.
 */
type MarkProps = SVGProps<SVGSVGElement> & { size?: number };

function Frame({ size = 20, children, ...props }: MarkProps & { children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 80 80" fill="none" style={{ overflow: "visible" }} {...props}>
      {children}
    </svg>
  );
}

/** Fang Ket — the closing bracket hooks into a canine fang; Regulus is an eye. */
export function FangKet(props: MarkProps) {
  return (
    <Frame {...props}>
      <path d="M20 15 V65" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M48 15 L67 37 Q71 41 67 46 L61 54" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M48 65 L61 54" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="31" cy="33" r="3.2" fill="var(--accent)" />
      <path d="M27 42 q4 3 8 0" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5" />
    </Frame>
  );
}

/** Claw Bracket — the ket angle becomes a three-stroke claw swipe. */
export function ClawBracket(props: MarkProps) {
  return (
    <Frame {...props}>
      <path d="M20 15 V65" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M46 15 Q66 26 61 44" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <path d="M50 22 Q70 34 65 54" stroke="var(--accent)" strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <path d="M46 38 Q64 50 59 67" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <circle cx="30" cy="33" r="3.2" fill="var(--accent)" />
    </Frame>
  );
}

/** Mane — Regulus radiates a mane; the lioness implied by light. Best at 16px. */
export function Mane(props: MarkProps) {
  return (
    <Frame {...props}>
      <path d="M18 15 V65" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M48 15 L64 40 L48 65" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <g stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7">
        <path d="M33 26 V20" /><path d="M41 29 L45 24" /><path d="M44 40 H51" /><path d="M41 51 L45 56" />
        <path d="M33 54 V60" /><path d="M25 51 L21 56" /><path d="M22 40 H15" /><path d="M25 29 L21 24" />
      </g>
      <circle cx="33" cy="40" r="3.6" fill="var(--accent)" />
    </Frame>
  );
}
