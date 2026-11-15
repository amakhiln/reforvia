/** Reforvia mark: an "R" drawn as a gauge — stem, bowl and a leg that ends in a waypoint dot (the "via"). */
export function LogoMark({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" className="fill-accent" />
      <g className="stroke-accent-ink" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 47V17h12.5a9.5 9.5 0 0 1 0 19H23" />
        <path d="M35 36l8 11" />
      </g>
      <circle cx="46.5" cy="49.5" r="3" className="fill-accent-ink" />
    </svg>
  );
}
