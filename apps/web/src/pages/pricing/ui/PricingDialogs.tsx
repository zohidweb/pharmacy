'use client';

import { priceWarnings } from '@pharmacy/shared-domain';
import type {
  DiscountRuleDefinition,
  DiscountRuleInput,
  PriceRow,
} from '@pharmacy/shared-dto';
import { formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  IconButton,
  Select,
  StatusPill,
  Switch,
  TextField,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { MoneyInput } from '@/features/stock-document';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

/**
 * New prices of a product by store (UI mockup «Изменение цены»): above the regulated maximum is a
 * soft warning confirmed by a checkbox; below the purchase price only warns.
 */
export function PriceDialog({
  row,
  onClose,
}: {
  row: PriceRow;
  onClose: () => void;
}) {
  const t = useTranslations('pricing.edit');
  const tPricing = useTranslations('pricing');
  const tDocs = useTranslations('stockDocs');
  const queryClient = useQueryClient();
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(row.prices.map((p) => [p.storeId, p.priceMinor])),
  );
  const [same, setSame] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const first = row.prices[0]?.storeId ?? '';
  const value = (storeId: string) => prices[same ? first : storeId] ?? 0;
  const warningsOf = (storeId: string) =>
    priceWarnings({
      priceMinor: value(storeId),
      costMinor: row.costMinor,
      maxPriceMinor: row.maxPriceMinor,
    });
  const aboveMax = row.prices.some((p) =>
    warningsOf(p.storeId).includes('above_max'),
  );
  // a store without a price stays without one until a price is typed
  const changed = row.prices.filter(
    (p) => value(p.storeId) > 0 && value(p.storeId) !== p.priceMinor,
  );
  const save = useMutation({
    mutationFn: () =>
      apiRequest('prices.update', {
        params: { productId: row.productId },
        body: {
          prices: changed.map((p) => ({
            storeId: p.storeId,
            priceMinor: value(p.storeId),
          })),
          confirmAboveMax: confirmed,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prices'] });
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
      onClose();
    },
  });
  const error = useApiErrorMessage(save.error);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={row.productName}
      closeLabel={tDocs('close')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tDocs('cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={
              changed.length === 0 ||
              (aboveMax && !confirmed) ||
              // a price is not removed here: an existing one cannot be cleared
              row.prices.some(
                (p) => p.priceMinor !== null && value(p.storeId) <= 0,
              )
            }
            onClick={() => save.mutate()}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <dl className="grid grid-cols-3 gap-4 text-sm">
          {(
            [
              [
                'cost',
                row.costMinor != null ? formatMoney(row.costMinor) : '—',
              ],
              [
                'markup',
                row.markupPercent === null ? '—' : `${row.markupPercent} %`,
              ],
              [
                'maxPrice',
                row.maxPriceMinor !== null
                  ? formatMoney(row.maxPriceMinor)
                  : tPricing('notRegulated'),
              ],
            ] as const
          ).map(([key, text]) => (
            <div
              key={key}
              className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3"
            >
              <dt className="text-xs text-fg-muted">
                {tPricing(`columns.${key}`)}
              </dt>
              <dd className="font-bold tabular-nums">{text}</dd>
            </div>
          ))}
        </dl>
        {row.prices.length > 1 && (
          <Switch
            label={t('same')}
            description={t('sameHint')}
            checked={same}
            onCheckedChange={setSame}
          />
        )}
        <table className="w-full border-collapse text-sm">
          <caption className="ph-visually-hidden">{t('title')}</caption>
          <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t('store')}
              </th>
              <th scope="col" className="px-2 py-2 text-end font-medium">
                {t('current')}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t('new')}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t('warnings')}
              </th>
            </tr>
          </thead>
          <tbody>
            {row.prices.map((price, index) => (
              <tr key={price.storeId} className="border-b border-border">
                <td className="px-2 py-2">{price.storeName}</td>
                <td className="px-2 py-2 text-end tabular-nums">
                  {price.priceMinor === null
                    ? tPricing('notSold')
                    : formatMoney(price.priceMinor, { withSign: false })}
                </td>
                <td className="w-cell-md px-2 py-2">
                  {!same || index === 0 ? (
                    <MoneyInput
                      label={t('newOf', { store: price.storeName })}
                      valueMinor={value(price.storeId)}
                      invalidText={tDocs('amountFormat')}
                      allowEmpty
                      onChange={(priceMinor) =>
                        setPrices((current) => ({
                          ...current,
                          [same ? first : price.storeId]: priceMinor,
                        }))
                      }
                    />
                  ) : (
                    <span className="tabular-nums">
                      {formatMoney(value(price.storeId), { withSign: false })}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap gap-1">
                    {warningsOf(price.storeId).map((w) => (
                      <StatusPill key={w} tone="warning">
                        {tPricing(`warnings.${w}`)}
                      </StatusPill>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {aboveMax && (
          <Checkbox
            label={t('confirmAboveMax')}
            description={t('softWarning')}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
        )}
        <p className="text-xs text-fg-subtle">{t('auditHint')}</p>
      </div>
    </Dialog>
  );
}

interface ThresholdDraft {
  key: number;
  minSubtotalMinor: number;
  percentText: string;
}

/**
 * Discount rule (UI mockup «Новое правило»): thresholds by the receipt subtotal, scope — the network
 * or stores, validity. The best threshold applies, without summing (glossary «Скидочное правило»).
 */
export function RuleDialog({
  rule,
  stores,
  canNetwork,
  onClose,
}: {
  rule: DiscountRuleDefinition | null;
  stores: Array<{ id: string; name: string }>;
  canNetwork: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('pricing.rule');
  const tDocs = useTranslations('stockDocs');
  const queryClient = useQueryClient();
  const [name, setName] = useState(rule?.name ?? '');
  const [network, setNetwork] = useState(
    rule ? rule.storeIds === null : canNetwork,
  );
  const [storeIds, setStoreIds] = useState<string[]>(rule?.storeIds ?? []);
  const [thresholds, setThresholds] = useState<ThresholdDraft[]>(() =>
    (rule?.thresholds ?? [{ minSubtotalMinor: 50_000, percent: 3 }]).map(
      (th, key) => ({
        key,
        minSubtotalMinor: th.minSubtotalMinor,
        percentText: String(th.percent),
      }),
    ),
  );
  const [limited, setLimited] = useState(rule?.period !== null && !!rule);
  const [from, setFrom] = useState(rule?.period?.from ?? toAppDate());
  const [to, setTo] = useState(rule?.period?.to ?? '');
  const [touched, setTouched] = useState(false);

  const input = (): DiscountRuleInput => ({
    name,
    storeIds: network ? null : storeIds,
    thresholds: thresholds.map((th) => ({
      minSubtotalMinor: th.minSubtotalMinor,
      percent: Number(th.percentText),
    })),
    period: limited ? { from, to: to || null } : null,
  });
  const invalid = {
    name: name.trim() === '',
    stores: !network && storeIds.length === 0,
    thresholds:
      thresholds.length === 0 ||
      thresholds.some((th) => {
        const percent = Number(th.percentText);
        return (
          th.minSubtotalMinor <= 0 ||
          !Number.isInteger(percent) ||
          percent < 1 ||
          percent > 100
        );
      }),
    period: limited && to !== '' && to < from,
  };
  const valid = !Object.values(invalid).some(Boolean);
  const save = useMutation({
    mutationFn: () =>
      rule
        ? apiRequest('discountRules.update', {
            params: { id: rule.id },
            body: input(),
          })
        : apiRequest('discountRules.create', { body: input() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['discount-rules'] });
      onClose();
    },
  });
  const error = useApiErrorMessage(save.error);

  return (
    <Dialog
      open
      onClose={onClose}
      title={rule ? rule.name : t('newTitle')}
      description={t('subtitle')}
      closeLabel={tDocs('close')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tDocs('cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTouched(true);
              if (valid) save.mutate();
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <TextField
          label={t('name')}
          required
          placeholder={t('namePlaceholder')}
          value={name}
          error={touched && invalid.name ? t('nameRequired') : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-bold">{t('scope')}</legend>
          <Switch
            label={t('network')}
            description={canNetwork ? undefined : t('networkOwnerOnly')}
            checked={network}
            disabled={!canNetwork}
            onCheckedChange={setNetwork}
          />
          {!network && (
            <div className="grid grid-cols-2 gap-2">
              {stores.map((store) => (
                <Checkbox
                  key={store.id}
                  label={store.name}
                  checked={storeIds.includes(store.id)}
                  onChange={(event) =>
                    setStoreIds((current) =>
                      event.target.checked
                        ? [...current, store.id]
                        : current.filter((id) => id !== store.id),
                    )
                  }
                />
              ))}
            </div>
          )}
          {touched && invalid.stores && (
            <Alert tone="warning">{t('storesRequired')}</Alert>
          )}
        </fieldset>

        <section
          aria-labelledby="rule-thresholds"
          className="flex flex-col gap-2"
        >
          <h3 id="rule-thresholds" className="text-sm font-bold">
            {t('thresholds')}
          </h3>
          {thresholds.map((th) => (
            <div
              key={th.key}
              className="grid grid-cols-(--ph-search-columns-2) items-end gap-3"
            >
              <MoneyInput
                label={t('from')}
                hideLabel={false}
                valueMinor={th.minSubtotalMinor}
                invalidText={tDocs('amountFormat')}
                onChange={(minSubtotalMinor) =>
                  setThresholds((current) =>
                    current.map((c) =>
                      c.key === th.key ? { ...c, minSubtotalMinor } : c,
                    ),
                  )
                }
              />
              <TextField
                label={t('percent')}
                inputMode="numeric"
                value={th.percentText}
                onChange={(event) =>
                  setThresholds((current) =>
                    current.map((c) =>
                      c.key === th.key
                        ? {
                            ...c,
                            percentText: event.target.value.replace(/\D/g, ''),
                          }
                        : c,
                    ),
                  )
                }
              />
              <IconButton
                icon="trash-2"
                label={t('removeThreshold')}
                disabled={thresholds.length === 1}
                onClick={() =>
                  setThresholds((current) =>
                    current.filter((c) => c.key !== th.key),
                  )
                }
              />
            </div>
          ))}
          {touched && invalid.thresholds && (
            <Alert tone="warning">{t('thresholdsInvalid')}</Alert>
          )}
          <Button
            variant="tertiary"
            iconStart="plus"
            className="self-start"
            onClick={() =>
              setThresholds((current) => [
                ...current,
                {
                  key: Math.max(0, ...current.map((c) => c.key)) + 1,
                  minSubtotalMinor:
                    (current.at(-1)?.minSubtotalMinor ?? 0) + 50_000,
                  percentText: '',
                },
              ])
            }
          >
            {t('addThreshold')}
          </Button>
        </section>

        <div className="grid grid-cols-3 items-start gap-4">
          <Select
            label={t('validity')}
            value={limited ? 'limited' : 'indefinite'}
            onChange={(event) => setLimited(event.target.value === 'limited')}
            options={[
              { value: 'indefinite', label: t('indefinite') },
              { value: 'limited', label: t('limited') },
            ]}
          />
          {limited && (
            <>
              <TextField
                label={t('dateFrom')}
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <TextField
                label={t('dateTo')}
                type="date"
                min={from}
                value={to}
                error={
                  touched && invalid.period ? t('periodInvalid') : undefined
                }
                onChange={(event) => setTo(event.target.value)}
              />
            </>
          )}
        </div>
        <p className="text-xs text-fg-subtle">{t('bestHint')}</p>
        <p className="text-xs text-fg-subtle">{t('authorHint')}</p>
      </div>
    </Dialog>
  );
}
