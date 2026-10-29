import type { UiLocale } from '@pharmacy/shared-dto';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteLayout } from '@/app';
import { getSiteInfo } from '@/shared/api';
import { siteEnv } from '@/shared/config';
import { getTranslator, isLocale } from '@/shared/i18n';
import { pickText } from '@/shared/lib';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

// The build never asks the API: every page is rendered on its first request, then cached (spec 5).
export const generateStaticParams = () => [];

/** The site name from the settings; the i18n fallback when it is empty or the API fails (W2, W3). */
async function siteName(locale: UiLocale): Promise<string> {
  try {
    const name = pickText((await getSiteInfo()).settings.name, locale);
    if (name.trim()) return name;
  } catch {
    // the layout never fails: the page itself reports an unavailable API (error.tsx)
  }
  return getTranslator(locale)('brand.fallbackName');
}

export async function generateMetadata({
  params,
}: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const name = await siteName(locale);
  return {
    metadataBase: new URL(siteEnv().siteOrigin),
    title: { template: `%s — ${name}`, default: name },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <SiteLayout locale={locale}>{children}</SiteLayout>;
}
