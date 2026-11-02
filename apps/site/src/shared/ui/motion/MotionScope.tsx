'use client';

/*
 * The animation features of the site (ADR-0024 budget): the primitives of this folder render `m.*`, which carry no
 * features of their own; this scope loads `domAnimation` (animations, variants, whileInView, hover and tap) once for the
 * page. `strict` makes a stray `motion.*` inside it throw, so the full bundle cannot slip back in.
 *
 * Only a page that animates renders it (the home page). Never in the layout, header or footer: pages without their own
 * animation load no motion code at all. A primitive outside the scope would stay at its hidden start, so every page
 * that uses one wraps its content in MotionScope.
 */
import { domAnimation, LazyMotion } from 'motion/react';
import type { ReactNode } from 'react';

export function MotionScope({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
