'use client';

import { m, useScroll, useTransform } from 'motion/react';
import { useRef, type ReactNode } from 'react';
import { useScrollMode } from './useScrollMode';

/** How far the element is from its place at the start, px. */
const SLIDE = 64;
/** The start lift below 1024 px, px. */
const LIFT = 32;
/** The start turn from 1024 px, degrees. */
const TURN = 3;
/** The opacity at the start; the element is never hidden. */
const FROM_OPACITY = 0.4;

export interface ScrollSlideProps {
  children: ReactNode;
  /** The column the element slides in from, and the way it leans (toward the centre of the grid). */
  side: 'left' | 'right';
  className?: string;
}

/**
 * A list item that comes into place while it enters the window (spec 2026-11-04-public-site-home-polish, H8.2): from
 * 1024 px it slides in from its own side by 64 px, turned 3° toward the centre, at `opacity` 0.4; below 1024 px it rises
 * from 32 px at `opacity` 0.4, with no slide and no turn. It reaches its place when its top edge is at 60 % of the window
 * height (progress is `useScroll` of the item itself, from its top at the window's bottom edge). `transform` and
 * `opacity` only, no React render per frame. With `reduce`, on the server and in the hydration render it stands in
 * place and fully opaque, so nothing is hidden without JavaScript. The sideways start leaves the page's width alone only
 * if an ancestor clips it (`overflow-x-clip`, Audience).
 */
export function ScrollSlide({ children, side, className }: ScrollSlideProps) {
  const ref = useRef<HTMLLIElement>(null);
  const mode = useScrollMode();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'start 0.6'],
  });
  const sign = side === 'left' ? -1 : 1;
  const x = useTransform(scrollYProgress, [0, 1], [sign * SLIDE, 0]);
  const rotate = useTransform(scrollYProgress, [0, 1], [-sign * TURN, 0]);
  const y = useTransform(scrollYProgress, [0, 1], [LIFT, 0]);
  const opacity = useTransform(scrollYProgress, [0, 1], [FROM_OPACITY, 1]);
  return (
    <m.li
      ref={ref}
      className={className}
      style={
        mode === 'wide'
          ? { x, rotate, y: 0, opacity }
          : mode === 'compact'
            ? { x: 0, rotate: 0, y, opacity }
            : { x: 0, rotate: 0, y: 0, opacity: 1 }
      }
    >
      {children}
    </m.li>
  );
}
