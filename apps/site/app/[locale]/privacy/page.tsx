import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalPage, legalMetadata } from '@/pages/legal';
import { findSiteInfo } from '@/shared/api';
import { isLocale } from '@/shared/i18n';

export const revalidate = 60;

interface PrivacyRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: PrivacyRouteProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return legalMetadata('privacy', locale, await findSiteInfo());
}

// nothing published: 404; an unavailable API shows error.tsx (W2)
export default async function PrivacyRoute({ params }: PrivacyRouteProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <LegalPage kind="privacy" locale={locale} />;
}
