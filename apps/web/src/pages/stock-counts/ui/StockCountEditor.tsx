'use client';

import type { StockCount, StockCountLine } from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  formatMoney,
  uuidv7,
} from '@pharmacy/shared-util';
import { Alert, Button, Dialog, Switch, TextField } from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { DocumentStatusPill } from '@/entities/stock-document';
import {
  QuantityInput,
  UnpostDialog,
  type StockAccess,
} from '@/features/stock-document';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

/** Difference of a line: fact − (book − sold since the start), pieces. */
export const lineDiff = (line: StockCountLine) =>
  line.factPieces === null
    ? null
    : line.factPieces - (line.bookPieces - line.soldSincePieces);

function packsText(
  pieces: number,
  perPack: number,
  t: ReturnType<typeof useTranslations<'stockCounts'>>,
) {
  const packs = Math.trunc(pieces / perPack);
  const rest = Math.abs(pieces % perPack);
  return rest > 0
    ? t('packsPieces', { packs, pieces: rest })
    : t('packs', { packs });
}

/** Stock count (UI mockup «Инвентаризация»): the POS keeps selling, sold-since is accounted. */
export function StockCountEditor({
  document,
  access,
  onClose,
}: {
  document: StockCount;
  access: StockAccess;
  onClose: () => void;
}) {
  const t = useTranslations('stockCounts.editor');
  const tCounts = useTranslations('stockCounts');
  const tDocs = useTranslations('stockDocs');
  const queryClient = useQueryClient();
  const [doc, setDoc] = useState(document);
  const [lines, setLines] = useState(document.lines);
  const [comment, setComment] = useState(document.comment);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const [unposting, setUnposting] = useState(false);
  const editable = doc.status === 'in_progress' && access.canUpdate;

  // a changed fact goes as an entry with the difference (the counting screen comes with Task 6)
  const persist = async () => {
    for (const line of lines) {
      const before =
        doc.lines.find((l) => l.lineId === line.lineId)?.factPieces ?? null;
      if (line.factPieces === null || line.factPieces === before) continue;
      await apiRequest('stockCounts.addEntry', {
        params: { id: doc.id },
        body: {
          id: uuidv7(),
          lineId: line.lineId,
          pieces: line.factPieces - (before ?? 0),
        },
      });
    }
    return apiRequest('stockCounts.save', {
      params: { id: doc.id },
      body: { comment: comment.trim() },
    });
  };
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] }),
      queryClient.invalidateQueries({ queryKey: ['stock'] }),
    ]);
  const save = useMutation({
    mutationFn: persist,
    onSuccess: (saved) => {
      setDoc(saved);
      void invalidate();
      onClose();
    },
  });
  const post = useMutation({
    mutationFn: async () => {
      await persist();
      return apiRequest('stockCounts.post', { params: { id: doc.id } });
    },
    onSuccess: (posted) => {
      setDoc(posted);
      setLines(posted.lines);
      setConfirm(false);
      void invalidate();
    },
  });
  const unpost = useMutation({
    mutationFn: () =>
      apiRequest('stockCounts.unpost', { params: { id: doc.id } }),
    onSuccess: (draft) => {
      setDoc(draft);
      setUnposting(false);
      void invalidate();
    },
  });
  const error = useApiErrorMessage(save.error ?? post.error);

  const diffs = lines.map(lineDiff);
  const surplus = diffs.filter((d) => d !== null && d > 0).length;
  const shortage = diffs.filter((d) => d !== null && d < 0).length;
  const diffMinor = lines.reduce(
    (sum, line, i) => sum + (diffs[i] ?? 0) * (line.pieceCostMinor ?? 0),
    0,
  );
  const missing = lines.filter((l) => l.factPieces === null).length;
  const shown = onlyDiff
    ? lines.filter((_, i) => (diffs[i] ?? 0) !== 0)
    : lines;

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={t('title', { number: doc.number })}
        description={`${doc.storeName} · ${formatDateTime(doc.startedAt)}`}
        closeLabel={tDocs('close')}
        size="xl"
        footer={
          <>
            <p className="me-auto text-sm" role="status">
              {t('summary', { surplus, shortage })}
              {access.canSeeCost && ` · ${formatMoney(diffMinor)}`}
            </p>
            {doc.status === 'posted' && access.canUnpost && (
              <Button
                variant="secondary"
                iconStart="undo-2"
                onClick={() => setUnposting(true)}
              >
                {tDocs('unpostAction')}
              </Button>
            )}
            {editable ? (
              <>
                <Button
                  variant="secondary"
                  loading={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {t('later')}
                </Button>
                {access.canPost && (
                  <Button
                    iconStart="check"
                    onClick={() => {
                      setTouched(true);
                      if (missing === 0) setConfirm(true);
                    }}
                  >
                    {tDocs('post')}
                  </Button>
                )}
              </>
            ) : (
              <Button variant="secondary" onClick={onClose}>
                {tDocs('close')}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <DocumentStatusPill status={doc.status} />
            <span className="text-sm text-fg-muted">
              {tCounts(`scopes.${doc.scope}`)}
              {doc.categoryName && ` · ${doc.categoryName}`}
            </span>
            <Switch
              label={t('onlyDiff')}
              checked={onlyDiff}
              onCheckedChange={setOnlyDiff}
              className="ms-auto"
            />
          </div>
          <Alert tone="info">{t('posHint')}</Alert>
          {touched && missing > 0 && (
            <Alert tone="warning">
              {t('factsRequired', { count: missing })}
            </Alert>
          )}
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-(--ph-size-table-md) border-collapse text-sm">
              <caption className="ph-visually-hidden">{t('caption')}</caption>
              <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
                <tr>
                  {(
                    [
                      'product',
                      'batch',
                      'book',
                      'sold',
                      'fact',
                      'diff',
                    ] as const
                  ).map((key) => (
                    <th
                      key={key}
                      scope="col"
                      className="px-2 py-2 text-start font-medium"
                    >
                      {t(`columns.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((line) => {
                  const diff = lineDiff(line);
                  return (
                    <tr
                      key={line.lineId}
                      className="border-b border-border align-top"
                    >
                      <td className="px-2 py-2 font-medium">
                        {line.productName}
                      </td>
                      <td className="px-2 py-2">
                        {line.batchNumber}
                        <span className="block text-xs text-fg-subtle">
                          {line.expiresOn
                            ? formatDateOnly(line.expiresOn)
                            : '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2 tabular-nums">
                        {packsText(
                          line.bookPieces,
                          line.piecesPerPack,
                          tCounts,
                        )}
                      </td>
                      <td className="px-2 py-2 tabular-nums">
                        {packsText(
                          line.soldSincePieces,
                          line.piecesPerPack,
                          tCounts,
                        )}
                      </td>
                      <td className="w-cell-md px-2 py-2">
                        <QuantityInput
                          label={t('factOf', {
                            name: line.productName,
                            batch: line.batchNumber,
                          })}
                          disabled={!editable}
                          value={line.factPieces}
                          invalid={
                            touched && line.factPieces === null
                              ? t('factRequired')
                              : undefined
                          }
                          onChange={(value) =>
                            setLines((current) =>
                              current.map((l) =>
                                l.lineId === line.lineId
                                  ? { ...l, factPieces: value }
                                  : l,
                              ),
                            )
                          }
                        />
                        <span className="text-xs text-fg-subtle">
                          {line.factPieces !== null
                            ? packsText(
                                line.factPieces,
                                line.piecesPerPack,
                                tCounts,
                              )
                            : t('piecesHint')}
                        </span>
                      </td>
                      <td className="px-2 py-2 tabular-nums">
                        {diff === null ? (
                          '—'
                        ) : diff === 0 ? (
                          <span className="text-success">{t('noDiff')}</span>
                        ) : (
                          <span
                            className={
                              diff > 0
                                ? 'font-bold text-success'
                                : 'font-bold text-danger'
                            }
                          >
                            {diff > 0
                              ? t('surplus', { count: diff })
                              : t('shortage', { count: -diff })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TextField
            label={t('comment')}
            placeholder={t('commentPlaceholder')}
            disabled={!editable}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
      </Dialog>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('confirmTitle')}
        closeLabel={tDocs('close')}
        icon="triangle-alert"
        tone="warning"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              {tDocs('cancel')}
            </Button>
            <Button loading={post.isPending} onClick={() => post.mutate()}>
              {tDocs('post')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('confirmText', { surplus, shortage })}</p>
      </Dialog>
      <UnpostDialog
        kind="stock-counts"
        id={unposting ? doc.id : null}
        number={doc.number}
        busy={unpost.isPending}
        error={unpost.error}
        onConfirm={() => unpost.mutate()}
        onClose={() => setUnposting(false)}
      />
    </>
  );
}
