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

export function CopyIcon(props: IconProps) {
  return <Icon {...props}><rect x="5" y="5" width="7" height="8" rx="1" /><path d="M10 5V3H4a1 1 0 0 0-1 1v7h2" /></Icon>;
}

export function CheckIcon(props: IconProps) {
  return <Icon {...props}><path d="m3.5 8 3 3 6-6" /></Icon>;
}

export function PaperclipIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 8.5 3.4-3.4a2.1 2.1 0 0 1 3 3L7.5 13A3.2 3.2 0 0 1 3 8.5l4.9-4.9" /></Icon>;
}

export function BrandMark({ size = 20, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20" fill="none" {...props}>
      <path d="m10 1.8 6.7 3.85v8.5L10 18l-6.7-3.85v-8.5z" stroke="currentColor" strokeWidth="1.2" />
      <path d="m10 5.1 3.8 2.2v5.4L10 14.9l-3.8-2.2V7.3zM6.2 7.3 10 9.5l3.8-2.2M10 9.5v5.4" stroke="currentColor" strokeWidth="1.05" />
    </svg>
  );
}
