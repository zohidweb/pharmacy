/*
 * Timing of the steps' line (spec 2026-11-04-public-site-home-polish, H3), shared by the server markup (Steps) and the
 * client part that runs the fill (StepsProgress).
 */

/** Time the line takes to fill, s. */
export const STEPS_FILL_DURATION = 1.2;

/** Delay of the colour change of a step, s: the steps are reached one after another along the line. */
export function stepDelay(index: number, count: number): string {
  return `${((index * STEPS_FILL_DURATION) / count).toFixed(2)}s`;
}
