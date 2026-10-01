'use client';

import { useTranslations } from 'use-intl';
import { ApiError } from './client';

/** Problem codes with their own localized message (`apiErrors.<code>`). */
const knownCodes = [
  'not_found',
  'validation_failed',
  'store_not_in_scope',
  'not_bound',
  'pin_locked',
  'terminal_locked',
  'pin_trivial',
  'wrong_password',
  'wrong_pin',
  'step_up_required',
  'read_only_session',
] as const;
type KnownCode = (typeof knownCodes)[number];

const isKnown = (code: string): code is KnownCode =>
  (knownCodes as readonly string[]).includes(code);

/**
 * User-facing text for a failed request: a specific message for known problem codes, a network
 * message, otherwise a generic one with the correlation id for support. Never the raw response.
 */
export function useApiErrorMessage(error: unknown): string | null {
  const t = useTranslations();
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.code === 'network' || error.code === 'timeout')
      return t('errors.network');
    if (isKnown(error.code)) return t(`apiErrors.${error.code}`);
    return t('errors.unexpected', { correlationId: error.correlationId });
  }
  return t('errors.unexpected', { correlationId: '—' });
}
