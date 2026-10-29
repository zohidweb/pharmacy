'use client';

import type {
  Article,
  ArticleStatus,
  ArticleTranslation,
  SaveArticleRequest,
  UiLocale,
} from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Dialog,
  Icon,
  SegmentedControl,
  Spinner,
  TextareaField,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  ArticleStatusPill,
  siteKeys,
  siteMediaContentUrl,
  useArticle,
} from '@/entities/site-content';
import { SiteMediaPickerDialog } from '@/features/site-media';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import {
  SLUG_MAX,
  SLUG_PATTERN,
  slugify,
  useScrollIntoViewOnError,
} from '@/shared/lib';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { SiteMarkdownEditor } from '@/widgets/site-markdown-editor';

// The limits of the API (apps/api site-content, dto/articles.dto.ts).
const TITLE_MIN = 3;
const TITLE_MAX = 150;
const EXCERPT_MAX = 300;
const BODY_MAX = 100_000;
const SEO_TITLE_MAX = 70;
const SEO_DESCRIPTION_MAX = 160;

const locales: readonly UiLocale[] = ['ru', 'tg'];

type Action = 'save' | 'publish' | 'unpublish' | 'archive';

const emptyTranslation: ArticleTranslation = {
  title: '',
  excerpt: '',
  body: '',
  seoTitle: '',
  seoDescription: '',
};

interface Values {
  /** The slug as the operator typed it; it counts only after the operator touched the field. */
  slug: string;
  coverMediaId: string | null;
  translations: Record<UiLocale, ArticleTranslation>;
}

const valuesOf = (article: Article | undefined): Values => ({
  slug: article?.slug ?? '',
  coverMediaId: article?.coverMediaId ?? null,
  translations: {
    ru: { ...emptyTranslation, ...article?.translations.ru },
    tg: { ...emptyTranslation, ...article?.translations.tg },
  },
});

const trimmed = (fields: ArticleTranslation): ArticleTranslation => ({
  title: fields.title.trim(),
  excerpt: fields.excerpt.trim(),
  body: fields.body.trim(),
  seoTitle: fields.seoTitle.trim(),
  seoDescription: fields.seoDescription.trim(),
});

const isBlank = (fields: ArticleTranslation): boolean =>
  Object.values(trimmed(fields)).every((value) => value === '');

/** The request body of a save: a language with nothing in it is left out (the API keeps what it has). */
function requestOf(slug: string, values: Values): SaveArticleRequest {
  const translations: SaveArticleRequest['translations'] = {};
  for (const locale of locales) {
    if (!isBlank(values.translations[locale]))
      translations[locale] = trimmed(values.translations[locale]);
  }
  return { slug, coverMediaId: values.coverMediaId, translations };
}

/** What the API would store: the comparison of the form with the saved article ignores the white space. */
const snapshotOf = (slug: string, values: Values): string =>
  JSON.stringify([
    slug,
    values.coverMediaId,
    trimmed(values.translations.ru),
    trimmed(values.translations.tg),
  ]);

interface Problems {
  title: boolean;
  body: boolean;
  /** A saved language emptied completely: the API keeps it, so it cannot be hidden this way. */
  cleared: boolean;
}

function problemsOf(
  fields: ArticleTranslation,
  required: boolean,
  hasSaved: boolean,
): Problems {
  const value = trimmed(fields);
  if (isBlank(fields))
    return { title: required, body: false, cleared: !required && hasSaved };
  return {
    title:
      [...value.title].length < TITLE_MIN || value.title.length > TITLE_MAX,
    body: value.body.length > BODY_MAX,
    cleared: false,
  };
}

const hintWith = (hint: string, counter: string) => `${hint} · ${counter}`;

/**
 * «Сайт → Статьи → статья»: the editor of one article of the public site, `/site/articles/edit?id=…` (a new
 * article without `id`; static export, ADR-0015). The form keeps what the operator typed: a conflict of the
 * optimistic lock (409 `version_conflict`) only shows its text, nothing is reset or read again over the form.
 */
export function SiteArticlePage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center text-primary">
          <Spinner size="xl" />
        </div>
      }
    >
      <SiteArticleView />
    </Suspense>
  );
}

