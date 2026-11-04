'use client';

import { m, useScroll, useTransform } from 'motion/react';
import { useRef, type ReactNode } from 'react';
import { useScrollMode } from './useScrollMode';

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
 * Moves its content with the scroll at its own speed (`useScroll` + `useTransform`, no scroll listener and no React render
 * per frame). Only on wide screens (spec 4.5, 4.7: it costs too much on a phone); still below 1024 px and with `reduce`.
 * The hooks run for every Parallax (hooks are not conditional); the value is simply not applied when the element stands
 * still.
 */
export function Parallax({ children, speed, className }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mode = useScrollMode();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const y = useTransform(scrollYProgress, [0, 1], [-speed * 100, speed * 100]);
  return (
    <m.div
      ref={ref}
      className={className}
      style={{ y: mode === 'wide' ? y : 0 }}
    >
      {children}
    </m.div>
  );
}
