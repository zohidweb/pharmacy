'use client';

import { Alert, buttonClassName, Icon, type IconName } from '@pharmacy/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';

export type StateKind = 'notFound' | 'forbidden' | 'maintenance';

const icon: Record<StateKind, IconName> = {
  notFound: 'search',
  forbidden: 'lock',
  maintenance: 'wrench',
};

const iconTone: Record<StateKind, string> = {
  notFound: 'bg-surface-sunken text-fg-subtle',
  forbidden: 'bg-warning-subtle text-warning',
  maintenance: 'bg-primary-subtle text-primary',
};

export interface StateScreenProps {
  kind: StateKind;
  /** Extra details, e.g. the correlation id of a denied request. */
  note?: ReactNode;
  /** Replaces the default action links. */
  actions?: ReactNode;
}

/** Service states (UI mockup «Состояния»): page not found, access denied, maintenance. */
export function StateScreen({ kind, note, actions }: StateScreenProps) {
  const t = useTranslations(`states.${kind}`);
  const tStates = useTranslations('states');
  return (
    <section
      aria-labelledby="state-title"
      className="mx-auto flex max-w-(--ph-size-dialog-md) flex-col items-center gap-4 px-6 py-16 text-center"
    >
      {kind === 'notFound' ? (
        <p aria-hidden="true" className="text-4xl font-bold text-border-strong">
          404
        </p>
      ) : (
        <span
          className={`grid size-avatar-lg place-items-center rounded-lg ${iconTone[kind]}`}
        >
          <Icon name={icon[kind]} size="xl" />
        </span>
      )}
      <h2 id="state-title" className="text-xl font-bold tracking-tight">
        {t('title')}
      </h2>
      <p className="text-sm text-fg-muted">{t('description')}</p>
      {note && <Alert tone="info">{note}</Alert>}
      <div className="flex flex-wrap justify-center gap-2">
        {actions ?? (
          <>
            <Link href="/" className={buttonClassName({})}>
              {tStates('toDashboard')}
            </Link>
            <Link
              href="/companies"
              className={buttonClassName({ variant: 'secondary' })}
            >
              {tStates('toCompanies')}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
