'use client';

import type {
  CategoryMarkup,
  NetworkSettings,
  NotificationKind,
} from '@pharmacy/shared-dto';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Switch,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { canWrite, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { CategoriesCard } from './CategoriesCard';

const NOTIFICATIONS: NotificationKind[] = [
  'expiry',
  'low_stock',
  'supplier_debt',
  'transfer',
  'shift_discrepancy',
  'sync_conflict',
  'negative_stock',
  'license_expiry',
];

type NumberField =
  | 'returnWindowDays'
  | 'posSessionTimeoutMinutes'
  | 'minPinLength'
  | 'expiryNoticeDays';

const RANGES: Record<NumberField, [number, number]> = {
  returnWindowDays: [0, 365],
  posSessionTimeoutMinutes: [1, 240],
  minPinLength: [4, 8],
  expiryNoticeDays: [1, 365],
};

function NetworkCard({
  settings,
  editable,
}: {
  settings: NetworkSettings;
  editable: boolean;
}) {
  const t = useTranslations('settings');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(settings);
  const save = useMutation({
    mutationFn: () => apiRequest('settings.update', { body: form }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings'], saved);
      toast.show(t('saved'));
    },
  });
  const error = useApiErrorMessage(save.error);
  const outOfRange = (field: NumberField) =>
    form[field] < RANGES[field][0] || form[field] > RANGES[field][1];
  const invalid =
    !form.networkName.trim() ||
    (Object.keys(RANGES) as NumberField[]).some(outOfRange);
  const number = (field: NumberField) => (
    <TextField
      label={t(`network.${field}`)}
      inputMode="numeric"
      disabled={!editable}
      value={String(form[field])}
      hint={t('range', { min: RANGES[field][0], max: RANGES[field][1] })}
      error={outOfRange(field) ? t('outOfRange') : undefined}
      onChange={(event) =>
        setForm((current) => ({
          ...current,
          [field]: Number(event.target.value.replace(/\D/g, '') || 0),
        }))
      }
    />
  );

  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardHeader title={t('network.title')} />
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <div className="grid grid-cols-3 gap-4">
          <TextField
            label={t('network.networkName')}
            required
            disabled={!editable}
            value={form.networkName}
            error={!form.networkName.trim() ? t('required') : undefined}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                networkName: event.target.value,
              }))
            }
          />
          <TextField
            label={t('network.currency')}
            disabled
            value={t('network.currencyValue')}
            hint={t('network.currencyHint')}
          />
          {number('returnWindowDays')}
          {number('posSessionTimeoutMinutes')}
          {number('minPinLength')}
          {number('expiryNoticeDays')}
        </div>
        <Switch
          label={t('network.warnBelowCost')}
          description={t('network.warnBelowCostHint')}
          checked={form.warnBelowCost}
          disabled={!editable}
          onCheckedChange={(checked) =>
            setForm((current) => ({ ...current, warnBelowCost: checked }))
          }
        />
        {editable && (
          <Button
            className="self-end"
            loading={save.isPending}
            disabled={invalid}
            onClick={() => save.mutate()}
          >
            {t('save')}
          </Button>
        )}
      </Card>
      <Card className="flex flex-col gap-4">
        <CardHeader
          title={t('notifications.title')}
          description={t('notifications.hint')}
        />
        <div className="grid grid-cols-2 gap-4">
          {NOTIFICATIONS.map((kind) => (
            <Switch
              key={kind}
              label={t(`notifications.items.${kind}.title`)}
              description={t(`notifications.items.${kind}.hint`)}
              checked={form.notifications[kind]}
              disabled={!editable}
              onCheckedChange={(checked) =>
                setForm((current) => ({
                  ...current,
                  notifications: { ...current.notifications, [kind]: checked },
                }))
              }
            />
          ))}
        </div>
        {editable && (
          <Button
            className="self-end"
            loading={save.isPending}
            disabled={invalid}
            onClick={() => save.mutate()}
          >
            {t('save')}
          </Button>
        )}
      </Card>
    </>
  );
}

