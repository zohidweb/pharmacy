/**
 * Press feedback of a link that looks like a button, without `motion` (spec 4.7, controller ruling on Task 3): it
 * gives a little while pressed. Transform only (`scale`), none with `prefers-reduced-motion: reduce`. For links on
 * every page (header) and on screens without their own animation (404, error), which must not load the motion chunk.
 */
export const pressClassName = 'motion-safe:active:scale-98';
