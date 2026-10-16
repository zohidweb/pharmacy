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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { DocumentStatusPill } from '@/entities/stock-document';
import { UnpostDialog, type StockAccess } from '@/features/stock-document';
import { apiFieldErrors, apiRequest, useApiErrorMessage } from '@/shared/api';
import { useBarcodeScanner } from '@/shared/lib/scanner';
import { FoundLineDialog } from './FoundLineDialog';

/**
 * Difference of a counted line: fact − (book − sold before the line was counted); what was sold
 * after it was counted is counted already (spec 2026-10-13-pos-shift-sale, K2). A found product —
 * its fact.
 */
export const lineDiff = (line: StockCountLine) =>
  line.factPieces === null
    ? null
    : line.factPieces - (line.bookPieces - line.soldBeforeCountPieces);

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
 * The entry field of a line, kept by the editor, not the row: a row hidden by a filter keeps it.
 * `sent` — the value sent last and not confirmed: sending the same value again reuses its key, so
 * a lost answer is not counted twice, whatever was typed in between (a scan into the focused
 * field); `failed` — that sending failed.
 */
interface PendingEntry {
  text: string;
  unit: 'pack' | 'piece';
  sent?: { key: string; text: string; unit: 'pack' | 'piece' };
  failed?: boolean;
}

/**
 * Counting on a tablet (spec 2026-10-12, S7): a scanned barcode finds the line, an entered quantity
 * is an entry «counted N» of this employee; the entries of every employee add up. Each entry keeps
 * its UUIDv7 until the server took it, so a retry after a lost answer does not count twice. A
 * leading minus is a correction of an entry counted too much.
 */
