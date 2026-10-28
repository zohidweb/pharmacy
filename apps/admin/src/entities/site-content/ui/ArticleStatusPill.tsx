'use client';

import type { ArticleStatus } from '@pharmacy/shared-dto';
import { StatusPill, type StatusTone } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

const tone: Record<ArticleStatus, StatusTone> = {
  draft: 'neutral',
  published: 'success',
  unpublished: 'warning',
  archived: 'neutral',
};

/** The status of an article of the public site. */
export function ArticleStatusPill({ status }: { status: ArticleStatus }) {
  const t = useTranslations('site.status');
  return <StatusPill tone={tone[status]}>{t(status)}</StatusPill>;
}
