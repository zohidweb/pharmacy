'use client';

import { useTranslations } from 'use-intl';
import { ApiError } from './client';

/** Problem codes with their own localized message (`apiErrors.<code>`). */
const knownCodes = [
  'not_found',
  'tenant_blocked',
  'inn_taken',
  'not_offline',
  'sync_queue_not_empty',
  'period_not_closed',
  'requisites_missing',
  'discount_overlap',
  'discount_invoiced',
  'idempotency_conflict',
  'service_invoiced',
  'invoice_paid',
  'payment_cancelled',
  'license_exists',
  'license_revoked',
  'validation_failed',
  'conflict',
  'login_taken',
  'cannot_disable_self',
  'cannot_issue_self',
  'already_disabled',
  'operator_disabled',
  'service_decided',
  'service_not_approved',
  'invalid_current_password',
  'fresh_auth_required',
  'already_blocked',
  'not_blocked',
  'invalid_code',
  'password_policy',
  'login_locked',
  'not_active',
  'version_conflict',
  'slug_taken',
  'slug_locked',
  'translation_required',
  'not_published',
  'not_draft',
  'archived',
  'already_published',
  'draft_empty',
  'media_not_found',
  'media_too_large',
  'payload_too_large',
  'unsupported_media_type',
  'request_already_decided',
  'article_not_found',
  'connection_request_not_found',
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
