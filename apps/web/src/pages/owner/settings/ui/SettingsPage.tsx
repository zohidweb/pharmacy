'use client';

import type {
  CategoryMarkup,
  NetworkSettings,
  NotificationKind,
  PrescriptionKind,
  ReturnPolicy,
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
import { canWrite, sessionQueryKey, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage, withFreshAuth } from '@/shared/api';
import { WithMessages } from '@/shared/i18n';
import { DemoDataNotice, QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { CategoriesCard } from './CategoriesCard';

const NOTIFICATIONS: NotificationKind[] = [
  'batch_expiring',
  'low_stock',
  'supplier_payment_due',
  'transfer_in_transit',
  'shift_discrepancy',
  'sync_conflict',
  'negative_stock',
  'license_expiring',
  'service_decided',
];

type NumberField =
  'posSessionTimeoutMinutes' | 'minPinLength' | 'expiryNoticeDays';

const RANGES: Record<NumberField, [number, number]> = {
  // the API keeps an idle session at least 5 minutes (spec 2026-10-14-owner-cabinet, E14)
  posSessionTimeoutMinutes: [5, 240],
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
    // the session timeout and the PIN length are security settings: a fresh sign-in (E14)
    mutationFn: () => {
      const body = {
        posSessionTimeoutMinutes: form.posSessionTimeoutMinutes,
        minPinLength: form.minPinLength,
        expiryNoticeDays: form.expiryNoticeDays,
        warnBelowCost: form.warnBelowCost,
        notifications: form.notifications,
      };
      return withFreshAuth(() => apiRequest('settings.update', { body }));
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings'], saved);
      // the bell, the home and the price warning read the settings: show the change at once
      // (final review I3)
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      toast.show(t('saved'));
    },
  });
  const error = useApiErrorMessage(save.error);
  const outOfRange = (field: NumberField) =>
    form[field] < RANGES[field][0] || form[field] > RANGES[field][1];
  const invalid = (Object.keys(RANGES) as NumberField[]).some(outOfRange);
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
        <DemoDataNotice routes={['settings.get']} />
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <div className="grid grid-cols-3 gap-4">
          <TextField
            label={t('network.networkName')}
            readOnly
            value={form.networkName}
            hint={t('network.networkNameHint')}
          />
          <TextField
            label={t('network.currency')}
            disabled
            value={t('network.currencyValue')}
            hint={t('network.currencyHint')}
          />
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
        <DemoDataNotice routes={['settings.get']} />
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

const KINDS: PrescriptionKind[] = ['none', 'rx', 'controlled'];

/**
 * The return window and the return policy of the network (spec 2026-10-13-customer-returns, R3):
 * which kinds of products are taken back at the customer's wish; a defect is taken back always.
 */
function ReturnsCard({
  policy,
  editable,
}: {
  policy: ReturnPolicy;
  editable: boolean;
}) {
  const t = useTranslations('settings');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(policy);
  const save = useMutation({
    mutationFn: () => apiRequest('settings.updateReturns', { body: form }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings', 'returns'], saved);
      toast.show(t('saved'));
    },
  });
  const error = useApiErrorMessage(save.error);
  const outOfRange = form.returnWindowDays < 0 || form.returnWindowDays > 365;
  return (
    <Card
      as="section"
      aria-labelledby="returns-title"
      className="flex flex-col gap-4"
    >
      <CardHeader
        title={t('returns.title')}
        titleId="returns-title"
        description={t('returns.hint')}
      />
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-3 gap-4">
        <TextField
          label={t('returns.windowDays')}
          inputMode="numeric"
          disabled={!editable}
          value={String(form.returnWindowDays)}
          hint={t('range', { min: 0, max: 365 })}
          error={outOfRange ? t('outOfRange') : undefined}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              returnWindowDays: Number(
                event.target.value.replace(/\D/g, '') || 0,
              ),
            }))
          }
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {KINDS.map((kind) => (
          <Switch
            key={kind}
            label={t(`returns.kinds.${kind}`)}
            description={t('returns.kindHint')}
            checked={form.customerReturns[kind]}
            disabled={!editable}
            onCheckedChange={(checked) =>
              setForm((current) => ({
                ...current,
                customerReturns: {
                  ...current.customerReturns,
                  [kind]: checked,
                },
              }))
            }
          />
        ))}
      </div>
      <p className="text-xs text-fg-subtle">{t('returns.defectHint')}</p>
      {editable && (
        <Button
          className="self-end"
          loading={save.isPending}
          disabled={outOfRange}
          onClick={() => save.mutate()}
        >
          {t('save')}
        </Button>
      )}
    </Card>
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
                  onBlur={() =>
                    // A saved markup cannot be removed here (the API keeps it): an emptied field
                    // shows it again instead of looking cleared.
                    setValues((current) =>
                      current[m.categoryId] === null && m.markupPercent !== null
                        ? { ...current, [m.categoryId]: m.markupPercent }
                        : current,
                    )
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
  const returns = useQuery({
    queryKey: ['settings', 'returns'],
    queryFn: ({ signal }) => apiRequest('settings.returns', { signal }),
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
        <QueryState query={returns}>
          {(data) => <ReturnsCard policy={data} editable={editable} />}
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
