'use client';

import type { EmployeeSession } from '@pharmacy/shared-dto';
import { Alert, cx, Icon, Popover } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { currentStoreOf } from '@/entities/session';
import { useSelectStore } from '@/features/select-store';
import { useApiErrorMessage } from '@/shared/api';

const triggerClass =
  'inline-flex min-h-touch max-w-(--ph-size-dialog-sm) items-center gap-2 rounded-md border ' +
  'border-border bg-surface px-3 text-sm font-medium text-fg';

/**
 * Working store of the session. A PIN session is tied to the terminal store and an employee with
 * one store has nothing to choose — both see a plain label.
 */
export function StoreSwitcher({ session }: { session: EmployeeSession }) {
  const t = useTranslations('shell.store');
  const tMode = useTranslations('store.mode');
  const select = useSelectStore();
  const error = useApiErrorMessage(select.error);
  const store = currentStoreOf(session);
  const name = store?.name ?? t('none');
  const fixed = session.auth === 'pin' || session.stores.length < 2;

  if (fixed) {
    return (
      <span className={cx(triggerClass, 'border-transparent')}>
        <Icon name="store" size="md" />
        <span className="ph-visually-hidden">{t('label')}: </span>
        <span className="truncate">{name}</span>
        {session.auth === 'pin' && (
          <span className="text-fg-subtle" title={t('terminalBound')}>
            <Icon name="lock" size="sm" label={t('terminalBound')} />
          </span>
        )}
      </span>
    );
  }

  return (
    <Popover
      label={t('label')}
      width="md"
      trigger={(props) => (
        <button
          type="button"
          className={cx(triggerClass, 'hover:bg-surface-sunken')}
          aria-label={t('current', { name })}
          {...props}
        >
          <Icon name="store" size="md" />
          <span className="truncate">{name}</span>
          <Icon name="chevron-down" size="sm" />
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-1 p-2">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {session.stores.map((item) => {
              const selected = item.id === session.currentStoreId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    disabled={select.isPending}
                    onClick={() => {
                      if (selected) return close();
                      select.mutate(item.id, { onSuccess: close });
                    }}
                    className={cx(
                      'flex min-h-touch w-full items-center gap-3 rounded-md px-3 py-2 text-start text-sm transition-colors',
                      selected
                        ? 'bg-primary-subtle text-primary'
                        : 'text-fg hover:bg-surface-sunken',
                    )}
                  >
                    <Icon
                      name={item.mode === 'cloud' ? 'cloud' : 'cloud-off'}
                      size="md"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{item.name}</span>
                      <span className="truncate text-xs text-fg-subtle">
                        {item.address} · {tMode(item.mode)}
                      </span>
                    </span>
                    {selected && <Icon name="check" size="sm" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          <p className="flex gap-2 px-3 py-2 text-xs text-fg-subtle">
            <Icon name="info" size="sm" />
            {t('hint')}
          </p>
        </div>
      )}
    </Popover>
  );
}
