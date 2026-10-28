/* The operator's font size (QA 2026-10-28): the shared store of libs/ui under the admin's own key. */
import { createFontScaleStore } from '@pharmacy/ui';

export const fontScale = createFontScaleStore('pharmacy-admin-font-scale');

/** Keeps the root font size of <html> in step with the chosen one (app bootstrap). */
export const useApplyFontScale = fontScale.useApplyFontScale;
