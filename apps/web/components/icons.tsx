import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 4 4 4-4 4" /></Icon>;
}

/**
 * Back, as an arrow and not a chevron.
 *
 * `ChevronIcon` above is the disclosure mark — it points at something that will
 * expand where it is. This one leaves the page, and the shaft is what says so:
 * on the map's overlay it is one of three controls with no label beside it, so
 * the glyph has to carry the whole distinction between "open this" and "go
 * back" — and, since ai-ops#22, between both of those and "open everything"
 * (`ExpandAllIcon` below, which is why that one is drawn on the diagonal).
 * Drawn to the same 16×16 box and the same 1.35 stroke as the rest, with the
 * head at x=6 so the arrow reads as centred despite being asymmetric.
 */
export function ArrowLeftIcon(props: IconProps) {
  return <Icon {...props}><path d="M13 8H3.5M7 4 3 8l4 4" /></Icon>;
}

/**
 * Information — a lower-case i in a ring.
 *
 * The dot is a filled `<circle>` rather than a zero-length stroked path with a
 * round cap: the path form renders as a dot in most engines and as nothing in
 * some, which is a mark that disappears on one reader's machine and nowhere
 * else. `MoreIcon` above sets the same precedent for small solid dots.
 */
export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.4v3.2" />
      <circle cx="8" cy="5.2" r="0.6" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/**
 * Open everything — two arrows pushing apart along the diagonal.
 *
 * Drawn on the **diagonal**, not as a vertical pair, and that is the whole
 * legibility argument at 16px beside `InfoIcon` on the map's overlay. A pair of
 * up/down chevrons is the disclosure mark this codebase already spends on one
 * row (`ChevronIcon`), and reusing that shape for "every row at once" makes the
 * two controls read as the same control. Arrows leaving a shared centre read as
 * a thing being pushed open instead.
 *
 * The corner tick and the shaft are one path per arrow so the head cannot drift
 * off its own line at a different stroke width, and both stop at 2.6/13.4 —
 * inside the 16 box by more than the 1.35 stroke's half-width, so nothing is
 * clipped when the glyph is scaled down.
 */
export function ExpandAllIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.4 2.6H2.6V6.4M2.6 2.6L6.4 6.4" />
      <path d="M9.6 13.4H13.4V9.6M13.4 13.4L9.6 9.6" />
    </Icon>
  );
}

/**
 * Close everything — the same two arrows, pulled back into the centre.
 *
 * Deliberately `ExpandAllIcon` reversed rather than a different metaphor: the
 * control is one control with two states (the map overlay's `InfoIcon` sets
 * that precedent), and a reader who has learned the open glyph should not have
 * to learn a second one to undo it. The heads sit at 6.4/9.6 — where the other
 * glyph's tails start — so the two swap in place without the mark appearing to
 * move.
 */
export function CollapseAllIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.6 6.4H6.4V2.6M6.4 6.4L2.6 2.6" />
      <path d="M13.4 9.6H9.6V13.4M9.6 9.6L13.4 13.4" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 4.5h10M3 8h10M3 11.5h10" /></Icon>;
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M8 3v10M3 8h10" /></Icon>;
}

export function PlayIcon(props: IconProps) {
  return <Icon {...props}><path d="m5.5 3.75 6 4.25-6 4.25z" /></Icon>;
}

export function LibraryIcon(props: IconProps) {
  return <Icon {...props}><path d="M3.5 3.5h9v9h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h3" /></Icon>;
}

/**
 * `open` tilts the front face forward, the way a folder pulled open looks.
 *
 * The sidebar uses this INSTEAD of a separate disclosure chevron: in a rail this
 * narrow, an arrow and an icon side by side spend two columns saying one thing.
 */
export function FolderIcon({ open = false, ...props }: IconProps & { open?: boolean }) {
  if (!open) {
    return <Icon {...props}><path d="M2.5 4.5h4l1.5 1.7h5.5v5.3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /><path d="M2.5 6.2h11" /></Icon>;
  }
  return <Icon {...props}><path d="M2.5 4.5h4l1.5 1.7h4.5v1.5" /><path d="M2.5 4.5v7a1 1 0 0 0 1 1h9l1.6-5.3H4.1z" /></Icon>;
}

