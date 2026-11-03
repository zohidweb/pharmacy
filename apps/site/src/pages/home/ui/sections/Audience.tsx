/*
 * «Для кого» (amendment 2026-11-02-public-site-light-panels 4.4, п. 4, L8): from 1024 px the heading stays pinned on the
 * left while the four pains pile up on the right: each card sticks 16 px lower than the one before it, so the next one
 * slides over the last. The cards are a surface, a mint block, a surface and a dark block, each with its large number.
 * On a phone, and with reduce, nothing sticks (a plain list); the cards still rise in as they enter. From 1024 px a card
 * keeps its minimum height (320 px) with reduce too: only the pinning is motion.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { cx } from '@pharmacy/ui';
import type { CSSProperties } from 'react';
import { getTranslator } from '@/shared/i18n';
import { contentClassName, panelBodyClassName } from '@/shared/ui';
import { Reveal } from '@/shared/ui/motion';

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

/** The card gives its place in the pile as `--ph-site-stack-index`; `top-site-stack` reads it (L8). */
function stackIndex(index: number): CSSProperties {
  return { '--ph-site-stack-index': index } as CSSProperties;
}

export function Audience({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section
      id="audience"
      aria-labelledby="audience-title"
      className="scroll-mt-4"
    >
      <div
        className={cx(
          contentClassName,
          panelBodyClassName,
          'grid gap-10 md:grid-cols-site-aside md:gap-16',
        )}
      >
        <header className="flex flex-col gap-4 md:self-start md:motion-safe:sticky md:motion-safe:top-site-sticky">
          <h2 id="audience-title" className="text-section text-balance">
            {t('home.audience.title')}
          </h2>
          <p className="text-lead text-fg-muted">
            {t('home.audience.subtitle')}
          </p>
        </header>
        <ul className="flex flex-col gap-4">
          {PAINS.map(({ key, surface }, index) => (
            <li
              key={key}
              style={stackIndex(index)}
              className="md:motion-safe:sticky md:motion-safe:top-site-stack"
            >
              <Reveal>
                <div
                  data-surface={surface}
                  className={cx(
                    'flex flex-col gap-4 rounded-site-card p-6 md:min-h-site-stack-card md:p-8',
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
                    <p className="max-w-(--ph-size-dialog-md) text-lead text-fg-muted">
                      {t(`home.audience.items.${key}.text`)}
                    </p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
