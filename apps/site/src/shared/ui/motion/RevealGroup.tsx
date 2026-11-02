'use client';

import { m, stagger, useReducedMotion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { REVEAL_VIEWPORT, revealVariants, STAGGER } from './transitions';

const groups = {
  div: m.div,
  section: m.section,
  ul: m.ul,
  ol: m.ol,
} as const;

const items = {
  div: m.div,
  li: m.li,
  article: m.article,
} as const;

export type RevealGroupElement = keyof typeof groups;
export type RevealItemElement = keyof typeof items;

export interface RevealGroupProps {
  children: ReactNode;
  as?: RevealGroupElement;
  className?: string;
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
  className,
}: RevealGroupProps) {
  const reduce = useReducedMotion() ?? false;
  const Element = groups[as];
  const variants: Variants = {
    hidden: {},
    visible: { transition: { delayChildren: reduce ? 0 : stagger(STAGGER) } },
  };
  return (
    <Element
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={REVEAL_VIEWPORT}
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
