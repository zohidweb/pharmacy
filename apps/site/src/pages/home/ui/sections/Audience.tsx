/*
 * «Для кого» (spec 2026-11-04-public-site-home-polish, H2): the heading on the left, the four pains on the right as a
 * plain 2 x 2 grid from 1024 px (one column on a phone). The pinned stack of the light-panels amendment 4.4 is gone:
 * the cards no longer stick: at 1440 px the four cards are about 700 px tall in all. The cards are a surface, a mint
 * block, a surface and a dark block, each with its large number on top and the title and text at the bottom; the cards
 * of a row are equally tall. Spec H8.2 (amendment 2026-11-04): each card comes into place with the scroll, not at once:
 * from 1024 px the left column slides in from the left and the right one from the right (64 px, 3°, opacity 0.4), below
 * that every card rises from 32 px (ScrollSlide, a client leaf: the card itself, with its `data-surface`, stays here).
 * The section clips sideways (`overflow-x-clip`): the slide never widens the page.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { cx } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { contentClassName, panelBodyClassName } from '@/shared/ui';
import { ScrollSlide } from '@/shared/ui/motion';

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
          'grid gap-10 md:grid-cols-site-aside md:gap-16',
        )}
      >
        <header className="flex flex-col gap-4 md:self-start">
          <h2 id="audience-title" className="text-section text-balance">
            {t('home.audience.title')}
          </h2>
          <p className="text-lead text-fg-muted">
            {t('home.audience.subtitle')}
          </p>
        </header>
        {/* each card comes into place with the scroll (ScrollSlide), the left column from the left, the right from the right */}
        <ul className="grid gap-4 md:grid-cols-2">
          {PAINS.map(({ key, surface }, index) => (
            // the item is the grid cell (it stretches to the row); the card inside carries the fill
            <ScrollSlide
              key={key}
              side={index % 2 === 0 ? 'left' : 'right'}
              className="flex"
            >
              <div
                data-surface={surface}
                className={cx(
                  'flex flex-1 flex-col gap-4 rounded-site-card p-6 md:p-8',
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
