import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticlePage, articleMetadata } from '@/pages/article';
import { findSiteInfo } from '@/shared/api';
import { isLocale } from '@/shared/i18n';

export const revalidate = 60;

// The build never asks the API: an article is rendered on its first request, then cached (spec 5).
export const generateStaticParams = () => [];

interface ArticleRouteProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({
  params,
}: ArticleRouteProps): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  return articleMetadata(locale, slug, await findSiteInfo());
}

// no article in this language — 404 (Review Focus 2); an unavailable API shows error.tsx (W2)
export default async function ArticleRoute({ params }: ArticleRouteProps) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  return <ArticlePage locale={locale} slug={slug} />;
}
