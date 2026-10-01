'use client';

import type {
  ControlledSaleData,
  PosBatch,
  PosProduct,
} from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney } from '@pharmacy/shared-util';
import { Alert, Button, cx, Dialog, StatusPill, TextField } from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  BatchStateBadge,
  PrescriptionBadge,
  batchState,
  fefoBatches,
} from '@/entities/catalog';

/** Batch choice (`pos:choose-batch`): FEFO first, expired batches shown and blocked without bypass. */
export function BatchDialog({
  product,
  currentBatchId,
  today,
  canSeeCost,
  onChoose,
  onClose,
}: {
  product: PosProduct | null;
  currentBatchId: string | null;
  today: string;
  canSeeCost: boolean;
  onChoose: (batch: PosBatch) => void;
  onClose: () => void;
}) {
  const t = useTranslations('pos.batchDialog');
  const tPos = useTranslations('pos');
  const fefo = product ? fefoBatches(product, today)[0] : undefined;
  const batches = product
    ? [...product.batches].sort((a, b) =>
        a.expiresOn.localeCompare(b.expiresOn),
      )
    : [];
  return (
    <Dialog
      open={product !== null}
      onClose={onClose}
      title={t('title')}
      description={product?.name}
      closeLabel={tPos('close')}
      size="md"
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-muted">{t('hint')}</p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {batches.map((batch) => {
            const state = batchState(batch, today);
            const blocked = state === 'expired' || state === 'empty';
            const packs = product
              ? Math.floor(batch.quantityPieces / product.piecesPerPack)
              : 0;
            return (
              <li key={batch.id}>
                <button
                  type="button"
                  disabled={blocked}
                  aria-pressed={batch.id === currentBatchId}
                  onClick={() => onChoose(batch)}
                  className={cx(
                    'flex min-h-touch-pos w-full items-center gap-3 rounded-md border px-4 py-3 text-start',
                    batch.id === currentBatchId
                      ? 'border-primary bg-primary-subtle'
                      : 'border-border bg-surface hover:bg-surface-sunken',
                    blocked &&
                      'cursor-not-allowed bg-surface-sunken text-fg-subtle',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {t('batch', { number: batch.number })}
                      {batch.id === fefo?.id && (
                        <StatusPill tone="info" icon={null}>
                          FEFO
                        </StatusPill>
                      )}
                      <BatchStateBadge state={state} />
                    </span>
                    <span className="text-xs text-fg-subtle">
                      {t('details', {
                        expires: formatDateOnly(batch.expiresOn),
                        packs,
                      })}
                      {canSeeCost &&
                        batch.costMinor !== undefined &&
                        ` · ${t('cost', { cost: formatMoney(batch.costMinor) })}`}
                    </span>
                  </span>
                  {blocked ? (
                    <span className="text-xs font-medium text-danger">
                      {state === 'expired' ? t('saleForbidden') : t('empty')}
                    </span>
                  ) : (
                    product && (
                      <span className="text-sm font-bold tabular-nums">
                        {formatMoney(product.priceMinor)}
                      </span>
                    )
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {batches.some((b) => batchState(b, today) === 'expired') && (
          <Alert tone="danger">{t('expiredBlock')}</Alert>
        )}
      </div>
    </Dialog>
  );
}

/** Prescription product: the cashier confirms a prescription was presented. */
export function RxDialog({
  product,
  onConfirm,
  onClose,
}: {
  product: PosProduct | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('pos.rxDialog');
  const tPos = useTranslations('pos');
  return (
    <Dialog
      open={product !== null}
      onClose={onClose}
      title={t('title')}
      description={product?.name}
      closeLabel={tPos('close')}
      icon="file-text"
      tone="warning"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tPos('cancel')}
          </Button>
          <Button onClick={onConfirm}>{t('confirm')}</Button>
        </>
      }
    >
      <p className="text-sm">{t('text')}</p>
    </Dialog>
  );
}

const CONTROLLED_FIELDS = [
  'prescriptionNumber',
  'prescriptionDate',
  'clinic',
  'doctor',
  'buyerName',
  'buyerDocument',
] as const satisfies ReadonlyArray<keyof ControlledSaleData>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ПКУ (`pos:sell-controlled`): prescription and buyer document are required and go to the ПКУ
 * journal on the server. Personal data stays in our own database only (ADR-0011).
 */
export function ControlledDialog({
  name,
  initial,
  today,
  onSave,
  onClose,
}: {
  name: string | null;
  initial: ControlledSaleData | null;
  today: string;
  onSave: (data: ControlledSaleData) => void;
  onClose: () => void;
}) {
  const t = useTranslations('pos.controlledDialog');
  const tPos = useTranslations('pos');
  const [data, setData] = useState<ControlledSaleData>(
    initial ?? {
      prescriptionNumber: '',
      prescriptionDate: today,
      clinic: '',
      doctor: '',
      buyerName: '',
      buyerDocument: '',
    },
  );
  const [touched, setTouched] = useState(false);
  const invalid = (field: keyof ControlledSaleData) =>
    field === 'prescriptionDate'
      ? !DATE.test(data.prescriptionDate) || data.prescriptionDate > today
      : data[field].trim().length < 2;
  const valid = CONTROLLED_FIELDS.every((field) => !invalid(field));
  return (
    <Dialog
      open={name !== null}
      onClose={onClose}
      title={t('title')}
      description={name ?? undefined}
      closeLabel={tPos('close')}
      icon="lock"
      tone="danger"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tPos('cancel')}
          </Button>
          <Button
            onClick={() => {
              setTouched(true);
              if (valid) {
                onSave({
                  prescriptionNumber: data.prescriptionNumber.trim(),
                  prescriptionDate: data.prescriptionDate,
                  clinic: data.clinic.trim(),
                  doctor: data.doctor.trim(),
                  buyerName: data.buyerName.trim(),
                  buyerDocument: data.buyerDocument.trim(),
                });
              }
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert tone="warning">{t('required')}</Alert>
        <div className="grid grid-cols-2 gap-4">
          {CONTROLLED_FIELDS.map((field) => (
            <TextField
              key={field}
              label={t(`fields.${field}`)}
              type={field === 'prescriptionDate' ? 'date' : 'text'}
              max={field === 'prescriptionDate' ? today : undefined}
              autoComplete="off"
              required
              value={data[field]}
              error={
                touched && invalid(field) ? t(`errors.${field}`) : undefined
              }
              onChange={(event) =>
                setData((current) => ({
                  ...current,
                  [field]: event.target.value,
                }))
              }
            />
          ))}
        </div>
        <p className="text-xs text-fg-subtle">{t('journalHint')}</p>
      </div>
    </Dialog>
  );
}

/** Product card at the POS: МНН, maker, batches; cost only with `finance:view-cost`. */
export function ProductDetailsDialog({
  product,
  today,
  canSeeCost,
  onAdd,
  onClose,
}: {
  product: PosProduct | null;
  today: string;
  canSeeCost: boolean;
  onAdd: (product: PosProduct) => void;
  onClose: () => void;
}) {
  const t = useTranslations('pos.details');
  const tPos = useTranslations('pos');
  const fefo = product ? fefoBatches(product, today)[0] : undefined;
  const rows: Array<[string, string]> = product
    ? [
        [t('inn'), product.inn ?? '—'],
        [t('manufacturer'), `${product.manufacturer} · ${product.country}`],
        [t('form'), product.form],
        [t('piecesPerPack'), String(product.piecesPerPack)],
        [t('price'), formatMoney(product.priceMinor)],
        [
          t('piecePrice'),
          product.piecePriceMinor !== null && product.divisible
            ? formatMoney(product.piecePriceMinor)
            : t('notDivisible'),
        ],
        [
          t('fefoBatch'),
          fefo
            ? `${fefo.number} · ${formatDateOnly(fefo.expiresOn)}`
            : tPos('outOfStock'),
        ],
        ...(canSeeCost && fefo?.costMinor !== undefined
          ? [[t('cost'), formatMoney(fefo.costMinor)] as [string, string]]
          : []),
      ]
    : [];
  return (
    <Dialog
      open={product !== null}
      onClose={onClose}
      title={product?.name ?? ''}
      closeLabel={tPos('close')}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tPos('close')}
          </Button>
          {product && fefo && (
            <Button onClick={() => onAdd(product)}>{t('add')}</Button>
          )}
        </>
      }
    >
      {product && (
        <div className="flex flex-col gap-4">
          <PrescriptionBadge kind={product.prescription} />
          <dl className="m-0 grid grid-cols-2 gap-4">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1">
                <dt className="text-xs text-fg-subtle">{label}</dt>
                <dd className="m-0 text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Dialog>
  );
}

/** Cancel before payment only; after payment it is a return (ТЗ). */
export function CancelReceiptDialog({
  open,
  positions,
  totalMinor,
  onConfirm,
  onClose,
}: {
  open: boolean;
  positions: number;
  totalMinor: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('pos.cancelDialog');
  const tPos = useTranslations('pos');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('title')}
      closeLabel={tPos('close')}
      icon="triangle-alert"
      tone="danger"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tPos('close')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="flex justify-between text-sm">
          <span>{tPos('positions', { count: positions })}</span>
          <b className="tabular-nums">{formatMoney(totalMinor)}</b>
        </p>
        <p className="text-sm text-fg-muted">{t('hint')}</p>
      </div>
    </Dialog>
  );
}
