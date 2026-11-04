'use client';

import { m, useScroll, useTransform } from 'motion/react';
import type { ReactNode } from 'react';
import { useScrollMode } from './useScrollMode';

/** Scroll distance over which the element settles, px: about the half of the first screen's panel leaving upwards. */
const DISTANCE = 480;

export interface ScrollZoomProps {
  children: ReactNode;
  className?: string;
}

/**
 * Rises and grows while the page scrolls away from its top (spec 2026-11-04-public-site-home-polish, H8.1): from `scale`
 * 0.92 and 48 px lower at the top of the page to `scale` 1 in place after 480 px of scroll, as the first screen's panel
 * leaves upwards. `transform` only (`useScroll` + `useTransform`, no React render per frame); no opacity, so the element
 * is fully visible from the first paint and the largest paint of the page is not delayed. Only from 1024 px: it stands in
 * its end position below that, with `reduce`, on the server and in the hydration render. The scale grows from the
 * element's lower left corner, so the shot keeps its left edge on the column and its lower edge on the panel's.
 */
export function ScrollZoom({ children, className }: ScrollZoomProps) {
  const mode = useScrollMode();
  const { scrollY } = useScroll();
  const scale = useTransform(scrollY, [0, DISTANCE], [0.92, 1]);
  const y = useTransform(scrollY, [0, DISTANCE], [48, 0]);
  const moves = mode === 'wide';
  return (
    <m.div
      className={className}
      style={{
        scale: moves ? scale : 1,
        y: moves ? y : 0,
        originX: 0,
        originY: 1,
      }}
    >
      {children}
    </m.div>
  );
}