function SiteArticleView() {
  const id = useSearchParams()?.get('id') ?? '';
  const article = useArticle(id);
  if (id === '') return <ArticleEditor article={undefined} />;
  // A copy kept in the cache may be older than the stored article: the editor starts from the fresh one only, or
  // its first save would meet a `version_conflict` of somebody else's work.
  if (article.isFetching && !article.isFetchedAfterMount) {
    return (
      <div className="grid place-items-center py-12 text-primary">
        <Spinner size="xl" />
      </div>
    );
  }
  return (
    <QueryState query={article}>
      {(data) => <ArticleEditor key={data.id} article={data} />}
    </QueryState>
  );
}

function ArticleEditor({ article }: { article: Article | undefined }) {
  const t = useTranslations('siteArticle');
  const tCommon = useTranslations('common');
  const tLocales = useTranslations('locales');
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  // The article the form started from. It is the version of the optimistic lock too: a refresh of the query
  // while the operator types must not move it, or the second save would overwrite another operator's work.
  const [saved, setSaved] = useState(article);
  const [form, setForm] = useState(() => valuesOf(article));
  const [slugTouched, setSlugTouched] = useState(
    () =>
      article !== undefined &&
      article.slug !== slugify(article.translations.ru?.title ?? ''),
  );
  const [locale, setLocale] = useState<UiLocale>('ru');
  const [touched, setTouched] = useState(false);
  const [picking, setPicking] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const status: ArticleStatus = saved?.status ?? 'draft';
  const archived = status === 'archived';
  const slugLocked = saved !== undefined && saved.publishedAt !== null;
  const slug = slugLocked
    ? saved.slug
    : slugTouched
      ? form.slug
      : slugify(form.translations.ru.title);

  const dirty =
    saved === undefined ||
    snapshotOf(slug, form) !== snapshotOf(saved.slug, valuesOf(saved));
  const canChangeStatus = saved !== undefined && !dirty;

  const problems: Record<UiLocale, Problems> = {
    ru: problemsOf(
      form.translations.ru,
      true,
      saved?.translations.ru !== undefined,
    ),
    tg: problemsOf(
      form.translations.tg,
      false,
      saved?.translations.tg !== undefined,
    ),
  };
  const slugProblem =
    !slugLocked && (!SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX);
  const firstProblem = locales.find(
    (item) =>
      problems[item].title || problems[item].body || problems[item].cleared,
  );
  const valid = firstProblem === undefined && !slugProblem;

  // What the form holds now and what the request in flight carries: text typed during a save must survive it.
  const current = useRef('');
  current.current = snapshotOf(slug, form);
  const sent = useRef('');

  const mutation = useMutation({
    mutationFn: (action: Action): Promise<Article> => {
      sent.current = snapshotOf(slug, form);
      if (action === 'save') {
        const body = requestOf(slug, form);
        return saved === undefined
          ? apiRequest('articles.create', { body })
          : apiRequest('articles.update', {
              params: { id: saved.id },
              body: { ...body, version: saved.version },
            });
      }
      // The buttons of a status change are off until the article is saved.
      const params = { id: saved?.id ?? '' };
      switch (action) {
        case 'publish':
          return apiRequest('articles.publish', { params });
        case 'unpublish':
          return apiRequest('articles.unpublish', { params });
        case 'archive':
          return apiRequest('articles.archive', { params });
      }
    },
    onSuccess: (next, action) => {
      const created = action === 'save' && saved === undefined;
      queryClient.setQueryData(siteKeys.article(next.id), next);
      void queryClient.invalidateQueries({ queryKey: siteKeys.articlesAll });
      setSaved(next);
      // The form shows the stored article unless the operator typed on after the request had left.
      if (current.current === sent.current) {
        setForm(valuesOf(next));
        setTouched(false);
      }
      toast.show(
        action === 'save'
          ? t(created ? 'created' : 'saved')
          : t(
              action === 'publish'
                ? 'published'
                : action === 'unpublish'
                  ? 'unpublished'
                  : 'archived',
            ),
      );
      // The next saves are PUTs with the version of the answer: the page of the created article.
      if (created) router.replace(routes.siteArticle(next.id));
    },
    // The dialog is done either way: an error is shown next to the buttons, the form stays as it is.
    onSettled: () => setArchiving(false),
  });

  const apiError = useApiErrorMessage(mutation.error);
  // The error stands next to the buttons that caused it; the page may be scrolled to the text above.
  const errorRef = useScrollIntoViewOnError(mutation.error);

  const pending = (action: Action) =>
    mutation.isPending && mutation.variables === action;

  const onSave = () => {
    setTouched(true);
    if (!valid) {
      if (firstProblem !== undefined) setLocale(firstProblem);
      return;
    }
    mutation.mutate('save');
  };

  const changeFields = (patch: Partial<ArticleTranslation>) =>
    setForm((all) => ({
      ...all,
      translations: {
        ...all.translations,
        [locale]: { ...all.translations[locale], ...patch },
      },
    }));

  const fields = form.translations[locale];
  const shown = touched ? problems[locale] : undefined;
  const titleError = shown?.cleared
    ? t('errors.cleared')
    : shown?.title
      ? t('errors.title')
      : undefined;
  const bodyError = shown?.body ? t('errors.body') : undefined;
  const slugError = touched && slugProblem ? t('errors.slug') : undefined;

  const title =
    saved === undefined
      ? t('titleNew')
      : saved.translations.ru?.title || t('titleFallback');

  return (
    <>
      <PageHeader title={title} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 p-6">
        <Link
          href={routes.siteArticles()}
          className="inline-flex items-center gap-1 self-start text-sm text-primary hover:text-primary-hover"
        >
          <Icon name="arrow-left" size="sm" />
          {t('back')}
        </Link>
        {archived && <Alert tone="info">{t('archivedNotice')}</Alert>}
        {/* No <form> on the page: the picture dialogs hold a form of their own. */}
        <div className="grid grid-cols-3 items-start gap-4">
          <Card as="section" className="col-span-2 flex flex-col gap-4">
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
                <p className="text-xs text-fg-subtle">{t('hideTg')}</p>
              )}
            </div>
            <fieldset
              disabled={archived}
              className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
              key={locale}
            >
              <TextField
                label={t('fields.title')}
                hint={t('fields.titleHint')}
                maxLength={TITLE_MAX}
                value={fields.title}
                error={titleError}
                onChange={(event) =>
                  changeFields({ title: event.target.value })
                }
              />
              <TextareaField
                label={t('fields.excerpt')}
                hint={hintWith(
                  t('fields.excerptHint'),
                  t('counter', {
                    count: fields.excerpt.length,
                    max: EXCERPT_MAX,
                  }),
                )}
                rows={3}
                maxLength={EXCERPT_MAX}
                value={fields.excerpt}
                onChange={(event) =>
                  changeFields({ excerpt: event.target.value })
                }
              />
              <SiteMarkdownEditor
                label={t('fields.body')}
                hint={t('fields.bodyHint')}
                error={bodyError}
                value={fields.body}
                onChange={(body) => changeFields({ body })}
              />
              <TextField
                label={t('fields.seoTitle')}
                hint={hintWith(
                  t('fields.seoTitleHint'),
                  t('counter', {
                    count: fields.seoTitle.length,
                    max: SEO_TITLE_MAX,
                  }),
                )}
                maxLength={SEO_TITLE_MAX}
                value={fields.seoTitle}
                onChange={(event) =>
                  changeFields({ seoTitle: event.target.value })
                }
              />
              <TextareaField
                label={t('fields.seoDescription')}
                hint={hintWith(
                  t('fields.seoDescriptionHint'),
                  t('counter', {
                    count: fields.seoDescription.length,
                    max: SEO_DESCRIPTION_MAX,
                  }),
                )}
                rows={3}
                maxLength={SEO_DESCRIPTION_MAX}
                value={fields.seoDescription}
                onChange={(event) =>
                  changeFields({ seoDescription: event.target.value })
                }
              />
            </fieldset>
          </Card>

          <div className="flex flex-col gap-4">
            <Card
              as="section"
              aria-labelledby="article-publication"
              className="flex flex-col gap-4"
            >
              <CardHeader
                title={t('status.title')}
                titleId="article-publication"
              />
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-fg-subtle">
                    {t('status.statusLabel')}
                  </span>
                  {saved === undefined ? (
                    <span>{t('status.notSaved')}</span>
                  ) : (
                    <ArticleStatusPill status={saved.status} />
                  )}
                </div>
                {saved?.publishedAt && (
                  <span className="text-xs text-fg-subtle">
                    {t('status.publishedAt', {
                      at: formatDateTime(saved.publishedAt),
                    })}
                  </span>
                )}
                {saved && (
                  <span className="text-xs text-fg-subtle">
                    {t('status.updatedAt', {
                      at: formatDateTime(saved.updatedAt),
                    })}
                  </span>
                )}
              </div>
              {apiError && (
                <div ref={errorRef}>
                  <Alert tone="danger" live="assertive">
                    {apiError}
                  </Alert>
                </div>
              )}
              {!archived && (
                <div className="flex flex-col items-start gap-3">
                  <Button
                    iconStart="check"
                    variant={dirty ? 'primary' : 'secondary'}
                    loading={pending('save')}
                    onClick={onSave}
                  >
                    {t('save')}
                  </Button>
                  {dirty && saved !== undefined && (
                    <p className="text-xs text-fg-subtle">{t('unsaved')}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    {status === 'published' ? (
                      <Button
                        iconStart="eye-off"
                        variant="secondary"
                        disabled={!canChangeStatus}
                        loading={pending('unpublish')}
                        onClick={() => mutation.mutate('unpublish')}
                      >
                        {t('unpublish')}
                      </Button>
                    ) : (
                      <Button
                        iconStart="globe"
                        variant={dirty ? 'secondary' : 'primary'}
                        disabled={!canChangeStatus}
                        loading={pending('publish')}
                        onClick={() => mutation.mutate('publish')}
                      >
                        {t('publish')}
                      </Button>
                    )}
                    {status === 'draft' && (
                      <Button
                        variant="tertiary"
                        disabled={!canChangeStatus}
                        onClick={() => {
                          mutation.reset();
                          setArchiving(true);
                        }}
                      >
                        {t('archive')}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-fg-subtle">
                    {canChangeStatus ? t('publishHint') : t('saveFirst')}
                  </p>
                </div>
              )}
            </Card>

            <Card
              as="section"
              aria-labelledby="article-address"
              className="flex flex-col gap-4"
            >
              <CardHeader title={t('slug.label')} titleId="article-address" />
              <TextField
                label={t('slug.label')}
                hideLabel
                mono
                hint={slugLocked ? t('slug.locked') : t('slug.hint')}
                maxLength={SLUG_MAX}
                value={slug}
                readOnly={slugLocked || archived}
                error={slugError}
                onChange={(event) => {
                  setSlugTouched(true);
                  setForm((all) => ({
                    ...all,
                    slug: event.target.value.toLowerCase(),
                  }));
                }}
              />
            </Card>

            <Card
              as="section"
              aria-labelledby="article-cover"
              className="flex flex-col gap-4"
            >
              <CardHeader title={t('cover.label')} titleId="article-cover" />
              {form.coverMediaId === null ? (
                <p className="text-sm text-fg-subtle">{t('cover.none')}</p>
              ) : (
                <img
                  src={siteMediaContentUrl(form.coverMediaId)}
                  alt=""
                  className="max-h-48 w-full rounded-md border border-border bg-surface-sunken object-contain"
                />
              )}
              {!archived && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    iconStart="image"
                    variant="secondary"
                    onClick={() => setPicking(true)}
                  >
                    {form.coverMediaId === null
                      ? t('cover.choose')
                      : t('cover.change')}
                  </Button>
                  {form.coverMediaId !== null && (
                    <Button
                      variant="tertiary"
                      onClick={() =>
                        setForm((all) => ({ ...all, coverMediaId: null }))
                      }
                    >
                      {t('cover.remove')}
                    </Button>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      <SiteMediaPickerDialog
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(media) => {
          setForm((all) => ({ ...all, coverMediaId: media.id }));
          setPicking(false);
        }}
      />

      <Dialog
        open={archiving}
        onClose={() => setArchiving(false)}
        title={t('confirmArchive.title')}
        description={t('confirmArchive.description', { title })}
        closeLabel={tCommon('close')}
        icon="triangle-alert"
        tone="warning"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setArchiving(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={pending('archive')}
              onClick={() => mutation.mutate('archive')}
            >
              {t('confirmArchive.confirm')}
            </Button>
          </>
        }
      />
    </>
  );
}
