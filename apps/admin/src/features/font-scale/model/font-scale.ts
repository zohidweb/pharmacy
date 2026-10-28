'use client';

/*
 * Font size of the admin (QA 2026-10-28): the operator scales the root font size with A−/A+. Every size of the UI kit
 * is in rem, so the whole interface grows or shrinks with it, as with browser zoom but for this app only. The scale is
 * the CSS variable --ph-root-font-scale on <html> (libs/ui base.css), remembered per browser in localStorage like the
 * locale — a per-viewer convenience without personal data; reads and writes never throw.
 */
import { useEffect, useSyncExternalStore } from 'react';

/** Steps in percent of the base font size (16 px). */
export const FONT_SCALES = [90, 100, 110, 120, 130, 140] as const;
export type FontScale = (typeof FONT_SCALES)[number];
export const DEFAULT_FONT_SCALE: FontScale = 100;

const STORAGE_KEY = 'pharmacy-admin-font-scale';
const listeners = new Set<() => void>();
let current: FontScale | null = null;

function isFontScale(value: number): value is FontScale {
  return (FONT_SCALES as readonly number[]).includes(value);
}

function readStored(): FontScale {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return isFontScale(stored) ? stored : DEFAULT_FONT_SCALE;
  } catch {
    return DEFAULT_FONT_SCALE;
  }
}

export function getFontScale(): FontScale {
  if (current === null) current = readStored();
  return current;
}

export function setFontScale(scale: FontScale): void {
  current = scale;
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    // storage unavailable: the choice lasts until reload
  }
  listeners.forEach((listener) => listener());
}

/** One step smaller (-1) or larger (+1); stays at the ends of the scale. */
export function stepFontScale(direction: -1 | 1): void {
  const index = FONT_SCALES.indexOf(getFontScale()) + direction;
  if (index >= 0 && index < FONT_SCALES.length) {
    setFontScale(FONT_SCALES[index]);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** First paint uses the default size; the stored one applies after hydration. */
export function useFontScale(): FontScale {
  return useSyncExternalStore(
    subscribe,
    getFontScale,
    () => DEFAULT_FONT_SCALE,
  );
}

/** Keeps --ph-root-font-scale of <html> in step with the chosen size (app bootstrap). */
export function useApplyFontScale(): void {
  const scale = useFontScale();
  useEffect(() => {
    const root = document.documentElement.style;
    if (scale === DEFAULT_FONT_SCALE) {
      root.removeProperty('--ph-root-font-scale');
    } else {
      root.setProperty('--ph-root-font-scale', String(scale / 100));
    }
  }, [scale]);
}
