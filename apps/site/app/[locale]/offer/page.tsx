import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalPage, legalMetadata } from '@/pages/legal';
import { findSiteInfo } from '@/shared/api';
import { isLocale } from '@/shared/i18n';

export const revalidate = 60;

interface OfferRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: OfferRouteProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return legalMetadata('offer', locale, await findSiteInfo());
}

// nothing published: 404; an unavailable API shows error.tsx (W2)
export default async function OfferRoute({ params }: OfferRouteProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <LegalPage kind="offer" locale={locale} />;
}
