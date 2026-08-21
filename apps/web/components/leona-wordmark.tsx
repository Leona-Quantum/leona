type LeonaWordmarkProps = {
  className?: string;
};

/**
 * The canonical Leona Quantum wordmark supplied by the owner.
 *
 * The PNG is used as an alpha mask so the exact artwork can follow the active
 * light or dark theme without maintaining a second raster export. Transparent
 * padding is clipped in CSS, keeping every placement aligned to the letters.
 */
export function LeonaWordmark({ className = "" }: LeonaWordmarkProps) {
  return (
    <span
      aria-hidden="true"
      className={["lq-wordmark", className].filter(Boolean).join(" ")}
    />
  );
}
