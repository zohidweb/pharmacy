'use client';

/*
 * The progress of «Как подключиться» (spec 2026-11-04-public-site-home-polish, H3 and the scroll amendment H8.3).
 * Nothing is pinned: the section is a plain block, the steps stand in a row from 1024 px under one horizontal line and
 * in a column with a vertical line below. The line follows the scroll again: it fills from the list entering the window
 * (the list's top at 85 % of the window height) to the list's top at 35 % (`useScroll` of the list → `scaleX` /
 * `scaleY`, `transform` only), and scrolling back empties it. A step is marked `data-reached` when the line reaches its
 * marker: thresholds, a share of the visible line's length, are measured from the markers (as before H3) and written
 * straight on the steps only when the reached step changes, so no React render and no scroll listener run per frame; CSS
 * colours the steps by the attribute (Steps). Which step is current is not singled out.
 *
 * On the server, in the hydration render and with reduce, nothing waits for the scroll: the line is full (`useScrollMode`
 * is `off`: inline `scale(1)`) and the steps take the colour of the reached ones from CSS (`data-step-marker`,
 * `data-step-figure` in site-theme.css: reduce and no JavaScript). The same rule reaches every step of a page that has
 * not hydrated yet.
 */
import { m, useMotionValueEvent, useScroll } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useScrollMode } from '@/shared/ui/motion';

export interface StepsProgressProps {
  /** The heading of the section. */
  header: ReactNode;
  /** The ordered list of steps: each step has `data-step`, its marker `data-step-marker`. */
  children: ReactNode;
}

export function StepsProgress({ header, children }: StepsProgressProps) {
  const list = useRef<HTMLDivElement>(null);
  const across = useRef<HTMLDivElement>(null);
  const down = useRef<HTMLDivElement>(null);
  // where each marker sits along the visible line, as a share of its length; the step reached last
  const thresholds = useRef<number[]>([]);
  const reached = useRef<number>(undefined);

  const mode = useScrollMode();
  const follows = mode !== 'off';
  const { scrollYProgress } = useScroll({
    target: list,
    offset: ['start 0.85', 'start 0.35'],
  });

  /**
   * Writes `data-reached` of the steps for a progress value, only when the reached step changes. At progress 0 the line
   * has not started yet: no step is lit, though the first marker sits at 0.
   */
  const mark = (value: number) => {
    if (!follows) return;
    const last =
      value <= 0
        ? -1
        : thresholds.current.findLastIndex((at) => value >= at - 0.01);
    if (last === reached.current) return;
    reached.current = last;
    list.current?.querySelectorAll('[data-step]').forEach((step, index) => {
      step.toggleAttribute('data-reached', index <= last);
    });
  };

  useEffect(() => {
    const root = list.current;
    if (!root || !follows) return;
    const measure = () => {
      // one line is shown at a time; its track, not its fill: the fill is scaled, its box is not the line's
      const wide = Boolean(across.current?.offsetWidth);
      const line = (wide ? across : down).current;
      if (!line) return;
      const box = line.getBoundingClientRect();
      thresholds.current = Array.from(
        root.querySelectorAll('[data-step-marker]'),
        (marker) => {
          const at = marker.getBoundingClientRect();
          return wide
            ? (at.x + at.width / 2 - box.x) / box.width
            : (at.y + at.height / 2 - box.y) / box.height;
        },
      );
      reached.current = undefined;
      mark(scrollYProgress.get());
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
    // `mark` reads refs and `follows` only: the effect runs again when `follows` changes
  }, [follows, scrollYProgress]);

  useMotionValueEvent(scrollYProgress, 'change', mark);

  const fill = follows ? scrollYProgress : 1;
  return (
    <div className="flex flex-col gap-12">
      {header}
      <div ref={list} className="relative">
        {/* from 1024 px: from the centre of the first marker to the centre of the last (the grid of the steps) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-2 hidden grid-cols-5 gap-6 md:grid"
        >
          <div
            ref={across}
            className="col-span-4 -mr-8 ml-2 h-0.5 -translate-y-1/2 bg-site-line"
          >
            <m.div
              className="size-full origin-left bg-accent-site"
              style={{ scaleX: fill }}
            />
          </div>
        </div>
        {/* below 1024 px: from the first marker (it starts under it, hidden by its fill) to the end of the list */}
        <div
          ref={down}
          aria-hidden="true"
          className="pointer-events-none absolute top-6 bottom-0 left-2 w-0.5 -translate-x-1/2 bg-site-line md:hidden"
        >
          <m.div
            className="size-full origin-top bg-accent-site"
            style={{ scaleY: fill }}
          />
        </div>
        {children}
      </div>
    </div>
  );
}
