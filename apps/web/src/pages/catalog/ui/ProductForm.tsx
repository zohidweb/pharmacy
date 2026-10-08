'use client';

import type {
  CatalogProduct,
  CatalogProductInput,
  CatalogReferences,
  PrescriptionKind,
  ProductUnit,
} from '@pharmacy/shared-dto';
import { formatMoney, parseMoneyToMinor } from '@pharmacy/shared-util';
import {
  Button,
  Icon,
  IconButton,
  RadioCardGroup,
  Select,
  Switch,
  TextField,
} from '@pharmacy/ui';
import { useId, useState } from 'react';
import { useTranslations } from 'use-intl';

export interface ProductDraft extends CatalogProductInput {
  /** Text of the regulated maximum while it is typed. */
  maxPriceText: string;
  regulated: boolean;
}

export function emptyDraft(refs: CatalogReferences): ProductDraft {
  return {
    nameRu: '',
    nameTj: '',
    inn: '',
    categoryId: refs.categories[0]?.id ?? '',
    form: refs.forms[0] ?? '',
    dosage: '',
    manufacturer: '',
    countryCode: 'TJ',
    unit: 'pack',
    piecesPerPack: 1,
    divisible: false,
    barcodes: [],
    prescription: 'none',
    maxPriceMinor: null,
    markupPercent: null,
    minStockPacks: 10,
    maxPriceText: '',
    regulated: false,
  };
}

export function draftOf(product: CatalogProduct): ProductDraft {
  return {
    nameRu: product.nameRu,
    nameTj: product.nameTj,
    inn: product.inn,
    categoryId: product.categoryId,
    form: product.form,
    dosage: product.dosage,
    manufacturer: product.manufacturer,
    countryCode: product.countryCode,
    unit: product.unit,
    piecesPerPack: product.piecesPerPack,
    divisible: product.divisible,
    barcodes: product.barcodes.map(({ code }) => ({ code })),
    prescription: product.prescription,
    maxPriceMinor: product.maxPriceMinor,
    markupPercent: product.markupPercent,
    minStockPacks: product.minStockPacks,
    maxPriceText:
      product.maxPriceMinor === null
        ? ''
        : formatMoney(product.maxPriceMinor, { withSign: false }),
    regulated: product.maxPriceMinor !== null,
  };
}

export function draftProblems(draft: ProductDraft) {
  return {
    nameRu: draft.nameRu.trim() === '',
    piecesPerPack: draft.piecesPerPack < 1,
    maxPrice:
      draft.regulated && (parseMoneyToMinor(draft.maxPriceText) ?? 0) <= 0,
  };
}

export function inputOf(draft: ProductDraft): CatalogProductInput {
  const { maxPriceText, regulated, ...input } = draft;
  return {
    ...input,
    maxPriceMinor: regulated ? parseMoneyToMinor(maxPriceText) : null,
  };
}

const UNITS: ProductUnit[] = ['pack', 'piece', 'ml'];

/** Fields of the form that show an `errors[]` entry of the API next to themselves. */
const FIELDS_WITH_ERRORS = new Set([
  'nameRu',
  'nameTj',
  'categoryId',
  'form',
  'countryCode',
  'piecesPerPack',
  'barcodes',
]);

/** True when the form shows every rejected field itself (no general alert is needed). */
export function shownAtFields(
  errors: ReadonlyArray<{ field: string }>,
): boolean {
  return (
    errors.length > 0 &&
    errors.every((error) => FIELDS_WITH_ERRORS.has(error.field))
  );
}
const PRESCRIPTIONS: PrescriptionKind[] = ['none', 'rx', 'controlled'];
const BARCODE = /^\d{8,14}$/;

/**
 * Fields of a product card (UI mockups «Новый товар», «Карточка товара»): names RU/TJ, МНН, form,
 * dosage, packing, barcodes (the scanner types digits + Enter), dispensing, regulated price.
 */
