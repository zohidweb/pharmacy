import { notFound } from 'next/navigation';
import { getSiteInfo } from '@/shared/api';
import { getTranslator, isLocale } from '@/shared/i18n';
import { pickText } from '@/shared/lib';

export const revalidate = 60;

// Placeholder of the home page until its sections arrive (Task 3); it already reads the site
// settings, so an unavailable API shows error.tsx.
export default async function HomeRoute({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getTranslator(locale);
  const tagline = pickText((await getSiteInfo()).settings.tagline, locale);
  return (
    <main className="mx-auto flex max-w-(--ph-size-dialog-md) flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        {t('home.hero.title')}
      </h1>
      {tagline && <p className="text-fg-muted">{tagline}</p>}
    </main>
  );
}
