import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConnectPage, connectMetadata } from '@/pages/connect';
import { findSiteInfo, getSiteInfo } from '@/shared/api';
import { isLocale } from '@/shared/i18n';

export const revalidate = 60;

interface ConnectRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: ConnectRouteProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return connectMetadata(locale, await findSiteInfo());
}

// the body reads the settings and the privacy policy: an unavailable API shows error.tsx (W2)
export default async function ConnectRoute({ params }: ConnectRouteProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ConnectPage locale={locale} info={await getSiteInfo()} />;
}
