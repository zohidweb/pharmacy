import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TariffsPage, tariffsMetadata } from '@/pages/tariffs';
import { findSiteInfo, getSiteInfo } from '@/shared/api';
import { isLocale } from '@/shared/i18n';

export const revalidate = 60;

interface TariffsRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: TariffsRouteProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return tariffsMetadata(locale, await findSiteInfo());
}

// the body reads the tariffs with getSiteInfo: an unavailable API shows error.tsx (W2)
export default async function TariffsRoute({ params }: TariffsRouteProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <TariffsPage locale={locale} info={await getSiteInfo()} />;
}
