/**
 * The product's mark: a day ring that is mostly full, with its end marked by a
 * dot. Drawn in the accent colour, so it follows the theme.
 */
export function BrandMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none">
      <circle cx="12" cy="12" r="9" stroke="var(--grid)" strokeWidth="3" />
      <path d="M12 3a9 9 0 1 1-8.2 5.3" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.2" fill="var(--accent)" />
    </svg>
  );
}