function EntryInput({
  docId,
  line,
  entry,
  onEntry,
  onSent,
  onFailed,
  focusRequest,
  onFocused,
  onCounted,
}: {
  docId: string;
  line: StockCountLine;
  /** The entry field of the line, kept by the editor. */
  entry: PendingEntry | undefined;
  onEntry: (lineId: string, entry: PendingEntry | null) => void;
  /** The server took the value sent with this key: the editor clears it if it is still that one. */
  onSent: (lineId: string, key: string) => void;
  onFailed: (lineId: string, key: string) => void;
  /** Set when a scan picked this line alone: its field takes the focus once. */
  focusRequest?: number;
  onFocused: () => void;
  onCounted: (line: StockCountLine) => void;
}) {
  const t = useTranslations('stockCounts.editor');
  const defaultUnit = line.piecesPerPack > 1 ? 'pack' : 'piece';
  const text = entry?.text ?? '';
  const unit = entry?.unit ?? defaultUnit;
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusRequest === undefined) return;
    field.current?.focus();
    onFocused();
  }, [focusRequest, onFocused]);
  const change = (next: Partial<Pick<PendingEntry, 'text' | 'unit'>>) => {
    const value: PendingEntry = {
      ...entry,
      text: next.text ?? text,
      unit: next.unit ?? unit,
    };
    // nothing typed, the default unit and nothing waiting for an answer: nothing to keep
    onEntry(
      line.lineId,
      value.text === '' && value.unit === defaultUnit && !value.sent
        ? null
        : value,
    );
  };
  const add = useMutation({
    mutationFn: (sent: { key: string; pieces: number }) =>
      apiRequest('stockCounts.addEntry', {
        params: { id: docId },
        body: { id: sent.key, lineId: line.lineId, pieces: sent.pieces },
      }),
    onSuccess: (updated, sent) => {
      onSent(line.lineId, sent.key);
      onCounted(updated);
    },
    onError: (_failure, sent) => onFailed(line.lineId, sent.key),
  });
  const value = /^-?\d+$/.test(text) ? Number(text) : null;
  const pieces =
    value === null
      ? null
      : unit === 'pack'
        ? value * line.piecesPerPack
        : value;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="w-cell-sm">
        <TextField
          ref={field}
          label={t('addOf', {
            name: line.productName,
            batch: line.batchNumber,
          })}
          hideLabel
          inputMode="numeric"
          autoComplete="off"
          value={text}
          error={entry?.failed ? t('notSent') : undefined}
          onChange={(event) =>
            // digits and one leading minus
            change({
              text: event.target.value
                .replace(/[^\d-]/g, '')
                .replace(/(?!^)-/g, ''),
            })
          }
        />
      </div>
      {line.piecesPerPack > 1 && (
        <Select
          label={t('unit')}
          hideLabel
          value={unit}
          onChange={(event) =>
            change({ unit: event.target.value as 'pack' | 'piece' })
          }
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
        onClick={() => {
          if (pieces === null) return;
          // the value sent before and not confirmed goes again with its key
          const key =
            entry?.sent && entry.sent.text === text && entry.sent.unit === unit
              ? entry.sent.key
              : uuidv7();
          onEntry(line.lineId, {
            text,
            unit,
            sent: { key, text, unit },
            failed: false,
          });
          add.mutate({ key, pieces });
        }}
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
  const current = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiRequest('stockCounts.get', { params: { id: document.id }, signal }),
    initialData: document,
  });
  const doc = current.data;
  // the entries of the other tablets: while the count runs (and the tab is visible) a light version
  // is polled, and the whole document — at 10 000 lines megabytes — is reloaded only when it changed
  const version = useQuery({
    queryKey: [...queryKey, 'version'],
    queryFn: ({ signal }) =>
      apiRequest('stockCounts.version', {
        params: { id: document.id },
        signal,
      }),
    enabled: doc.status === 'in_progress',
    refetchInterval: 10_000,
  });
  const seenVersion = useRef<string | null>(null);
  const latestVersion = version.data?.version ?? null;
  const reload = current.refetch;
  useEffect(() => {
    if (latestVersion === null) return;
    if (seenVersion.current !== null && seenVersion.current !== latestVersion) {
      void reload();
    }
    seenVersion.current = latestVersion;
  }, [latestVersion, reload]);
  // a poll in flight must not overwrite a fresh answer: an entry that disappears for a few
  // seconds would be entered again and counted twice
  const setDoc = (next: StockCount) => {
    void queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData(queryKey, next);
  };
  const setLine = (line: StockCountLine) => {
    void queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<StockCount>(queryKey, (current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((l) =>
              l.lineId === line.lineId ? line : l,
            ),
          }
        : current,
    );
  };

  const [comment, setComment] = useState(document.comment);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [filter, setFilter] = useState('');
  const [focused, setFocused] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [unposting, setUnposting] = useState(false);
  const [found, setFound] = useState<StockCountLine | 'new' | null>(null);
  const [scannedCode, setScannedCode] = useState<string | undefined>();
  const [focusLine, setFocusLine] = useState<{
    lineId: string;
    at: number;
  } | null>(null);
  // the entries typed and not taken yet, by line: they outlive a row hidden by a filter
  const [entries, setEntries] = useState<ReadonlyMap<string, PendingEntry>>(
    () => new Map(),
  );
  const setEntry = useCallback(
    (lineId: string, entry: PendingEntry | null) =>
      setEntries((current) => {
        const next = new Map(current);
        if (entry) next.set(lineId, entry);
        else next.delete(lineId);
        return next;
      }),
    [],
  );
  // The value sent is counted: the field empties, unless another value was typed meanwhile.
  const entrySent = useCallback(
    (lineId: string, key: string) =>
      setEntries((current) => {
        const entry = current.get(lineId);
        if (!entry?.sent || entry.sent.key !== key) return current;
        const counted =
          entry.text === entry.sent.text && entry.unit === entry.sent.unit;
        return new Map(current).set(lineId, {
          text: counted ? '' : entry.text,
          unit: entry.unit,
        });
      }),
    [],
  );
  const entryFailed = useCallback(
    (lineId: string, key: string) =>
      setEntries((current) => {
        const entry = current.get(lineId);
        if (!entry?.sent || entry.sent.key !== key) return current;
        return new Map(current).set(lineId, { ...entry, failed: true });
      }),
    [],
  );
  const focusDone = useCallback(() => setFocusLine(null), []);
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
  // The rows the server rejected at posting (lines.<index>.<field>), mapped by the lines as they
  // were sent: the 10-second refresh may reorder doc.lines afterwards.
  const [rejected, setRejected] = useState<
    ReadonlyMap<string, { field: string; code: string }>
  >(() => new Map());
  const post = useMutation({
    mutationFn: (_sent: readonly StockCountLine[]) =>
      apiRequest('stockCounts.post', { params: { id: doc.id } }),
    onMutate: () => setRejected(new Map()),
    onSuccess: (posted) => {
      setDoc(posted);
      setConfirm(false);
      void invalidate();
    },
    onError: (failure, sent) => {
      setConfirm(false);
      const next = new Map<string, { field: string; code: string }>();
      for (const e of apiFieldErrors(failure)) {
        const match = /^lines\.(\d+)\.(\w+)$/.exec(e.field);
        const line = match ? sent[Number(match[1])] : undefined;
        if (line && match)
          next.set(line.lineId, { field: match[2], code: e.code });
      }
      setRejected(next);
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

  // a scanned barcode shows its lines; an unknown one opens «найденный товар»
  useBarcodeScanner(
    (code) => {
      const lines = doc.lines.filter((l) => l.barcodes.includes(code));
      if (lines.length > 0) {
        setFocused(lines.map((l) => l.lineId));
        setFilter('');
        // one line: its quantity field is ready to type
        if (lines.length === 1 && editable) {
          setFocusLine({ lineId: lines[0].lineId, at: Date.now() });
        }
      } else if (editable) {
        // the search of «найденный товар» starts with the scanned code
        setScannedCode(code);
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
              {access.canSeeCost &&
                ` · ${diffMinor > 0 ? '+' : ''}${formatMoney(diffMinor)}`}
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
                onClick={() => {
                  setScannedCode(undefined);
                  setFound('new');
                }}
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
                      'soldAfter',
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
                            {problem.field !== 'counted'
                              ? t('foundIncomplete')
                              : problem.code === 'negative'
                                ? t('factNegative')
                                : t('factRequired')}
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
                          line.soldBeforeCountPieces,
                          line.piecesPerPack,
                          tCounts,
                        )}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-fg-muted">
                        {packsText(
                          line.soldAfterCountPieces,
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
                            entry={entries.get(line.lineId)}
                            onEntry={setEntry}
                            onSent={entrySent}
                            onFailed={entryFailed}
                            onFocused={focusDone}
                            focusRequest={
                              focusLine?.lineId === line.lineId
                                ? focusLine.at
                                : undefined
                            }
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
            <Button
              loading={post.isPending}
              onClick={() => post.mutate(doc.lines)}
            >
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
          scannedCode={found === 'new' ? scannedCode : undefined}
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
