'use client';

import { m, stagger, useReducedMotion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { REVEAL_VIEWPORT, revealVariants, STAGGER } from './transitions';

const groups = {
  div: m.div,
  ul: m.ul,
} as const;

const items = {
  div: m.div,
  li: m.li,
} as const;

export type RevealGroupElement = keyof typeof groups;
export type RevealItemElement = keyof typeof items;

export interface RevealGroupProps {
  children: ReactNode;
  as?: RevealGroupElement;
  /**
   * Share of the group that must be in view before it plays (0.15 by default). A group much taller than the screen
   * (the tiles of «Возможности») takes `0`: it plays as soon as its top edge enters, so no blank space waits on screen.
   */
  amount?: number;
  className?: string;
  /** A list that scrolls sideways (a row of cards on a phone) takes keyboard focus and the name of its section. */
  tabIndex?: number;
  'aria-labelledby'?: string;
}

export interface RevealItemProps {
  children: ReactNode;
  as?: RevealItemElement;
  className?: string;
}

/**
 * A group whose `RevealItem` children appear one after another, 0.06 s apart (spec 4.7), when the group enters the
 * viewport. The group itself does not move.
 */
export function RevealGroup({
  children,
  as = 'div',
  amount,
  className,
  tabIndex,
  'aria-labelledby': labelledBy,
}: RevealGroupProps) {
  const reduce = useReducedMotion() ?? false;
  const Element = groups[as];
  const viewport =
    amount === undefined ? REVEAL_VIEWPORT : { ...REVEAL_VIEWPORT, amount };
  const variants: Variants = {
    hidden: {},
    visible: { transition: { delayChildren: reduce ? 0 : stagger(STAGGER) } },
  };
  return (
    <Element
      className={className}
      tabIndex={tabIndex}
      aria-labelledby={labelledBy}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
    >
      {children}
    </Element>
  );
}

/**
 * An item of `RevealGroup`; it must be a descendant of one. It takes the group's state and its place in the stagger, so
 * it has no viewport of its own: outside a group it stays hidden (but with reduce or without JavaScript).
 */
export function RevealItem({
  children,
  as = 'div',
  className,
}: RevealItemProps) {
  const reduce = useReducedMotion() ?? false;
  const Element = items[as];
  return (
    <Element
      data-reveal=""
      className={className}
      variants={revealVariants(reduce)}
    >
      {children}
    </Element>
  );
}
