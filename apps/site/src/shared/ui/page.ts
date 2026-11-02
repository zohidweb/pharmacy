/*
 * The pages other than home (spec 4.6): tariffs, blog, connect, an article and the documents. The width of the home
 * sections, a large heading that rises in by the CSS entrance (these pages load no `motion`) and a lead under it.
 */

/** The body of a page in the width of the home sections. */
export const pageClassName =
  'mx-auto flex w-full max-w-(--ph-size-dialog-xl) flex-col gap-12 px-4 py-16';

/** The heading block of a page. */
export const pageHeaderClassName =
  'flex max-w-(--ph-size-dialog-lg) flex-col gap-4';

/** The page heading: the first screen's size, rising in by CSS (nothing moves with reduce). */
export const pageTitleClassName =
  'site-enter text-display-sm text-balance md:text-display';

/** The lead under the heading: 18/28, secondary text, a step after the heading. */
export const pageLeadClassName =
  'site-enter site-enter-delay-1 max-w-(--ph-size-dialog-md) text-lead text-fg-muted';

/**
 * The reading column of an article and of the documents: 68 characters of the 18 px text (`ch` of its own size).
 * It sits inside a padded body, so the 16 px gutter of a phone stays outside the 68 characters.
 */
export const readingColumnClassName =
  'mx-auto flex w-full max-w-site-reading flex-col gap-8 text-lead';

/** The heading of an article or a document: a title of any length, a step smaller than a page heading. */
export const readingTitleClassName =
  'site-enter text-3xl font-bold tracking-tight text-balance wrap-break-word md:text-section';
