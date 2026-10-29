import type { UiLocale } from '@pharmacy/shared-dto';
import { buttonClassName } from '@pharmacy/ui';
import Link from 'next/link';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';

/** The POS screen of apps/web on its API mocks — synthetic data only (W12). */
const SCREENSHOT = { src: '/images/pos.png', width: 1280, height: 800 };

export function Hero({
  locale,
  tagline,
}: {
  locale: UiLocale;
  tagline: string;
}) {
  const t = getTranslator(locale);
  return (
    <section aria-labelledby="hero-title" className="bg-surface">
      <div className="mx-auto grid w-full max-w-(--ph-size-dialog-xl) items-center gap-10 px-4 py-12 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          {tagline && (
            <p className="text-sm font-semibold text-primary">{tagline}</p>
          )}
          <h1
            id="hero-title"
            className="text-2xl font-bold tracking-tight lg:text-3xl"
          >
            {t('home.hero.title')}
          </h1>
          <p className="text-md text-fg-muted">{t('home.hero.subtitle')}</p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={localePath(locale, '/connect')}
              className={buttonClassName({ size: 'lg' })}
            >
              {t('nav.connect')}
            </Link>
            <Link
              href={localePath(locale, '/tariffs')}
              className={buttonClassName({ variant: 'secondary', size: 'lg' })}
            >
              {t('home.hero.secondary')}
            </Link>
          </div>
        </div>
        {/* a plain <img>: no next/image on the site (ADR-0023) */}
        <img
          src={SCREENSHOT.src}
          width={SCREENSHOT.width}
          height={SCREENSHOT.height}
          alt={t('home.hero.screenshotAlt')}
          fetchPriority="high"
          className="h-auto w-full rounded-md border border-border shadow-xl"
        />
      </div>
    </section>
  );
}
