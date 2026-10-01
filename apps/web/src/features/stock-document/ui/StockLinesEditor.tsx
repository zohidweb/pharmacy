'use client';

import { pieceCost } from '@pharmacy/shared-domain';
import type {
  SaleUnit,
  StockBatch,
  StockProductOption,
} from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  EmptyState,
  IconButton,
  Select,
  StatusPill,
  TextField,
} from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { ProductSearch } from './ProductSearch';
import { QuantityInput } from './inputs';

export interface EditableStockLine {
  key: string;
  productId: string;
  productName: string;
  piecesPerPack: number;
  divisible: boolean;
  batches: StockBatch[];
  batchId: string;
  unit: SaleUnit;
  quantity: number;
  note: string;
}

const piecesOf = (line: EditableStockLine) =>
  line.unit === 'pack' ? line.quantity * line.piecesPerPack : line.quantity;

export function unitCostOf(line: EditableStockLine): number | undefined {
  const batch = line.batches.find((b) => b.id === line.batchId);
  if (batch?.costMinor === undefined) return undefined;
  return line.unit === 'pack'
    ? batch.costMinor
    : pieceCost(batch.costMinor, line.piecesPerPack);
}

export function stockLineProblem(
  line: EditableStockLine,
): 'quantity' | 'stock' | null {
  if (line.quantity < 1) return 'quantity';
  const batch = line.batches.find((b) => b.id === line.batchId);
  if (!batch || piecesOf(line) > batch.quantityPieces) return 'stock';
  return null;
}

/** New line of a product: FEFO batch with stock (expired ones too — they may be written off). */
export function lineOf(
  product: StockProductOption,
  {
    batch,
    includeExpired = false,
  }: { batch?: StockBatch; includeExpired?: boolean } = {},
): EditableStockLine | null {
  const today = toAppDate();
  const candidates = product.batches
    .filter(
      (b) => b.quantityPieces > 0 && (includeExpired || b.expiresOn >= today),
    )
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const chosen = batch ?? candidates[0];
  if (!chosen) return null;
  return {
    key: `${product.id}-${chosen.id}-${Date.now()}`,
    productId: product.id,
    productName: product.name,
    piecesPerPack: product.piecesPerPack,
    divisible: product.divisible,
    batches: product.batches.filter((b) => b.quantityPieces > 0),
    batchId: chosen.id,
    unit: 'pack',
    quantity: 1,
    note: '',
  };
}

/**
 * Lines «товар → партия → количество» of write-offs and supplier returns: the quantity is limited
 * by the stock of the batch; costs are shown only with `finance:view-cost`.
 */
