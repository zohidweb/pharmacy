/*
 * «Для кого» (spec 2026-11-04-public-site-home-polish, H2, H9.1): the heading on the left and the lead on the right as
 * one row on top (SplitHeader), under it the four pains in a single row of equally tall cards from 1024 px (a column on
 * a phone, the header too). No column stands empty under the heading. The pinned stack of the light-panels amendment
 * 4.4 is gone: the cards do not stick. The cards are a surface, a mint block, a surface and a dark block, each with its
 * large number on top and the title and text at the bottom. Spec H8.2 (amendment 2026-11-04), H9.1: each card comes
 * into place with the scroll, not at once: from 1024 px the first two slide in from the left and the last two from the
 * right (64 px, 3°, opacity 0.4), below that every card rises from 32 px (ScrollSlide, a client leaf: the card itself,
 * with its `data-surface`, stays here). The section clips sideways (`overflow-x-clip`): the slide never widens the
 * page.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { cx } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { contentClassName, panelBodyClassName } from '@/shared/ui';
import { ScrollSlide } from '@/shared/ui/motion';
import { SplitHeader } from './SplitHeader';

// expiry dates and batches, shortages, several stores, the till during outages
const PAINS: readonly {
  key: 'expiry' | 'shortages' | 'stores' | 'outages';
  /** The colour panel of the card; none means the light surface with a line. */
  surface?: 'mint' | 'dark';
}[] = [
  { key: 'expiry' },
  { key: 'shortages', surface: 'mint' },
  { key: 'stores' },
  { key: 'outages', surface: 'dark' },
];

export function Audience({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section
      id="audience"
      aria-labelledby="audience-title"
      className="scroll-mt-4 overflow-x-clip"
    >
      <div
        className={cx(
          contentClassName,
          panelBodyClassName,
          'flex flex-col gap-10 md:gap-16',
        )}
      >
        <SplitHeader
          id="audience-title"
          title={t('home.audience.title')}
          subtitle={t('home.audience.subtitle')}
        />
        {/* each card comes into place with the scroll (ScrollSlide): the first two from the left, the last two from
            the right */}
        <ul className="grid gap-4 md:grid-cols-4">
          {PAINS.map(({ key, surface }, index) => (
            // the item is the grid cell (it stretches to the row); the card inside carries the fill
            <ScrollSlide
              key={key}
              side={index < 2 ? 'left' : 'right'}
              className="flex"
            >
              <div
                data-surface={surface}
                className={cx(
                  'flex flex-1 flex-col gap-4 rounded-site-card p-6 lg:p-8',
                  !surface && 'border border-site-line bg-surface',
                )}
              >
                {/* decorative: the title names the pain */}
                <span
                  aria-hidden="true"
                  className="text-site-number text-accent-site"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="mt-auto flex flex-col gap-3">
                  <h3 className="text-2xl font-bold tracking-tight">
                    {t(`home.audience.items.${key}.title`)}
                  </h3>
                  <p className="text-lead text-fg-muted">
                    {t(`home.audience.items.${key}.text`)}
                  </p>
                </div>
              </div>
            </ScrollSlide>
          ))}
        </ul>
      </div>
    </section>
  );
}
