'use client';

import { m, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { REVEAL_VIEWPORT, revealVariants } from './transitions';

const elements = {
  div: m.div,
  li: m.li,
} as const;

export type RevealElement = keyof typeof elements;

export interface RevealProps {
  children: ReactNode;
  as?: RevealElement;
  className?: string;
}

/**
 * Lifts and fades its content in once, when it enters the viewport (spec 4.7). The hidden start is rendered on the
 * server; `data-reveal` lets CSS show it without JavaScript (R2) and with `reduce` (site-theme.css).
 */
export function Reveal({ children, as = 'div', className }: RevealProps) {
  const reduce = useReducedMotion() ?? false;
  const Element = elements[as];
  return (
    <Element
      data-reveal=""
      className={className}
      variants={revealVariants(reduce)}
      initial="hidden"
      whileInView="visible"
      viewport={REVEAL_VIEWPORT}
    >
      {children}
    </Element>
  );
}
