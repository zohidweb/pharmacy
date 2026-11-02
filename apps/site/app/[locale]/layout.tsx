import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteLayout } from '@/app';
import { findSiteInfo, mediaPath } from '@/shared/api';
import { siteEnv } from '@/shared/config';
import { isLocale } from '@/shared/i18n';
import { siteNameOf } from '@/shared/seo';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

// The build never asks the API: every page is rendered on its first request, then cached (spec 5).
export const generateStaticParams = () => [];

export async function generateMetadata({
  params,
}: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  // the layout never fails: an unavailable API gives the fallback name, the page reports it (W2, W3)
  const info = await findSiteInfo();
  const name = siteNameOf(info, locale);
  const faviconId = info?.settings.faviconMediaId;
  return {
    metadataBase: new URL(siteEnv().siteOrigin),
    title: { template: `%s — ${name}`, default: name },
    ...(faviconId && { icons: { icon: mediaPath(faviconId) } }),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <SiteLayout locale={locale} info={await findSiteInfo()}>
      {children}
    </SiteLayout>
  );
}
