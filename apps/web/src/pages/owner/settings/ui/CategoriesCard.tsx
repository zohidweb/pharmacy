'use client';

import type { Category, CategoryInput } from '@pharmacy/shared-dto';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Dialog,
  StatusPill,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { canWrite, useSession } from '@/entities/session';
import { apiFieldErrors, apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';

/** Everything a change of the categories touches: lists, selects of the card, markups. */
const STALE_KEYS = [['catalog'], ['settings', 'markups']] as const;

/**
 * Categories of the network (spec 2026-10-07-catalog-pricing, section 8): add, rename RU/TJ,
 * archive (only without active products) and restore.
 */
export function CategoriesCard() {
  const t = useTranslations('settings.categories');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const editable = canWrite(session, 'catalog:update');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const categories = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: ({ signal }) => apiRequest('catalog.categories', { signal }),
  });
  const setStatus = useMutation({
    mutationFn: (category: Category) =>
      apiRequest('catalog.categoryStatus', {
        params: { id: category.id },
        body: { status: category.status === 'active' ? 'archived' : 'active' },
      }),
    onSuccess: () => {
      for (const queryKey of STALE_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.show(t('saved'));
    },
  });
  const error = useApiErrorMessage(setStatus.error);

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader
        title={t('title')}
        description={t('hint')}
        actions={
          editable ? (
            <Button
              variant="secondary"
              iconStart="plus"
              onClick={() => setEditing('new')}
            >
              {t('add')}
            </Button>
          ) : undefined
        }
      />
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <QueryState query={categories}>
        {(rows) => (
          <table className="w-full border-collapse text-sm">
            <caption className="ph-visually-hidden">{t('title')}</caption>
            <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('name')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-medium">
                  {t('markup')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-medium">
                  {t('products')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-medium">
                  <span className="ph-visually-hidden">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((category) => (
                <tr key={category.id} className="border-b border-border">
                  <th scope="row" className="px-2 py-2 text-start font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {category.nameRu || category.nameTj}
                      {category.status === 'archived' && (
                        <StatusPill tone="neutral">{t('archived')}</StatusPill>
                      )}
                    </span>
                    {category.nameRu && category.nameTj && (
                      <span
                        lang="tg"
                        className="block text-xs font-normal text-fg-subtle"
                      >
                        {category.nameTj}
                      </span>
                    )}
                  </th>
                  <td className="px-2 py-2 text-end tabular-nums">
                    {category.markupPercent === null
                      ? '—'
                      : `${category.markupPercent} %`}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">
                    {category.products}
                  </td>
                  <td className="px-2 py-2">
                    {editable && (
                      <span className="flex justify-end gap-2">
                        <Button
                          variant="tertiary"
                          onClick={() => setEditing(category)}
                        >
                          {t('rename')}
                        </Button>
                        <Button
                          variant="tertiary"
                          loading={
                            setStatus.isPending &&
                            setStatus.variables?.id === category.id
                          }
                          onClick={() => setStatus.mutate(category)}
                        >
                          {t(
                            category.status === 'active'
                              ? 'archive'
                              : 'restore',
                          )}
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
      {editing !== null && (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function CategoryDialog({
  category,
  onClose,
}: {
  category: Category | null;
  onClose: () => void;
}) {
  const t = useTranslations('settings.categories');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CategoryInput>({
    nameRu: category?.nameRu ?? '',
    nameTj: category?.nameTj ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      category === null
        ? apiRequest('catalog.createCategory', { body: draft })
        : apiRequest('catalog.updateCategory', {
            params: { id: category.id },
            body: draft,
          }),
    onSuccess: () => {
      for (const queryKey of STALE_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.show(t('saved'));
      onClose();
    },
  });
  const error = useApiErrorMessage(save.error);
  const fieldError = (field: keyof CategoryInput) => {
    const code = apiFieldErrors(save.error).find(
      (e) => e.field === field,
    )?.code;
    if (code === undefined) return undefined;
    return code === 'category_name_taken' ? t('nameTaken') : t('nameRequired');
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(category === null ? 'newTitle' : 'editTitle')}
      closeLabel={t('cancel')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!draft.nameRu.trim() && !draft.nameTj.trim()}
            onClick={() => save.mutate()}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && !fieldError('nameRu') && !fieldError('nameTj') && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <TextField
          label={t('nameRu')}
          value={draft.nameRu}
          maxLength={100}
          error={fieldError('nameRu')}
          onChange={(event) =>
            setDraft((d) => ({ ...d, nameRu: event.target.value }))
          }
        />
        <TextField
          label={t('nameTj')}
          lang="tg"
          value={draft.nameTj}
          maxLength={100}
          error={fieldError('nameTj')}
          onChange={(event) =>
            setDraft((d) => ({ ...d, nameTj: event.target.value }))
          }
        />
      </div>
    </Dialog>
  );
}
