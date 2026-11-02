/*
 * First screen of the home page (spec 4.5, п. 2): text on the left, three product screens on the right; on a phone the
 * text comes first. It fills the viewport under the header (capped), so the heading and both buttons are seen without
 * scrolling. The entrance is CSS (`site-enter*`, R1): the largest paint does not wait for hydration, and without
 * JavaScript or with reduce everything is simply there.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import type { ReactNode } from 'react';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import { PressableLink } from '@/shared/ui/motion';
import { HeroShots } from './HeroShots';

export function Hero({
  locale,
  tagline,
}: {
  locale: UiLocale;
  tagline: string;
}) {
  const t = getTranslator(locale);
  return (
    <section
      aria-labelledby="hero-title"
      className="flex flex-col justify-center overflow-x-clip md:min-h-site-first-screen"
    >
      <div className="mx-auto grid w-full max-w-(--ph-size-dialog-xl) items-center gap-12 px-4 py-10 md:grid-cols-site-hero md:py-12">
        <div className="flex flex-col items-start gap-6">
          {/* the one small label of sections 1–3 (Global Constraints): the tagline the operator sets for the site */}
          {tagline && (
            <p className="site-enter text-sm font-semibold tracking-wide text-accent-site uppercase">
              {tagline}
            </p>
          )}
          <h1
            id="hero-title"
            className="text-display-sm text-balance md:text-display"
          >
            {/* line by line (R1); the accent is the same face in mint (4.2) */}
            {t.rich('home.hero.title', {
              line: (chunks: ReactNode) => (
                <span className="site-enter site-enter-delay-1 block">
                  {chunks}
                </span>
              ),
              accent: (chunks: ReactNode) => (
                <span className="site-enter site-enter-delay-2 block text-accent-site">
                  {chunks}
                </span>
              ),
            })}
          </h1>
          <p className="site-enter site-enter-delay-3 max-w-(--ph-size-dialog-md) text-lead text-fg-muted">
            {t('home.hero.subtitle')}
          </p>
          <div className="site-enter site-enter-delay-4 flex flex-wrap gap-3 pt-2">
            <PressableLink
              href={localePath(locale, '/connect')}
              variant="primary"
              size="lg"
            >
              {t('nav.connect')}
            </PressableLink>
            <PressableLink
              href={localePath(locale, '/tariffs')}
              variant="secondary"
              size="lg"
            >
              {t('home.hero.secondary')}
            </PressableLink>
          </div>
        </div>
        <HeroShots
          alts={{
            pos: t('home.hero.shots.pos'),
            stock: t('home.hero.shots.stock'),
            report: t('home.hero.shots.report'),
          }}
        />
      </div>
    </section>
  );
}
