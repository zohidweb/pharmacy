'use client';

import type {
  LegalDocumentDraft,
  LegalDocumentKind,
  LegalDocumentRevision,
  LegalDocumentsOverview,
  UiLocale,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  EmptyState,
  SegmentedControl,
  StatusPill,
  Tabs,
  TextField,
  useToast,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { siteKeys, useLegalDocuments } from '@/entities/site-content';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { useScrollIntoViewOnError } from '@/shared/lib';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { SiteMarkdownEditor } from '@/widgets/site-markdown-editor';

// The limits of the API (apps/api site-content, legal-documents.dto.ts).
const TITLE_MIN = 3;
const TITLE_MAX = 200;
const BODY_MAX = 200_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const kinds: readonly LegalDocumentKind[] = ['offer', 'privacy'];
const locales: readonly UiLocale[] = ['ru', 'tg'];

type Revision = Omit<LegalDocumentRevision, 'body'>;

interface Values {
  title: string;
  body: string;
  effectiveFrom: string;
}

const sameValues = (a: Values, b: Values): boolean =>
  a.title === b.title &&
  a.body === b.body &&
  a.effectiveFrom === b.effectiveFrom;

const editKey = (kind: LegalDocumentKind, locale: UiLocale): string =>
  `${kind}:${locale}`;

/**
 * The order of the API (`currentRevisions`): the latest day of entry into force first, then the latest publication,
 * then the id. The first of these whose day has come is the revision the site serves.
 */
const byForce = (a: Revision, b: Revision): number =>
  b.effectiveFrom.localeCompare(a.effectiveFrom) ||
  b.publishedAt.localeCompare(a.publishedAt) ||
  b.id.localeCompare(a.id);

/**
 * «Сайт → Документы» (spec 2026-10-28-public-site-design, S6): the offer and the privacy policy, one draft per
 * language. The draft is saved as it is and published as a new revision; a published revision is never changed.
 * The unsaved text of every tab is kept while the operator moves between tabs. The form has no `<form>`: the
 * picture dialog of the editor holds a form of its own.
 */
export function SiteDocumentsPage() {
  const t = useTranslations('siteDocuments');
  const overview = useLegalDocuments();
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 p-6">
        <QueryState query={overview}>
          {(data) => <Documents overview={data} />}
        </QueryState>
      </div>
    </>
  );
}

function Documents({ overview }: { overview: LegalDocumentsOverview }) {
  const t = useTranslations('siteDocuments');
  const tLocales = useTranslations('locales');
  const [kind, setKind] = useState<LegalDocumentKind>('offer');
  const [locale, setLocale] = useState<UiLocale>('ru');
  const [edits, setEdits] = useState<Partial<Record<string, Values>>>({});

  const setEdit = (
    editKind: LegalDocumentKind,
    editLocale: UiLocale,
    values: Values | undefined,
  ) => setEdits((all) => ({ ...all, [editKey(editKind, editLocale)]: values }));

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        label={t('kindLabel')}
        value={kind}
        onValueChange={setKind}
        items={kinds.map((value) => ({
          value,
          label: t(`kinds.${value}`),
          panel: (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedControl
                  label={t('localeLabel')}
                  value={locale}
                  onValueChange={setLocale}
                  options={locales.map((option) => ({
                    value: option,
                    label: option === 'tg' ? 'TJ' : 'RU',
                    ariaLabel: tLocales(option),
                  }))}
                />
                {locale === 'tg' && (
                  <p className="text-xs text-fg-subtle">{t('fallbackTg')}</p>
                )}
              </div>
              <DocumentEditor
                key={editKey(value, locale)}
                kind={value}
                locale={locale}
                draft={overview.drafts.find(
                  (item) => item.kind === value && item.locale === locale,
                )}
                revisions={overview.revisions
                  .filter(
                    (item) => item.kind === value && item.locale === locale,
                  )
                  .sort(byForce)}
                edit={edits[editKey(value, locale)]}
                onEdit={(values) => setEdit(value, locale, values)}
              />
            </div>
          ),
        }))}
      />
    </div>
  );
}

interface DocumentEditorProps {
  kind: LegalDocumentKind;
  locale: UiLocale;
  draft: LegalDocumentDraft | undefined;
  /** The published revisions of the kind and language, in the order of `byForce`. */
  revisions: Revision[];
  /** The unsaved text; `undefined` — nothing is changed. */
  edit: Values | undefined;
  onEdit: (values: Values | undefined) => void;
}

