/*
 * The user's font size (QA 2026-10-28): the shared store of libs/ui under the client's own key. Up to 120 %: the
 * 1280×800 touch screens of the stores (C4 deployment) get cramped above it — 140 % is as wide as a 914 px screen.
 */
import { createFontScaleStore } from '@pharmacy/ui';

export const fontScale = createFontScaleStore(
  'pharmacy-web-font-scale',
  [90, 100, 110, 120],
);

/** Keeps the root font size of <html> in step with the chosen one (app bootstrap). */
export const useApplyFontScale = fontScale.useApplyFontScale;
