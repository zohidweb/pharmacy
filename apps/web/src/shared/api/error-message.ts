'use client';

import { useTranslations } from 'use-intl';
import { ApiError } from './client';
import { isFreshAuthCancelled } from './fresh-auth';

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
  'fresh_auth_required',
  'password_session_required',
  'role_name_taken',
  'last_owner',
  'system_role',
  'pin_length',
  'read_only_session',
  'shift_open',
  'no_open_shift',
  'return_window_expired',
  'return_quantity_exceeded',
  'forbidden',
  'offline_store_read_only',
  'unpost_blocked',
  'document_posted',
  'stock_insufficient',
  'transfer_not_in_transit',
  'store_code_taken',
  'tax_id_taken',
  'invalid_code',
  'password_policy',
  'permission_escalation',
  'own_assignment',
  'login_taken',
  'phone_taken',
  'email_taken',
  'login_locked',
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
  // a cancelled password confirmation is the employee's choice, not an error
  if (!error || isFreshAuthCancelled(error)) return null;
  if (error instanceof ApiError) {
    if (error.code === 'network' || error.code === 'timeout')
      return t('errors.network');
    if (isKnown(error.code)) return t(`apiErrors.${error.code}`);
    return t('errors.unexpected', { correlationId: error.correlationId });
  }
  return t('errors.unexpected', { correlationId: '—' });
}