export function StockLinesEditor({
  storeId,
  lines,
  onChange,
  editable,
  showCost,
  withNote = false,
  touched,
  allowExpired = true,
}: {
  storeId: string;
  lines: EditableStockLine[];
  onChange: (lines: EditableStockLine[]) => void;
  editable: boolean;
  showCost: boolean;
  withNote?: boolean;
  touched: boolean;
  allowExpired?: boolean;
}) {
  const t = useTranslations('stockDocs.lines');
  const tDocs = useTranslations('stockDocs');
  const today = toAppDate();
  const set = (key: string, change: Partial<EditableStockLine>) =>
    onChange(
      lines.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  const total = lines.reduce(
    (sum, l) => sum + l.quantity * (unitCostOf(l) ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-3">
      {editable && (
        <ProductSearch
          storeId={storeId}
          onPick={(product) => {
            const line = lineOf(product, { includeExpired: allowExpired });
            if (line) onChange([...lines, line]);
          }}
        />
      )}
      {lines.length === 0 ? (
        <EmptyState
          icon="package"
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-(--ph-size-table-md) border-collapse text-sm">
            <caption className="ph-visually-hidden">{t('caption')}</caption>
            <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('product')}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('batch')}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('stock')}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('quantity')}
                </th>
                {showCost && (
                  <>
                    <th scope="col" className="px-2 py-2 text-end font-medium">
                      {t('cost')}
                    </th>
                    <th scope="col" className="px-2 py-2 text-end font-medium">
                      {t('sum')}
                    </th>
                  </>
                )}
                <th scope="col">
                  <span className="ph-visually-hidden">{tDocs('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const batch = line.batches.find((b) => b.id === line.batchId);
                const problem = stockLineProblem(line);
                const cost = unitCostOf(line);
                return (
                  <tr
                    key={line.key}
                    className="border-b border-border align-top"
                  >
                    <td className="px-2 py-2">
                      <span className="font-medium">{line.productName}</span>
                      {withNote && (
                        <TextField
                          label={t('noteOf', { name: line.productName })}
                          hideLabel
                          placeholder={t('notePlaceholder')}
                          disabled={!editable}
                          value={line.note}
                          className="mt-2"
                          onChange={(event) =>
                            set(line.key, { note: event.target.value })
                          }
                        />
                      )}
                    </td>
                    <td className="w-cell-lg px-2 py-2">
                      <Select
                        label={t('batchOf', { name: line.productName })}
                        hideLabel
                        disabled={!editable}
                        value={line.batchId}
                        onChange={(event) =>
                          set(line.key, { batchId: event.target.value })
                        }
                        options={line.batches.map((b) => ({
                          value: b.id,
                          label: `${b.number} · ${formatDateOnly(b.expiresOn)}`,
                        }))}
                      />
                      {batch && batch.expiresOn < today && (
                        <StatusPill tone="danger" className="mt-1">
                          {t('expired')}
                        </StatusPill>
                      )}
                    </td>
                    <td className="px-2 py-3 tabular-nums text-fg-muted">
                      {batch
                        ? t('stockValue', {
                            packs: Math.floor(
                              batch.quantityPieces / line.piecesPerPack,
                            ),
                            pieces: batch.quantityPieces % line.piecesPerPack,
                          })
                        : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-2">
                        <div className="w-cell-sm">
                          <QuantityInput
                            label={t('quantityOf', { name: line.productName })}
                            disabled={!editable}
                            value={line.quantity}
                            invalid={
                              touched && problem
                                ? t(
                                    problem === 'stock'
                                      ? 'overStock'
                                      : 'quantityRequired',
                                  )
                                : undefined
                            }
                            onChange={(value) =>
                              set(line.key, { quantity: value ?? 0 })
                            }
                          />
                        </div>
                        {line.divisible ? (
                          <Select
                            label={t('unitOf', { name: line.productName })}
                            hideLabel
                            disabled={!editable}
                            value={line.unit}
                            onChange={(event) =>
                              set(line.key, {
                                unit: event.target.value as SaleUnit,
                              })
                            }
                            options={[
                              { value: 'pack', label: t('units.pack') },
                              { value: 'piece', label: t('units.piece') },
                            ]}
                          />
                        ) : (
                          <span className="py-3 text-fg-muted">
                            {t('units.pack')}
                          </span>
                        )}
                      </div>
                    </td>
                    {showCost && (
                      <>
                        <td className="px-2 py-3 text-end tabular-nums">
                          {cost !== undefined
                            ? formatMoney(cost, { withSign: false })
                            : '—'}
                        </td>
                        <td className="px-2 py-3 text-end tabular-nums">
                          {cost !== undefined
                            ? formatMoney(cost * line.quantity, {
                                withSign: false,
                              })
                            : '—'}
                        </td>
                      </>
                    )}
                    <td className="px-1 py-2">
                      {editable && (
                        <IconButton
                          icon="trash-2"
                          label={tDocs('removeLine', {
                            name: line.productName,
                          })}
                          onClick={() =>
                            onChange(lines.filter((l) => l.key !== line.key))
                          }
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {showCost && lines.length > 0 && (
        <p className="flex justify-end gap-2 text-md">
          <span>{t('total')}</span>
          <b className="tabular-nums">{formatMoney(total)}</b>
        </p>
      )}
    </div>
  );
}
