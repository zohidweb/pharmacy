/*
 * The state screens of the site — error, 404, the last-resort error page (spec 4.6): a narrow centred column in the
 * middle of the free height, with a large mint number above the text.
 */

/** The body: a narrow column centred in the height left between the header and the footer. */
export const stateScreenClassName =
  'mx-auto flex w-full max-w-(--ph-size-dialog-md) flex-1 flex-col items-center justify-center gap-6 px-4 py-16 ' +
  'text-center';

/** The large number (404, 500): the display size, the accent colour; decorative, the heading says the same. */
export const stateScreenCodeClassName = 'text-display text-accent-site';

/** The heading under the number. */
export const stateScreenTitleClassName =
  'text-2xl font-bold tracking-tight text-fg';

/** The explanation: the lead size, secondary text. */
export const stateScreenTextClassName = 'text-lead text-fg-muted';

/** The buttons: in a row, wrapping to a column on a narrow screen. */
export const stateScreenActionsClassName =
  'flex flex-wrap items-center justify-center gap-3';
