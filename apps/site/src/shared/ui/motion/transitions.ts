/*
 * Motion values of the site (spec 4.7, ADR-0024). Only `transform` and `opacity` move; with `reduce` nothing does.
 */
import type { Transition, Variants } from 'motion/react';

/** The spring of the site: entrances, hover and press. */
export const SPRING: Transition = {
  type: 'spring',
  stiffness: 100,
  damping: 20,
};

/** No movement: the end state at once. */
export const INSTANT: Transition = { duration: 0 };

/** Delay between the items of a group, s. */
export const STAGGER = 0.06;

/** Lift of an element that appears, px. */
export const REVEAL_OFFSET = 24;

/** An element appears once, when a part of it enters the viewport. */
export const REVEAL_VIEWPORT = { once: true, amount: 0.15 } as const;

/** Opacity has no spring: a short ease-out makes the text readable sooner than the spring settles. */
const FADE: Transition = { duration: 0.4, ease: 'easeOut' };

/**
 * Hidden start and visible end of an element that appears. `delay` goes into the transitions only when it is given:
 * an item of RevealGroup gets its stagger from the group as the inherited delay, and an own `delay: 0` would replace it.
 */
export function revealVariants(reduce: boolean, delay?: number): Variants {
  const own = delay ? { delay } : {};
  return {
    hidden: { opacity: 0, y: REVEAL_OFFSET },
    visible: {
      opacity: 1,
      y: 0,
      transition: reduce
        ? INSTANT
        : { y: { ...SPRING, ...own }, opacity: { ...FADE, ...own } },
    },
  };
}
