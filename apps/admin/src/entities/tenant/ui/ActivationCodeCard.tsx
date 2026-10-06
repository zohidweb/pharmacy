'use client';

import { formatDateTime } from '@pharmacy/shared-util';
import { Alert, Button, Card, CardHeader } from '@pharmacy/ui';
import { type ReactNode, useState } from 'react';
import { useTranslations } from 'use-intl';

export interface ActivationCodeCardProps {
  /** The one-time activation code exactly as the API returned it. */
  code: string;
  /** ISO 8601 expiry as the API returned it. */
  expiresAt: string;
  title: string;
  /** What the operator does next (a link to the company, a close button). */
  action?: ReactNode;
}

// The code is 26 base32 characters; groups of 4 are easier to dictate (activation-code.ts).
function groups(code: string): string {
  const compact = code.replace(/[\s-]/g, '');
  return (compact.match(/.{1,4}/g) ?? [compact]).join('-');
}

/**
 * The owner's one-time activation code, shown once (spec 2026-10-05-tenants-module): only its hash
 * is stored, so it cannot be shown again — a lost code is replaced with a new one.
 */
export function ActivationCodeCard({
  code,
  expiresAt,
  title,
  action,
}: ActivationCodeCardProps) {
  const t = useTranslations('activationCode');
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const display = groups(code);

  return (
    <Card
      as="section"
      aria-labelledby="activation-code-title"
      className="flex flex-col gap-4"
    >
      <CardHeader title={title} titleId="activation-code-title" level={2} />
      <p
        className="m-0 select-all whitespace-nowrap font-mono text-lg font-bold tracking-wider"
        aria-label={t('codeLabel')}
      >
        {display}
      </p>
      <Alert tone="warning">
        {t('once', { expiresAt: formatDateTime(expiresAt) })}
      </Alert>
      {copy === 'failed' && (
        <Alert tone="danger" live="assertive">
          {t('copyFailed')}
        </Alert>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          iconStart="clipboard-list"
          onClick={() => {
            // No clipboard outside a secure context, or the permission is denied.
            const write = navigator.clipboard?.writeText(display);
            if (!write) {
              setCopy('failed');
              return;
            }
            write.then(
              () => setCopy('copied'),
              () => setCopy('failed'),
            );
          }}
        >
          {copy === 'copied' ? t('copied') : t('copy')}
        </Button>
        {action}
      </div>
    </Card>
  );
}
