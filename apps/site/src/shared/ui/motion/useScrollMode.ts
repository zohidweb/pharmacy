'use client';

import { useReducedMotion } from 'motion/react';
import { useSyncExternalStore } from 'react';

/** Wide screens: the scroll-linked motion of the home page gets its sideways and larger moves (spec H8.1). */
const WIDE_SCREEN = '(min-width: 1024px)';

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_SCREEN);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export type ScrollMode = 'off' | 'compact' | 'wide';

const getMode = (): ScrollMode =>
  window.matchMedia(WIDE_SCREEN).matches ? 'wide' : 'compact';
// the server and the hydration render stand in the end position, so the markup matches and nothing is hidden without JS
const getModeOnServer = (): ScrollMode => 'off';

/**
 * How far a scroll-linked element may move (spec 2026-11-04-public-site-home-polish, H8.1): `off` on the server, in the
 * hydration render and with `reduce` (the element stands in its end position), `compact` below 1024 px (softer moves,
 * nothing sideways) and `wide` from 1024 px. The hooks of the caller run in every mode (hooks are not conditional); the
 * mode only decides whether their values are applied.
 */
export function useScrollMode(): ScrollMode {
  const reduce = useReducedMotion() ?? false;
  const mode = useSyncExternalStore(subscribeWide, getMode, getModeOnServer);
  return reduce ? 'off' : mode;
}
