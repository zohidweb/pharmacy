/*
 * «Для кого» (spec 4.5, п. 4): from 1024 px the heading stays pinned on the left while the four pains scroll by on the
 * right, each rising in as it enters. On a phone, and with reduce, nothing is pinned (Global Constraints).
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { Icon, type IconName } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { Reveal } from '@/shared/ui/motion';

// expiry dates and batches, shortages, several stores, the till during outages
const PAINS = [
  { key: 'expiry', icon: 'calendar-check' },
  { key: 'shortages', icon: 'clipboard-list' },
  { key: 'stores', icon: 'store' },
  { key: 'outages', icon: 'cloud-off' },
] as const satisfies readonly { key: string; icon: IconName }[];

export function Audience({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section
      id="audience"
      aria-labelledby="audience-title"
      className="scroll-mt-4"
    >
      <div className="mx-auto grid w-full max-w-site-content gap-10 px-4 md:px-8 py-16 md:grid-cols-site-aside md:gap-16">
        <header className="flex flex-col gap-4 md:self-start md:motion-safe:sticky md:motion-safe:top-site-sticky">
          <h2 id="audience-title" className="text-section text-balance">
            {t('home.audience.title')}
          </h2>
          <p className="text-lead text-fg-muted">
            {t('home.audience.subtitle')}
          </p>
        </header>
        <ul className="flex flex-col gap-4">
          {PAINS.map(({ key, icon }) => (
            <Reveal
              key={key}
              as="li"
              className="flex flex-col gap-4 rounded-site-card border border-site-line bg-surface p-6 md:p-8"
            >
              <span className="text-accent-site">
                <Icon name={icon} size="lg" />
              </span>
              <h3 className="text-2xl font-bold tracking-tight">
                {t(`home.audience.items.${key}.title`)}
              </h3>
              <p className="max-w-(--ph-size-dialog-md) text-lead text-fg-muted">
                {t(`home.audience.items.${key}.text`)}
              </p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
