import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HomePage, homeMetadata } from '@/pages/home';
import { findSiteInfo, getSiteInfo } from '@/shared/api';
import { isLocale } from '@/shared/i18n';

export const revalidate = 60;

interface HomeRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: HomeRouteProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return homeMetadata(locale, await findSiteInfo());
}

// the body reads the settings with getSiteInfo: an unavailable API shows error.tsx (W2)
export default async function HomeRoute({ params }: HomeRouteProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <HomePage locale={locale} info={await getSiteInfo()} />;
}
