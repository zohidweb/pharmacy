/**
 * Press feedback of a link that looks like a button, without `motion` (spec 4.7, controller ruling on Task 3): it
 * gives a little while pressed. Transform only (`scale`), none with `prefers-reduced-motion: reduce`. For links on
 * every page (header) and on screens without their own animation (404, error), which must not load the motion chunk.
 *
 * The press eases in and out by `transition`: in Tailwind v4 its list is the kit button's colours plus transform and
 * `scale`. Not `transition-transform`: it comes after the kit's `transition-colors` in the CSS and would drop the colour
 * fade of the button's hover. With reduce there is no transition at all.
 */
export const pressClassName =
  'motion-safe:transition motion-reduce:transition-none motion-safe:active:scale-98';