export function ArchiveIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 4.5h10v8H3zM2.5 3h11v2h-11zM6 8h4" /></Icon>;
}

export function TrashIcon(props: IconProps) {
  return <Icon {...props}><path d="M3.5 5.5h9M6 3.5h4M5 5.5v7h6v-7M7 7.5v3M9 7.5v3" /></Icon>;
}

export function StudioIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 4.5h10v7H3zM5 2.5h6M6 14h4M8 11.5V14" /><path d="m6 7 1.2 1.2L10 5.5" /></Icon>;
}

export function SettingsIcon(props: IconProps) {
  return <Icon {...props}><path d="M6.3 2.9h3.4l.45 1.35 1.2.7 1.4-.2 1.7 2.95-.95 1.05v1.4l.95 1.05-1.7 2.95-1.4-.2-1.2.7-.45 1.35H6.3l-.45-1.35-1.2-.7-1.4.2-1.7-2.95.95-1.05V8.8l-.95-1.05 1.7-2.95 1.4.2 1.2-.7z" /><circle cx="8" cy="8" r="1.8" /></Icon>;
}

export function SearchIcon(props: IconProps) {
  return <Icon {...props}><circle cx="7" cy="7" r="3.5" /><path d="m9.7 9.7 3 3" /></Icon>;
}

export function MoreIcon(props: IconProps) {
  return <Icon {...props}><circle cx="4" cy="8" r=".6" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r=".6" fill="currentColor" stroke="none" /><circle cx="12" cy="8" r=".6" fill="currentColor" stroke="none" /></Icon>;
}

export function PanelRightIcon({ open = true, ...props }: IconProps & { open?: boolean }) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
      <path d="M10 3.5v9" />
      {open ? <path d="M10.75 6.5h1.5M10.75 8.5h1.5" strokeWidth="1" /> : null}
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return <Icon {...props}><rect x="5" y="5" width="7" height="8" rx="1" /><path d="M10 5V3H4a1 1 0 0 0-1 1v7h2" /></Icon>;
}

export function CheckIcon(props: IconProps) {
  return <Icon {...props}><path d="m3.5 8 3 3 6-6" /></Icon>;
}

export function PaperclipIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 8.5 3.4-3.4a2.1 2.1 0 0 1 3 3L7.5 13A3.2 3.2 0 0 1 3 8.5l4.9-4.9" /></Icon>;
}

export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return <Icon {...props} fill={filled ? "currentColor" : "none"}><path d="m8 2.25 1.78 3.61 3.97.58-2.87 2.8.68 3.96L8 11.33l-3.56 1.87.68-3.96-2.87-2.8 3.97-.58z" /></Icon>;
}

/* Brand mark: Dirac ket notation — |ψ⟩ — reduced to a bar, a chevron, and the
 * state between them. The state is the Leo "sickle" asterism (the lion's-head
 * star pattern; Leona = lioness), with Regulus as the bright state-dot and the
 * mane arcing above it — the lioness rendered as a quantum state. Survives 16px
 * because the sickle degrades to the original dot plus a faint plume. Drawn in
 * currentColor so it rides whatever text color the surface gives it — no
 * per-theme variant needed. */
export function BrandMark({ size = 20, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20" fill="none" {...props}>
      <path d="M4.6 3.8v12.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="m11.9 3.8 3.9 6.2-3.9 6.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.3 10 7.5 7.9l.7-1.8 1.6-.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
      <circle cx="7.5" cy="7.9" r="0.65" fill="currentColor" />
      <circle cx="8.2" cy="6.1" r="0.65" fill="currentColor" />
      <circle cx="9.8" cy="5.6" r="0.65" fill="currentColor" />
      <circle cx="8.3" cy="10" r="1.5" fill="currentColor" />
    </svg>
  );
}
