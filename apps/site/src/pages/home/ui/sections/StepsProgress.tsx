'use client';

/*
 * The progress of «Как подключиться» (spec 4.5, п. 6; R6). From 1024 px the section is pinned: a tall track
 * (`h-site-steps`) holds a sticky frame of one screen, and the horizontal line under the steps fills while the track
 * scrolls by (`useScroll` → `scaleX`). Below 1024 px nothing is pinned: the steps are a column with a vertical line that
 * fills along the list (`scaleY`). The step the line has reached last is the current one: thresholds of the progress,
 * measured from the markers on the visible line, write `data-reached` and `data-current` straight on the steps (no
 * React render per frame, no scroll listener), and CSS colours them by the attributes.
 *
 * With reduce: no pinning, the line is full and still, every step is reached and none is singled out. Without
 * JavaScript the sticky frame still works (CSS) and the fill shows full: it carries `data-reveal`, whose <noscript> and
 * reduce rules drop its transform (SiteLayout, site-theme.css).
 */
import {
  m,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Share of the track's progress (`start center` → `end center`) the line fills over. From 1024 px it is about the
 * pinned stretch of a 220dvh track with a frame one screen high, so the last step lights up before the frame leaves;
 * on a phone the line simply fills a little ahead of the reader.
 */
const FILL = [0.2, 0.7];

export interface StepsProgressProps {
  /** The heading of the section; it stays in the pinned frame above the steps. */
  header: ReactNode;
  /** The ordered list of steps: each step has `data-step`, its marker `data-step-marker`. */
  children: ReactNode;
}

export function StepsProgress({ header, children }: StepsProgressProps) {
  const track = useRef<HTMLDivElement>(null);
  const across = useRef<HTMLDivElement>(null);
  const down = useRef<HTMLDivElement>(null);
  // where each marker sits along the visible line, as a share of its length; the step reached last
  const thresholds = useRef<number[]>([]);
  const reached = useRef<number>(undefined);

  const reduce = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({
    target: track,
    offset: ['start center', 'end center'],
  });
  const progress = useTransform(scrollYProgress, FILL, [0, 1]);

  /**
   * Writes the state of the steps for a progress value, only when the reached step changes; with reduce, all reached.
   * At progress 0 the section has not reached its range yet: no step is lit, though the first marker sits at 0.
   */
  const mark = (value: number) => {
    const last = reduce
      ? Infinity
      : value <= 0
        ? -1
        : thresholds.current.findLastIndex((at) => value >= at - 0.01);
    if (last === reached.current) return;
    reached.current = last;
    track.current?.querySelectorAll('[data-step]').forEach((step, index) => {
      step.toggleAttribute('data-reached', index <= last);
      step.toggleAttribute('data-current', index === last);
    });
  };

  useEffect(() => {
    const root = track.current;
    if (!root) return;
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
      mark(progress.get());
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
    // `mark` reads refs and `reduce` only: the effect runs again when `reduce` changes
  }, [reduce, progress]);

  useMotionValueEvent(progress, 'change', mark);

  const fill = reduce ? 1 : progress;
  return (
    <div ref={track} className="md:motion-safe:h-site-steps">
      <div className="flex flex-col justify-center gap-12 py-16 md:motion-safe:sticky md:motion-safe:top-site-header md:motion-safe:min-h-site-first-screen">
        {header}
        <div className="relative">
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
                data-reveal=""
                className="size-full origin-left bg-accent-site"
                style={{ scaleX: fill }}
              />
            </div>
          </div>
          {/* below 1024 px: from the centre of the first marker to the end of the list */}
          <div
            ref={down}
            aria-hidden="true"
            className="pointer-events-none absolute top-3 bottom-0 left-2 w-0.5 -translate-x-1/2 bg-site-line md:hidden"
          >
            <m.div
              data-reveal=""
              className="size-full origin-top bg-accent-site"
              style={{ scaleY: fill }}
            />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
