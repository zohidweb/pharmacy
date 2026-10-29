import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogPage, blogMetadata, blogPageNumber } from '@/pages/blog';
import { findSiteInfo } from '@/shared/api';
import { isLocale } from '@/shared/i18n';

// rendered per request because of `?page`, but the API answer comes from the data cache (W7)
export const revalidate = 60;

interface BlogRouteProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
  searchParams,
}: BlogRouteProps): Promise<Metadata> {
  const { locale } = await params;
  const page = blogPageNumber((await searchParams).page);
  if (!isLocale(locale) || page === null) return {};
  return blogMetadata(locale, page, await findSiteInfo());
}

// an unavailable API shows error.tsx (W2); `?page=abc` and a page past the last one — 404
export default async function BlogRoute({
  params,
  searchParams,
}: BlogRouteProps) {
  const { locale } = await params;
  const page = blogPageNumber((await searchParams).page);
  if (!isLocale(locale) || page === null) notFound();
  return <BlogPage locale={locale} page={page} />;
}
