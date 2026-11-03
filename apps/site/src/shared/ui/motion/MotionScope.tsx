'use client';

/*
 * The animation features of the site (ADR-0024 budget): the primitives of this folder render `m.*`, which carry no
 * features of their own; this scope loads `domAnimation` (animations, variants, whileInView, hover and tap) once for the
 * page. `strict` makes a stray `motion.*` inside it throw, so the full bundle cannot slip back in.
 *
 * Only a page that animates renders it (the home page). Never in the layout, header or footer: pages without their own
 * animation load no motion code at all. A primitive outside the scope would stay at its hidden start, so every page
 * that uses one wraps its content in MotionScope.
 *
 * Once mounted it marks <html data-motion-ready>: until then the CSS fallback of site-theme.css shows the revealed items
 * after a while, so a slow hydration never leaves them blank; from then on motion reveals them itself. The mark goes
 * away with the page (client navigation to a page without the scope).
 */
import { domAnimation, LazyMotion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

export function MotionScope({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motionReady = '';
    return () => {
      delete root.dataset.motionReady;
    };
  }, []);

  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
