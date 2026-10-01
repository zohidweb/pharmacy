'use client';

import { Alert, Button, Spinner } from '@pharmacy/ui';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { ApiError, useApiErrorMessage } from '@/shared/api';
import { StateScreen } from './StateScreen';

export interface QueryStateProps<T> {
  query: {
    data: T | undefined;
    error: unknown;
    isPending: boolean;
    refetch: () => unknown;
  };
  children: (data: T) => ReactNode;
}

/** Loading / error / data switch for one TanStack query; errors are never swallowed. */
export function QueryState<T>({ query, children }: QueryStateProps<T>) {
  const t = useTranslations('shell');
  const message = useApiErrorMessage(query.error);
  if (query.error instanceof ApiError && query.error.status === 403) {
    return (
      <StateScreen
        kind="forbidden"
        note={t('deniedNote', { correlationId: query.error.correlationId })}
      />
    );
  }
  if (query.error instanceof ApiError && query.error.status === 503) {
    return <StateScreen kind="maintenance" />;
  }
  if (query.error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert tone="danger" live="assertive">
          {message}
        </Alert>
        <Button
          variant="secondary"
          iconStart="refresh-cw"
          onClick={() => query.refetch()}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (query.isPending || query.data === undefined) {
    return (
      <div className="grid place-items-center py-12 text-primary">
        <Spinner size="xl" label={t('loading')} />
      </div>
    );
  }
  return <>{children(query.data)}</>;
}