function DocumentEditor({
  kind,
  locale,
  draft,
  revisions,
  edit,
  onEdit,
}: DocumentEditorProps) {
  const t = useTranslations('siteDocuments');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = toAppDate();
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Without a draft the form starts from the title of the most recently published revision (not the one in force:
  // the next edition is usually an edit of what the operator published last).
  const lastPublished = revisions.reduce<Revision | undefined>(
    (latest, item) =>
      latest === undefined || item.publishedAt > latest.publishedAt
        ? item
        : latest,
    undefined,
  );
  const base: Values = draft
    ? {
        title: draft.title,
        body: draft.body,
        effectiveFrom: draft.effectiveFrom,
      }
    : { title: lastPublished?.title ?? '', body: '', effectiveFrom: today };
  const values = edit ?? base;
  const dirty = edit !== undefined && !sameValues(edit, base);
  const change = (patch: Partial<Values>) => {
    const next = { ...values, ...patch };
    onEdit(sameValues(next, base) ? undefined : next);
  };

  const trimmed = {
    title: values.title.trim(),
    body: values.body.trim(),
  };
  const problems = {
    title: trimmed.title.length < TITLE_MIN || trimmed.title.length > TITLE_MAX,
    body: trimmed.body === '' || trimmed.body.length > BODY_MAX,
    date: !DATE.test(values.effectiveFrom),
  };
  const valid = !problems.title && !problems.body && !problems.date;
  const params = { kind, locale };
  // What the form holds now: text typed while a save is in flight must not be thrown away by its answer.
  const live = useRef<Values>({
    ...trimmed,
    effectiveFrom: values.effectiveFrom,
  });
  live.current = { ...trimmed, effectiveFrom: values.effectiveFrom };

  const save = useMutation({
    mutationFn: (sent: Values) =>
      apiRequest('legalDocuments.saveDraft', { params, body: sent }),
    onSuccess: (saved, sent) => {
      queryClient.setQueryData<LegalDocumentsOverview>(
        siteKeys.legal,
        (old) =>
          old && {
            ...old,
            drafts: [
              ...old.drafts.filter(
                (item) => item.kind !== kind || item.locale !== locale,
              ),
              saved,
            ],
          },
      );
      if (sameValues(live.current, sent)) {
        onEdit(undefined);
        setTouched(false);
      }
      toast.show(t('saved'));
    },
  });

  const publish = useMutation({
    mutationFn: () => apiRequest('legalDocuments.publish', { params }),
    onSuccess: (revision) => {
      const known = revisions.some((item) => item.id === revision.id);
      const { body: _body, ...summary } = revision;
      queryClient.setQueryData<LegalDocumentsOverview>(
        siteKeys.legal,
        (old) =>
          old && {
            ...old,
            revisions: [
              summary,
              ...old.revisions.filter((item) => item.id !== revision.id),
            ],
          },
      );
      toast.show(known ? t('alreadyPublished') : t('published'));
    },
    // The dialog is done either way: an error is shown in the form, the draft stays as it is.
    onSettled: () => setConfirming(false),
  });

  const saveError = useApiErrorMessage(save.error);
  const publishError = useApiErrorMessage(publish.error);
  const apiError = publishError ?? saveError;
  // The error stands next to the buttons that caused it; the page may be scrolled to the text above.
  const errorRef = useScrollIntoViewOnError(publish.error ?? save.error);

  const onSave = () => {
    setTouched(true);
    if (!valid) return;
    publish.reset();
    save.mutate({
      title: trimmed.title,
      body: trimmed.body,
      effectiveFrom: values.effectiveFrom,
    });
  };

  const onPublish = () => {
    setTouched(true);
    if (draft === undefined || dirty || values.effectiveFrom < today) return;
    save.reset();
    setConfirming(true);
  };

  const datePast = values.effectiveFrom < today && !problems.date;
  // The draft is what the last published revision already says: publishing it again makes no new revision.
  const published =
    draft !== undefined &&
    lastPublished !== undefined &&
    draft.updatedAt <= lastPublished.publishedAt;
  const canPublish = draft !== undefined && !dirty && !published;

  const titleError = touched && problems.title ? t('errors.title') : undefined;
  const dateError = touched
    ? problems.date
      ? t('errors.date')
      : datePast
        ? t('errors.datePast')
        : undefined
    : undefined;
  const bodyError = touched && problems.body ? t('errors.body') : undefined;

  const columns: DataTableColumn<Revision>[] = [
    {
      key: 'title',
      header: t('revisions.columns.title'),
      cell: (row) => row.title,
    },
    {
      key: 'effectiveFrom',
      header: t('revisions.columns.effectiveFrom'),
      nowrap: true,
      cell: (row) => formatDateOnly(row.effectiveFrom),
    },
    {
      key: 'publishedAt',
      header: t('revisions.columns.publishedAt'),
      nowrap: true,
      cell: (row) => formatDateTime(row.publishedAt),
    },
    {
      key: 'status',
      header: t('revisions.columns.status'),
      nowrap: true,
      cell: (row) => {
        // The one in force: the first in the API's order whose day of entry into force has come (Dushanbe).
        const current = revisions.find((item) => item.effectiveFrom <= today);
        if (row.effectiveFrom > today)
          return (
            <StatusPill tone="info">
              {t('revisions.status.scheduled')}
            </StatusPill>
          );
        return row.id === current?.id ? (
          <StatusPill tone="success">
            {t('revisions.status.current')}
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">
            {t('revisions.status.replaced')}
          </StatusPill>
        );
      },
    },
  ];

  return (
    <>
      <Card
        as="section"
        aria-labelledby="draft-title"
        className="flex flex-col gap-4"
      >
        <CardHeader
          title={t('draftTitle')}
          titleId="draft-title"
          description={t('draftDescription')}
        />
        <div className="grid grid-cols-[1fr_auto] items-start gap-4">
          <TextField
            label={t('fields.title')}
            hint={t('fields.titleHint')}
            maxLength={TITLE_MAX}
            value={values.title}
            error={titleError}
            onChange={(event) => change({ title: event.target.value })}
          />
          <TextField
            label={t('fields.effectiveFrom')}
            hint={t('fields.effectiveFromHint')}
            type="date"
            value={values.effectiveFrom}
            error={dateError}
            onChange={(event) => change({ effectiveFrom: event.target.value })}
            className="w-(--ph-size-dialog-sm)"
          />
        </div>
        <SiteMarkdownEditor
          label={t('fields.body')}
          hint={t('fields.bodyHint')}
          error={bodyError}
          value={values.body}
          onChange={(body) => change({ body })}
        />
        {apiError && (
          <div ref={errorRef}>
            <Alert tone="danger" live="assertive">
              {apiError}
            </Alert>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            iconStart="check"
            variant="secondary"
            disabled={!dirty}
            loading={save.isPending}
            onClick={onSave}
          >
            {t('save')}
          </Button>
          <Button iconStart="globe" disabled={!canPublish} onClick={onPublish}>
            {t('publish')}
          </Button>
          <p className="text-xs text-fg-subtle">
            {canPublish
              ? t('publishHint')
              : published && !dirty
                ? t('alreadyPublished')
                : t('publishNeedsSave')}
          </p>
          <p className="ms-auto text-xs text-fg-subtle">
            {draft
              ? t('draftSavedAt', { at: formatDateTime(draft.updatedAt) })
              : t('noDraft')}
          </p>
        </div>
      </Card>

      <Card as="section" aria-labelledby="revisions-title" padding="none">
        <CardHeader
          inset
          title={t('revisions.title')}
          titleId="revisions-title"
          description={t('revisions.description')}
        />
        <DataTable
          caption={t('revisions.caption')}
          columns={columns}
          rows={revisions}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon="file-text"
              title={t('revisions.emptyTitle')}
              description={t('revisions.emptyDescription')}
            />
          }
        />
      </Card>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('confirm.title')}
        description={t('confirm.description', {
          title: draft?.title ?? '',
          date: formatDateOnly(draft?.effectiveFrom ?? today),
        })}
        closeLabel={tCommon('close')}
        icon="globe"
        tone="info"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setConfirming(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              loading={publish.isPending}
              onClick={() => publish.mutate()}
            >
              {t('confirm.confirm')}
            </Button>
          </>
        }
      />
    </>
  );
}