function MarkupsCard({
  markups,
  editable,
}: {
  markups: CategoryMarkup[];
  editable: boolean;
}) {
  const t = useTranslations('settings.markups');
  const tSettings = useTranslations('settings');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(markups.map((m) => [m.categoryId, m.markupPercent])),
  );
  const save = useMutation({
    mutationFn: () =>
      apiRequest('settings.updateMarkups', {
        body: {
          // a category without a markup stays without one until a value is typed
          markups: markups.flatMap((m) => {
            const markupPercent = values[m.categoryId] ?? null;
            return markupPercent === null
              ? []
              : [{ categoryId: m.categoryId, markupPercent }];
          }),
        },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings', 'markups'], saved);
      void queryClient.invalidateQueries({ queryKey: ['prices'] });
      toast.show(tSettings('saved'));
    },
  });
  const error = useApiErrorMessage(save.error);
  const invalid = Object.values(values).some((v) => v !== null && v > 1000);
  return (
    <Card className="flex flex-col gap-4">
      <CardHeader title={t('title')} description={t('hint')} />
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <table className="w-full border-collapse text-sm">
        <caption className="ph-visually-hidden">{t('title')}</caption>
        <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
          <tr>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('category')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('markup')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('products')}
            </th>
          </tr>
        </thead>
        <tbody>
          {markups.map((m) => (
            <tr key={m.categoryId} className="border-b border-border">
              <th scope="row" className="px-2 py-2 text-start font-medium">
                {m.categoryName}
              </th>
              <td className="w-cell-md px-2 py-2">
                <TextField
                  label={t('markupOf', { category: m.categoryName })}
                  hideLabel
                  inputMode="numeric"
                  disabled={!editable}
                  value={String(values[m.categoryId] ?? '')}
                  error={
                    (values[m.categoryId] ?? 0) > 1000
                      ? tSettings('outOfRange')
                      : undefined
                  }
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [m.categoryId]:
                        event.target.value.replace(/\D/g, '') === ''
                          ? null
                          : Number(event.target.value.replace(/\D/g, '')),
                    }))
                  }
                />
              </td>
              <td className="px-2 py-2 text-end tabular-nums">{m.products}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <Button
          className="self-end"
          loading={save.isPending}
          disabled={invalid}
          onClick={() => save.mutate()}
        >
          {tSettings('save')}
        </Button>
      )}
    </Card>
  );
}

function ReferencesCard() {
  const t = useTranslations('settings.references');
  const refs = useQuery({
    queryKey: ['catalog', 'references'],
    queryFn: ({ signal }) => apiRequest('catalog.references', { signal }),
    staleTime: 5 * 60_000,
  });
  return (
    <Card className="flex flex-col gap-4">
      <CardHeader title={t('title')} description={t('hint')} />
      <QueryState query={refs}>
        {(data) => (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            {(
              [
                ['categories', data.categories.map((c) => c.name)],
                ['forms', data.forms],
                ['manufacturers', data.manufacturers],
                ['countries', data.countries.map((c) => c.name)],
              ] as const
            ).map(([key, values]) => (
              <div key={key} className="flex flex-col gap-1">
                <dt className="font-bold">
                  {t(key)} · {values.length}
                </dt>
                <dd className="text-fg-muted">{values.join(', ')}</dd>
              </div>
            ))}
          </dl>
        )}
      </QueryState>
    </Card>
  );
}

/** Network settings (UI mockup «Настройки»): TJS only, no exchange rates (ADR-0016). */
function SettingsPageView() {
  const t = useTranslations('settings');
  const { data: session } = useSession();
  const editable = canWrite(session, 'settings:update');
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => apiRequest('settings.get', { signal }),
  });
  const markups = useQuery({
    queryKey: ['settings', 'markups'],
    queryFn: ({ signal }) => apiRequest('settings.markups', { signal }),
  });
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="flex flex-col gap-4 px-6 pt-4">
        {session?.impersonation && <Alert tone="info">{t('readOnly')}</Alert>}
        <QueryState query={settings}>
          {(data) => <NetworkCard settings={data} editable={editable} />}
        </QueryState>
        <CategoriesCard />
        <div className="grid grid-cols-2 items-start gap-4">
          <QueryState query={markups}>
            {(data) => (
              <MarkupsCard
                // a new or archived category resets the inputs
                key={data.map((m) => m.categoryId).join()}
                markups={data}
                editable={editable}
              />
            )}
          </QueryState>
          <ReferencesCard />
        </div>
      </div>
    </>
  );
}

export function SettingsPage() {
  return (
    <WithMessages groups={['owner']}>
      <SettingsPageView />
    </WithMessages>
  );
}
