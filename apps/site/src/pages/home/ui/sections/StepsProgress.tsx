'use client';

/*
 * The progress of «Как подключиться» (spec 2026-11-04-public-site-home-polish, H3). Nothing is pinned: the section is a
 * plain block, the steps stand in a row from 1024 px under one horizontal line and in a column with a vertical line
 * below. The line fills once, in 1.2 s, when 40 % of the list has come into view (`scaleX` / `scaleY`, `transform`
 * only), and the steps are marked `data-reached` in turn along it: each one is marked at once, and its own
 * `transition-delay` (set in Steps, by its index) spreads the colour change, so no React render and no listener runs
 * per step. The line and the steps react to the same viewport event of the list, through the animation features the
 * page already loads (MotionScope): no `useInView`, no extra code.
 *
 * With reduce, and without JavaScript, nothing waits for the viewport: the line is full (it carries `data-reveal`,
 * whose reduce and <noscript> rules drop its transform, SiteLayout and site-theme.css) and the steps take the colour of
 * the reached ones from CSS (`data-step-marker`, `data-step-figure` in site-theme.css). With reduce the steps also get
 * `data-reached` at once.
 */
import {
  m,
  useReducedMotion,
  type Transition,
  type Variants,
} from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { STEPS_FILL_DURATION } from './stepsTiming';

/** The fill starts when this share of the list is in view, once. */
const FILL_VIEWPORT = { once: true, amount: 0.4 } as const;

/** The line fills from 0 to 1 along one axis; with reduce it is full from the start and does not move. */
function fillVariants(axis: 'x' | 'y', reduce: boolean): Variants {
  const from = reduce ? 1 : 0;
  const transition: Transition = reduce
    ? { duration: 0 }
    : { duration: STEPS_FILL_DURATION, ease: 'linear' };
  return axis === 'x'
    ? { idle: { scaleX: from }, run: { scaleX: 1, transition } }
    : { idle: { scaleY: from }, run: { scaleY: 1, transition } };
}

export interface StepsProgressProps {
  /** The heading of the section. */
  header: ReactNode;
  /** The ordered list of steps: each step has `data-step`, its marker `data-step-marker`. */
  children: ReactNode;
}

export function StepsProgress({ header, children }: StepsProgressProps) {
  const list = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;

  const reach = () => {
    list.current
      ?.querySelectorAll('[data-step]')
      .forEach((step) => step.setAttribute('data-reached', ''));
  };

  useEffect(() => {
    if (reduce) reach();
  }, [reduce]);

  return (
    <div className="flex flex-col gap-12">
      {header}
      <m.div
        ref={list}
        className="relative"
        initial="idle"
        whileInView="run"
        viewport={FILL_VIEWPORT}
        onViewportEnter={reach}
      >
        {/* from 1024 px: from the centre of the first marker to the centre of the last (the grid of the steps) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-2 hidden grid-cols-5 gap-6 md:grid"
        >
          <div className="col-span-4 -mr-8 ml-2 h-0.5 -translate-y-1/2 bg-site-line">
            <m.div
              data-reveal=""
              className="size-full origin-left bg-accent-site"
              variants={fillVariants('x', reduce)}
            />
          </div>
        </div>
        {/* below 1024 px: from the first marker (it starts under it, hidden by its fill) to the end of the list */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-6 bottom-0 left-2 w-0.5 -translate-x-1/2 bg-site-line md:hidden"
        >
          <m.div
            data-reveal=""
            className="size-full origin-top bg-accent-site"
            variants={fillVariants('y', reduce)}
          />
        </div>
        {children}
      </m.div>
    </div>
  );
}