export function ProductForm({
  draft,
  onChange,
  refs,
  touched,
  disabled,
  fieldErrors = [],
}: {
  draft: ProductDraft;
  onChange: (change: (draft: ProductDraft) => ProductDraft) => void;
  refs: CatalogReferences;
  touched: boolean;
  disabled: boolean;
  /** `errors[]` of the last rejected save, laid onto the fields. */
  fieldErrors?: ReadonlyArray<{ field: string; code: string }>;
}) {
  const t = useTranslations('products.form');
  const id = useId();
  const [code, setCode] = useState('');
  const problems = draftProblems(draft);
  const serverError = (field: string) => {
    const code = fieldErrors.find((error) => error.field === field)?.code;
    if (code === undefined) return undefined;
    if (code === 'required') return t('nameRequired');
    if (code === 'barcode_taken') return t('barcodeTaken');
    return t('invalidValue');
  };
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    onChange((current) => ({ ...current, [key]: value }));
  const codeError =
    code === ''
      ? undefined
      : !BARCODE.test(code)
        ? t('barcodeFormat')
        : draft.barcodes.some((b) => b.code === code)
          ? t('barcodeDuplicate')
          : undefined;
  const addCode = () => {
    if (!code || codeError) return;
    onChange((current) => ({
      ...current,
      barcodes: [...current.barcodes, { code }],
    }));
    setCode('');
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('nameRu')}
          required
          disabled={disabled}
          value={draft.nameRu}
          error={
            touched && problems.nameRu
              ? t('nameRequired')
              : serverError('nameRu')
          }
          onChange={(event) => set('nameRu', event.target.value)}
        />
        <TextField
          label={t('nameTj')}
          lang="tg"
          disabled={disabled}
          value={draft.nameTj}
          error={serverError('nameTj')}
          onChange={(event) => set('nameTj', event.target.value)}
        />
        <TextField
          label={t('inn')}
          hint={t('innHint')}
          list={`${id}-inns`}
          disabled={disabled}
          value={draft.inn}
          onChange={(event) => set('inn', event.target.value)}
        />
        <Select
          label={t('category')}
          disabled={disabled}
          value={draft.categoryId}
          error={serverError('categoryId')}
          onChange={(event) => set('categoryId', event.target.value)}
          options={refs.categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          label={t('formField')}
          disabled={disabled}
          value={draft.form}
          error={serverError('form')}
          onChange={(event) => set('form', event.target.value)}
          options={refs.forms.map((value) => ({ value, label: value }))}
        />
        <TextField
          label={t('dosage')}
          placeholder={t('dosagePlaceholder')}
          disabled={disabled}
          value={draft.dosage}
          onChange={(event) => set('dosage', event.target.value)}
        />
        <TextField
          label={t('manufacturer')}
          list={`${id}-manufacturers`}
          disabled={disabled}
          value={draft.manufacturer}
          onChange={(event) => set('manufacturer', event.target.value)}
        />
        <Select
          label={t('country')}
          disabled={disabled}
          value={draft.countryCode}
          error={serverError('countryCode')}
          onChange={(event) => set('countryCode', event.target.value)}
          options={refs.countries.map((c) => ({
            value: c.code,
            label: c.name,
          }))}
        />
        <Select
          label={t('unit')}
          disabled={disabled}
          value={draft.unit}
          onChange={(event) => set('unit', event.target.value as ProductUnit)}
          options={UNITS.map((value) => ({
            value,
            label: t(`units.${value}`),
          }))}
        />
        <TextField
          label={t('piecesPerPack')}
          inputMode="numeric"
          disabled={disabled}
          value={String(draft.piecesPerPack)}
          error={
            touched && problems.piecesPerPack
              ? t('positive')
              : serverError('piecesPerPack')
          }
          onChange={(event) =>
            set(
              'piecesPerPack',
              Number(event.target.value.replace(/\D/g, '') || 0),
            )
          }
        />
      </div>
      <datalist id={`${id}-inns`}>
        {refs.inns.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id={`${id}-manufacturers`}>
        {refs.manufacturers.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <Switch
        label={t('divisible')}
        description={t('divisibleHint')}
        checked={draft.divisible}
        disabled={disabled || draft.piecesPerPack < 2}
        onCheckedChange={(checked) => set('divisible', checked)}
      />

      <section
        aria-labelledby={`${id}-barcodes`}
        className="flex flex-col gap-2"
      >
        <h3 id={`${id}-barcodes`} className="text-sm font-bold">
          {t('barcodes')}
        </h3>
        {draft.barcodes.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {draft.barcodes.map((barcode) => (
              <li
                key={barcode.code}
                className="flex items-center gap-2 rounded-full border border-border bg-surface-sunken ps-3 text-sm"
              >
                <Icon name="scan-barcode" size="sm" />
                <span className="tabular-nums">{barcode.code}</span>
                {!disabled && (
                  <IconButton
                    icon="x"
                    label={t('removeBarcode', { code: barcode.code })}
                    onClick={() =>
                      onChange((current) => ({
                        ...current,
                        barcodes: current.barcodes.filter(
                          (b) => b.code !== barcode.code,
                        ),
                      }))
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {!disabled && (
          <div className="grid grid-cols-(--ph-search-columns) items-start gap-3">
            <TextField
              label={t('scanBarcode')}
              hideLabel
              placeholder={t('scanBarcode')}
              inputMode="numeric"
              autoComplete="off"
              value={code}
              error={codeError}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ''))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCode();
                }
              }}
            />
            <Button
              variant="secondary"
              iconStart="plus"
              disabled={!code || codeError !== undefined}
              onClick={addCode}
            >
              {t('addBarcode')}
            </Button>
          </div>
        )}
        {draft.barcodes.length === 0 && (
          <p className="text-xs text-fg-subtle">{t('noBarcodeHint')}</p>
        )}
        {serverError('barcodes') && (
          <p role="alert" className="text-sm text-danger">
            {serverError('barcodes')}
          </p>
        )}
      </section>

      <RadioCardGroup
        label={t('dispensing')}
        value={draft.prescription}
        onValueChange={(value) => set('prescription', value)}
        options={PRESCRIPTIONS.map((value) => ({
          value,
          title: t(`prescription.${value}`),
          description: t(`prescriptionHint.${value}`),
          disabled,
        }))}
      />

      <div className="grid grid-cols-3 items-start gap-4">
        <Switch
          label={t('regulated')}
          description={t('regulatedHint')}
          checked={draft.regulated}
          disabled={disabled}
          onCheckedChange={(checked) => set('regulated', checked)}
        />
        <TextField
          label={t('maxPrice')}
          inputMode="decimal"
          disabled={disabled || !draft.regulated}
          value={draft.maxPriceText}
          error={
            touched && problems.maxPrice ? t('maxPriceRequired') : undefined
          }
          onChange={(event) => set('maxPriceText', event.target.value)}
        />
        <div />
        <TextField
          label={t('markup')}
          inputMode="numeric"
          hint={t('markupHint')}
          disabled={disabled}
          value={
            draft.markupPercent === null ? '' : String(draft.markupPercent)
          }
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '');
            set('markupPercent', digits === '' ? null : Number(digits));
          }}
        />
        <TextField
          label={t('minStock')}
          inputMode="numeric"
          disabled={disabled}
          value={String(draft.minStockPacks)}
          onChange={(event) =>
            set(
              'minStockPacks',
              Number(event.target.value.replace(/\D/g, '') || 0),
            )
          }
        />
      </div>
    </div>
  );
}
