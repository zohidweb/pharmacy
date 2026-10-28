'use client';

/*
 * Font size of an app (QA 2026-10-28): the user scales the root font size with A−/A+. Every size of the UI kit is in
 * rem, so the whole interface grows or shrinks with it, as with browser zoom but for this app only; printed documents
 * keep 100 % (base.css). The scale is the CSS variable --ph-root-font-scale on <html>, remembered per browser in
 * localStorage under the app's own key — a per-viewer convenience without personal data; reads and writes never throw.
 */
import { useEffect, useSyncExternalStore } from 'react';

/** Steps in percent of the base font size (16 px). */
export const FONT_SCALES = [90, 100, 110, 120, 130, 140] as const;
export type FontScale = (typeof FONT_SCALES)[number];
export const DEFAULT_FONT_SCALE: FontScale = 100;

export interface FontScaleStore {
  /** The steps the app offers, smallest first. */
  readonly scales: readonly FontScale[];
  /** The chosen size; the default on the first paint, the stored one after hydration. */
  useFontScale(): FontScale;
  setFontScale(scale: FontScale): void;
  /** One step smaller (-1) or larger (+1); stays at the ends of the scale. */
  stepFontScale(direction: -1 | 1): void;
  /** Keeps --ph-root-font-scale of <html> in step with the chosen size (app bootstrap). */
  useApplyFontScale(): void;
}

/**
 * One store per app, e.g. createFontScaleStore('pharmacy-web-font-scale', [90, 100, 110, 120]): the app's own key and
 * steps (a 1280×800 touch screen gets cramped above 120 %, a desktop monitor does not). The steps include 100 %.
 */
export function createFontScaleStore(
  storageKey: string,
  scales: readonly FontScale[] = FONT_SCALES,
): FontScaleStore {
  const listeners = new Set<() => void>();
  let current: FontScale | null = null;

  const isOffered = (value: number): value is FontScale =>
    (scales as readonly number[]).includes(value);

  const readStored = (): FontScale => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      return isOffered(stored) ? stored : DEFAULT_FONT_SCALE;
    } catch {
      return DEFAULT_FONT_SCALE;
    }
  };

  const getFontScale = (): FontScale => {
    if (current === null) current = readStored();
    return current;
  };

  const setFontScale = (scale: FontScale): void => {
    current = scale;
    try {
      localStorage.setItem(storageKey, String(scale));
    } catch {
      // storage unavailable: the choice lasts until reload
    }
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const useFontScale = (): FontScale =>
    useSyncExternalStore(subscribe, getFontScale, () => DEFAULT_FONT_SCALE);

  return {
    scales,
    useFontScale,
    setFontScale,
    stepFontScale(direction) {
      const index = scales.indexOf(getFontScale()) + direction;
      if (index >= 0 && index < scales.length) {
        setFontScale(scales[index]);
      }
    },
    useApplyFontScale() {
      const scale = useFontScale();
      useEffect(() => {
        const root = document.documentElement.style;
        if (scale === DEFAULT_FONT_SCALE) {
          root.removeProperty('--ph-root-font-scale');
        } else {
          root.setProperty('--ph-root-font-scale', String(scale / 100));
        }
      }, [scale]);
    },
  };
}
