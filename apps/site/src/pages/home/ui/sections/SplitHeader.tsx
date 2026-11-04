/*
 * The header of a home section laid out as one row (spec 2026-11-04-public-site-home-polish, H9.1, H9.4): from 1024 px
 * the heading stands on the left and the lead on the right, both on the bottom line of the row, so no column under the
 * heading stays empty; below that they stack. The text colours come from the surface the section sits on (the page or
 * a dark panel).
 */
export function SplitHeader({
  id,
  title,
  subtitle,
}: {
  /** The id of the heading (the section's `aria-labelledby`). */
  id: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-16">
      <h2
        id={id}
        className="max-w-(--ph-size-dialog-lg) text-section text-balance"
      >
        {title}
      </h2>
      <p className="max-w-(--ph-size-dialog-md) text-lead text-fg-muted">
        {subtitle}
      </p>
    </header>
  );
}
