'use client';

import { m, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useRef, useSyncExternalStore, type ReactNode } from 'react';

/** Parallax only on wide screens (spec 4.5, 4.7): it costs too much on a phone. */
const WIDE_SCREEN = '(min-width: 1024px)';

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_SCREEN);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const isWide = () => window.matchMedia(WIDE_SCREEN).matches;
// the server and the hydration render have no parallax, so the markup matches
const isWideOnServer = () => false;

export interface ParallaxProps {
  children: ReactNode;
  /**
   * Share of 100 px the element moves each way while it crosses the viewport: `0.2` → from −20 px to 20 px.
   * A negative speed moves it against the scroll.
   */
  speed: number;
  /**
   * Tilt in degrees at the start of the pass (amendment 4.4, п. 2; L7): the element straightens as the page scrolls,
   * to 0 once its centre reaches the top of the viewport. Same rule as the shift: from 1024 px, never with `reduce`.
   */
  tilt?: number;
  className?: string;
}

/**
 * Moves its content with the scroll at its own speed and, with `tilt`, straightens it (`useScroll` + `useTransform`, no
 * scroll listener and no React render per frame). Still and straight on screens narrower than 1024 px and with `reduce`.
 */
export function Parallax({ children, speed, tilt, className }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;
  const wide = useSyncExternalStore(subscribeWide, isWide, isWideOnServer);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const y = useTransform(scrollYProgress, [0, 1], [-speed * 100, speed * 100]);
  // the tilt has its own pass: from the element's top at the top of the viewport to its centre there
  const { scrollYProgress: straighten } = useScroll({
    target: ref,
    offset: ['start start', 'center start'],
  });
  const rotate = useTransform(straighten, [0, 1], [tilt ?? 0, 0]);
  const moves = wide && !reduce;
  return (
    <m.div
      ref={ref}
      className={className}
      style={{ y: moves ? y : 0, rotate: moves && tilt ? rotate : 0 }}
    >
      {children}
    </m.div>
  );
}
