'use client';

import type { DrugReferenceItem } from '@pharmacy/shared-dto';
import { Alert, Button, Spinner, TextField } from '@pharmacy/ui';
import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useApiErrorMessage } from '@/shared/api';
import { useCameraAvailable } from '@/shared/lib/camera-scan';
import { CameraScanButton } from '@/shared/ui';
import { useDrugReferenceSearch } from '../api/drug-references';

/** Typing pause before the search; Enter of a scanner searches at once (plan R11). */
const TYPING_PAUSE_MS = 300;

/**
 * «Общий справочник препаратов» above a new product card (plan 2026-11-11-drug-reference-seed, R10–R11): search by a
 * name or a barcode, «Заполнить» hands the entry to the form. A failed search never blocks filling the card by hand.
 */
export function DrugReferenceLookup({
  initialQuery,
  disabled,
  onFill,
}: {
  /** What the new product started from: a scanned barcode or a typed name. */
  initialQuery: string;
  disabled: boolean;
  onFill: (entry: DrugReferenceItem) => void;
}) {
  const t = useTranslations('products');
  const id = useId();
  const camera = useCameraAvailable();
  const [text, setText] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  // grows with each «Заполнить»: the alert remounts and is announced again; a new query hides it
  const [filled, setFilled] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text), TYPING_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);
  const search = useDrugReferenceSearch(query);
  const error = useApiErrorMessage(search.error);
  const active = query.trim().length >= 2;
  const items = search.data?.items ?? [];

  const searchNow = (value: string) => {
    setText(value);
    setQuery(value);
    setFilled(0);
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-sunken p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-title`} className="text-sm font-bold">
          {t('reference.title')}
        </h3>
        <p className="text-xs text-fg-subtle">{t('reference.hint')}</p>
      </div>
      <TextField
        label={t('reference.search')}
        hideLabel
        placeholder={t('reference.search')}
        type="search"
        autoComplete="off"
        disabled={disabled}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setFilled(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            searchNow(text);
          }
        }}
        endAdornment={
          camera ? (
            <CameraScanButton onScan={searchNow} disabled={disabled} />
          ) : undefined
        }
      />
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {active && search.isFetching && items.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-fg-subtle">
            <Spinner size="sm" />
            {t('reference.searching')}
          </p>
        )}
        {active && error && <p className="text-sm text-danger">{error}</p>}
        {active && search.isSuccess && items.length === 0 && (
          <p className="text-sm text-fg-subtle">{t('reference.notFound')}</p>
        )}
        {active && search.isSuccess && items.length > 0 && (
          <p className="sr-only">
            {t('reference.found', { count: search.data.total })}
          </p>
        )}
        {filled > 0 && (
          <Alert key={filled} tone="success">
            {t('reference.filled')}
          </Alert>
        )}
      </div>
      {active && items.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
          {items.map((entry) => {
            const details = [entry.form, entry.dosage, entry.manufacturer]
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold">
                    {entry.nameRu || entry.nameTj}
                  </span>
                  {(details || entry.prescription !== 'none') && (
                    <span className="text-xs text-fg-subtle">
                      {[
                        details,
                        entry.prescription === 'none'
                          ? ''
                          : t(`form.prescription.${entry.prescription}`),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                  <span className="text-xs text-fg-subtle tabular-nums">
                    {entry.barcodes.join(', ')}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  aria-label={t('reference.fillLabel', {
                    name: entry.nameRu || entry.nameTj,
                  })}
                  onClick={() => {
                    onFill(entry);
                    setFilled((count) => count + 1);
                  }}
                >
                  {t('reference.fill')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {active && search.data && search.data.total > items.length && (
        <p className="text-xs text-fg-subtle">
          {t('reference.more', {
            shown: items.length,
            total: search.data.total,
          })}
        </p>
      )}
    </section>
  );
}
