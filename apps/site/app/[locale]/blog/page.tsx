import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogPage, blogMetadata, blogPageNumber } from '@/pages/blog';
import { findSiteInfo } from '@/shared/api';
import { isLocale } from '@/shared/i18n';

// `?page` makes the list a per-request page (W7); without this the ISR route of the layout fails with
// DYNAMIC_SERVER_USAGE on `next start` (`next dev` does not show it). The API answers still come from the
// data cache: the `next: { revalidate: 60 }` of each fetch holds under force-dynamic (three `/blog` requests
// on `next start` within a minute — one request to the API for the list).
export const dynamic = 'force-dynamic';

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
