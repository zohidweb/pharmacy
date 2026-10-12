'use client';

import type {
  FoundLineInput,
  StockCount,
  StockCountLine,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  formatMoney,
  uuidv7,
} from '@pharmacy/shared-util';
import { Alert, Button, Dialog, Select, Switch, TextField } from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { DocumentStatusPill } from '@/entities/stock-document';
import {
  QuantityInput,
  UnpostDialog,
  type StockAccess,
} from '@/features/stock-document';
import { apiFieldErrors, apiRequest, useApiErrorMessage } from '@/shared/api';
import { useBarcodeScanner } from '@/shared/lib/scanner';
import { FoundLineDialog } from './FoundLineDialog';

/** Difference of a counted line: fact − (book − sold since the start); a found product — its fact. */
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

/**
 * Counting on a tablet (spec 2026-10-12, S7): a scanned barcode finds the line, an entered quantity
 * is an entry «counted N» of this employee; the entries of every employee add up. Each entry keeps
 * its UUIDv7 until the server took it, so a retry after a lost answer does not count twice.
 */
function EntryInput({
  docId,
  line,
  onCounted,
}: {
  docId: string;
  line: StockCountLine;
  onCounted: (line: StockCountLine) => void;
}) {
  const t = useTranslations('stockCounts.editor');
  const [value, setValue] = useState<number | null>(null);
  const [unit, setUnit] = useState<'pack' | 'piece'>(
    line.piecesPerPack > 1 ? 'pack' : 'piece',
  );
  const key = useRef<string | null>(null);
  const add = useMutation({
    mutationFn: (pieces: number) => {
      key.current ??= uuidv7();
      return apiRequest('stockCounts.addEntry', {
        params: { id: docId },
        body: { id: key.current, lineId: line.lineId, pieces },
      });
    },
    onSuccess: (updated) => {
      key.current = null;
      setValue(null);
      onCounted(updated);
    },
  });
  const pieces =
    value === null
      ? null
      : unit === 'pack'
        ? value * line.piecesPerPack
        : value;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="w-cell-sm">
        <QuantityInput
          label={t('addOf', {
            name: line.productName,
            batch: line.batchNumber,
          })}
          value={value}
          invalid={add.isError ? t('notSent') : undefined}
          onChange={(next) => {
            // another quantity is another entry: a new key
            key.current = null;
            setValue(next);
          }}
        />
      </div>
      {line.piecesPerPack > 1 && (
        <Select
          label={t('unit')}
          hideLabel
          value={unit}
          onChange={(event) => {
            key.current = null;
            setUnit(event.target.value as 'pack' | 'piece');
          }}
          options={[
            { value: 'pack', label: t('units.pack') },
            { value: 'piece', label: t('units.piece') },
          ]}
        />
      )}
      <Button
        variant="secondary"
        iconStart="plus"
        loading={add.isPending}
        disabled={pieces === null}
        onClick={() => pieces !== null && add.mutate(pieces)}
      >
        {t('add')}
      </Button>
    </div>
  );
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
  const queryKey = ['stock-counts', 'one', document.id];
  // the entries of the other tablets come with a periodic refetch while the count runs
  const current = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiRequest('stockCounts.get', { params: { id: document.id }, signal }),
    initialData: document,
    refetchInterval: (query) =>
      query.state.data?.status === 'in_progress' ? 10_000 : false,
  });
  const doc = current.data;
  const setDoc = (next: StockCount) => queryClient.setQueryData(queryKey, next);
  const setLine = (line: StockCountLine) =>
    setDoc({
      ...doc,
      lines: doc.lines.map((l) => (l.lineId === line.lineId ? line : l)),
    });

  const [comment, setComment] = useState(document.comment);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [filter, setFilter] = useState('');
  const [focused, setFocused] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [unposting, setUnposting] = useState(false);
  const [found, setFound] = useState<StockCountLine | 'new' | null>(null);
  const running = doc.status === 'in_progress';
  const editable = running && access.canUpdate;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] }),
      queryClient.invalidateQueries({ queryKey: ['stock'] }),
    ]);
  const saveComment = useMutation({
    mutationFn: () =>
      apiRequest('stockCounts.save', {
        params: { id: doc.id },
        body: { comment: comment.trim() },
      }),
    onSuccess: setDoc,
  });
  const removeEntry = useMutation({
    mutationFn: (entryId: string) =>
      apiRequest('stockCounts.deleteEntry', {
        params: { id: doc.id, entryId },
      }),
    onSuccess: setLine,
  });
  const saveFound = useMutation({
    mutationFn: (input: FoundLineInput) =>
      found && found !== 'new'
        ? apiRequest('stockCounts.updateFoundLine', {
            params: { id: doc.id, lineId: found.lineId },
            body: input,
          })
        : apiRequest('stockCounts.addFoundLine', {
            params: { id: doc.id },
            body: input,
          }),
    onSuccess: (next) => {
      setDoc(next);
      setFound(null);
    },
  });
  const removeFound = useMutation({
    mutationFn: (lineId: string) =>
      apiRequest('stockCounts.deleteFoundLine', {
        params: { id: doc.id, lineId },
      }),
    onSuccess: setDoc,
  });
  const post = useMutation({
    mutationFn: () =>
      apiRequest('stockCounts.post', { params: { id: doc.id } }),
    onSuccess: (posted) => {
      setDoc(posted);
      setConfirm(false);
      void invalidate();
    },
    onError: () => setConfirm(false),
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
  const cancel = useMutation({
    mutationFn: () =>
      apiRequest('stockCounts.cancel', { params: { id: doc.id } }),
    onSuccess: (cancelled) => {
      setDoc(cancelled);
      setCancelling(false);
      void invalidate();
    },
  });
  const error = useApiErrorMessage(
    post.error ??
      cancel.error ??
      removeEntry.error ??
      removeFound.error ??
      saveComment.error,
  );
  // the rows the server rejected at posting: lines.<index>.<field>
  const rejected = new Map<string, string>();
  for (const e of apiFieldErrors(post.error)) {
    const match = /^lines\.(\d+)\.(\w+)$/.exec(e.field);
    const line = match ? doc.lines[Number(match[1])] : undefined;
    if (line && match) rejected.set(line.lineId, match[2]);
  }

  // a scanned barcode shows its lines; an unknown one opens «найденный товар»
  useBarcodeScanner(
    (code) => {
      const lines = doc.lines.filter((l) => l.barcodes.includes(code));
      if (lines.length > 0) {
        setFocused(lines.map((l) => l.lineId));
        setFilter('');
      } else if (editable) {
        setFound('new');
      }
    },
    { enabled: editable && found === null },
  );

  const diffs = doc.lines.map(lineDiff);
  const surplus = diffs.filter((d) => d !== null && d > 0).length;
  const shortage = diffs.filter((d) => d !== null && d < 0).length;
  const diffMinor = doc.lines.reduce(
    (sum, line, i) => sum + (diffs[i] ?? 0) * (line.pieceCostMinor ?? 0),
    0,
  );
  const missing = doc.lines.filter((l) => !l.counted).length;
  const needle = filter.trim().toLocaleLowerCase('ru');
  const shown = doc.lines.filter(
    (line, i) =>
      (!focused || focused.includes(line.lineId)) &&
      (!needle || line.productName.toLocaleLowerCase('ru').includes(needle)) &&
      (!onlyDiff || (diffs[i] ?? 0) !== 0),
  );

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
            {running && access.canDelete && (
              <Button
                variant="secondary"
                iconStart="x"
                onClick={() => setCancelling(true)}
              >
                {t('cancelCount')}
              </Button>
            )}
            {doc.status === 'posted' && access.canUnpost && (
              <Button
                variant="secondary"
                iconStart="undo-2"
                onClick={() => setUnposting(true)}
              >
                {tDocs('unpostAction')}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              {tDocs('close')}
            </Button>
            {running && access.canPost && (
              <Button iconStart="check" onClick={() => setConfirm(true)}>
                {tDocs('post')}
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
            {doc.cancelledBy && (
              <span className="text-xs text-fg-subtle">
                {t('cancelledBy', { name: doc.cancelledBy.name })}
              </span>
            )}
            <Switch
              label={t('onlyDiff')}
              checked={onlyDiff}
              onCheckedChange={setOnlyDiff}
              className="ms-auto"
            />
          </div>
          {running && <Alert tone="info">{t('posHint')}</Alert>}
          {running && missing > 0 && (
            <p className="text-sm text-fg-muted">
              {t('notCounted', { count: missing })}
            </p>
          )}
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <TextField
                label={t('scanLabel')}
                type="search"
                placeholder={t('scanPlaceholder')}
                autoComplete="off"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setFocused(null);
                }}
              />
            </div>
            {focused && (
              <Button variant="tertiary" onClick={() => setFocused(null)}>
                {t('showAll')}
              </Button>
            )}
            {editable && (
              <Button
                variant="secondary"
                iconStart="plus"
                onClick={() => setFound('new')}
              >
                {t('addFound')}
              </Button>
            )}
          </div>
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
                  const problem = rejected.get(line.lineId);
                  return (
                    <tr
                      key={line.lineId}
                      className={
                        problem
                          ? 'border-b border-border bg-danger-subtle align-top'
                          : 'border-b border-border align-top'
                      }
                    >
                      <td className="px-2 py-2 font-medium">
                        {line.productName}
                        {line.isFound && (
                          <span className="block text-xs text-warning">
                            {t('foundTag')}
                          </span>
                        )}
                        {problem && (
                          <span className="block text-xs text-danger">
                            {problem === 'counted'
                              ? t('factRequired')
                              : t('foundIncomplete')}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {line.batchNumber || '—'}
                        <span className="block text-xs text-fg-subtle">
                          {line.expiresOn
                            ? formatDateOnly(line.expiresOn)
                            : '—'}
                        </span>
                        {line.isFound && editable && (
                          <span className="flex gap-1">
                            <Button
                              variant="tertiary"
                              onClick={() => setFound(line)}
                            >
                              {t('editFound')}
                            </Button>
                            {line.entries.length === 0 && (
                              <Button
                                variant="tertiary"
                                loading={removeFound.isPending}
                                onClick={() => removeFound.mutate(line.lineId)}
                              >
                                {t('removeFound')}
                              </Button>
                            )}
                          </span>
                        )}
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
                      <td className="px-2 py-2">
                        <span className="font-bold tabular-nums">
                          {line.factPieces === null
                            ? t('notCountedYet')
                            : packsText(
                                line.factPieces,
                                line.piecesPerPack,
                                tCounts,
                              )}
                        </span>
                        {line.entries.length > 0 && (
                          <ul
                            aria-label={t('entriesOf', {
                              name: line.productName,
                            })}
                            className="m-0 flex list-none flex-wrap gap-1 p-0 text-xs"
                          >
                            {line.entries.map((entry) => (
                              <li
                                key={entry.id}
                                className="flex items-center gap-1 rounded-sm bg-surface-sunken px-1"
                              >
                                {entry.pieces > 0 ? '+' : ''}
                                {entry.pieces} · {entry.byName}
                                {editable && (entry.mine || access.canPost) && (
                                  <button
                                    type="button"
                                    aria-label={t('removeEntry', {
                                      pieces: entry.pieces,
                                      name: entry.byName,
                                    })}
                                    className="min-h-touch px-1 text-danger"
                                    onClick={() => removeEntry.mutate(entry.id)}
                                  >
                                    ×
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {editable && (
                          <EntryInput
                            docId={doc.id}
                            line={line}
                            onCounted={setLine}
                          />
                        )}
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
            onBlur={() => {
              if (editable && comment.trim() !== doc.comment) {
                saveComment.mutate();
              }
            }}
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
        <p className="text-sm">
          {missing > 0
            ? t('factsRequired', { count: missing })
            : t('confirmText', { surplus, shortage })}
        </p>
      </Dialog>
      <Dialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={t('cancelTitle')}
        closeLabel={tDocs('close')}
        icon="triangle-alert"
        tone="warning"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              {tDocs('cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {t('cancelCount')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('cancelText')}</p>
      </Dialog>
      {found !== null && (
        <FoundLineDialog
          storeId={doc.storeId}
          line={found === 'new' ? null : found}
          canSeeCost={access.canSeeCost}
          busy={saveFound.isPending}
          error={saveFound.error}
          onSave={(input) => saveFound.mutate(input)}
          onClose={() => {
            saveFound.reset();
            setFound(null);
          }}
        />
      )}
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
