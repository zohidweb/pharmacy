'use client';

import { Alert, Button, Card, CardHeader } from '@pharmacy/ui';
import { type ReactNode, useState } from 'react';
import { useTranslations } from 'use-intl';

export interface ActivationCodeCardProps {
  /** The one-time activation code exactly as the API returned it. */
  code: string;
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
export function ActivationCodeCard({ code, title, action }: ActivationCodeCardProps) {
  const t = useTranslations('activationCode');
  const [copied, setCopied] = useState(false);
  const display = groups(code);

  return (
    <Card as="section" aria-labelledby="activation-code-title" className="flex flex-col gap-4">
      <CardHeader title={title} titleId="activation-code-title" level={2} />
      <p
        className="m-0 select-all font-mono text-xl font-bold tracking-wider"
        aria-label={t('codeLabel')}
      >
        {display}
      </p>
      <Alert tone="warning">{t('once')}</Alert>
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          iconStart="clipboard-list"
          onClick={() => {
            void navigator.clipboard?.writeText(display).then(() => setCopied(true));
          }}
        >
          {copied ? t('copied') : t('copy')}
        </Button>
        {action}
      </div>
    </Card>
  );
}
