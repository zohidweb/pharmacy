'use client';

import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'motion/react';
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
  className?: string;
}

/**
 * Moves its content with the scroll at its own speed (`useScroll` + `useTransform`, no scroll listener and no React
 * render per frame). Still on screens narrower than 1024 px and with `reduce`.
 */
export function Parallax({ children, speed, className }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;
  const wide = useSyncExternalStore(subscribeWide, isWide, isWideOnServer);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const y = useTransform(scrollYProgress, [0, 1], [-speed * 100, speed * 100]);
  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ y: wide && !reduce ? y : 0 }}
    >
      {children}
    </motion.div>
  );
}
