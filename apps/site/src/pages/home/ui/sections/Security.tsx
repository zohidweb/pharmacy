/*
 * Безопасность (spec 2026-11-04-public-site-home-polish, H5, H9.4; amendment 2026-11-02-public-site-light-panels 4.4,
 * п. 8, L10): a dark panel like «Как подключиться». The header is one row on top (SplitHeader: heading on the left, lead
 * on the right), under it the three benefits as cards in a single row from 1024 px, equally tall (a column on a phone):
 * an icon in a round chip, the benefit as the heading (24 px, Medium) and its explanation under it. A card is the raised
 * surface of the panel (`surface-sunken`, emerald-900) with the panel's line; secondary text on it is 6.3:1 and the mint
 * accent 5.9:1, both above AA. The cards appear one after another (RevealGroup).
 *
 * Three benefits for the owner instead of five technical statements; the technical detail lives in the explanations,
 * each true of the deployment (spec 4.8, without general denials):
 * - backups: nightly copies checked by a restore (ADR-0019);
 * - offsite: encrypted copies in a bucket in another data centre, US Central or Singapore while the server is in the
 *   EU (ADR-0020 amendment 2026-10-23); true only while BACKUP_OFFSITE_BUCKET is set in prod (launch checklist);
 * - roles: roles checked on the server (ADR-0018) and HTTPS on every connection (ADR-0012).
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { cx, Icon, type IconName } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import {
  contentClassName,
  panelBodyClassName,
  panelClassName,
} from '@/shared/ui';
import { RevealGroup, RevealItem } from '@/shared/ui/motion';
import { SplitHeader } from './SplitHeader';

const CLAIMS = [
  { key: 'backups', icon: 'refresh-cw' },
  { key: 'offsite', icon: 'key-round' },
  { key: 'roles', icon: 'user-check' },
] as const satisfies readonly { key: string; icon: IconName }[];

export function Security({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section
      id="security"
      aria-labelledby="security-title"
      data-surface="dark"
      className={cx(panelClassName, 'scroll-mt-4')}
    >
      <div
        className={cx(
          contentClassName,
          panelBodyClassName,
          'flex flex-col gap-10 md:gap-16',
        )}
      >
        <SplitHeader
          id="security-title"
          title={t('home.security.title')}
          subtitle={t('home.security.subtitle')}
        />
        <RevealGroup as="ul" className="grid gap-4 md:grid-cols-3">
          {CLAIMS.map(({ key, icon }) => (
            // the item is the card: a grid cell, so the cards of the row are equally tall
            <RevealItem
              key={key}
              as="li"
              className="flex flex-col gap-6 rounded-site-card border border-site-line bg-surface-sunken p-6 lg:p-8"
            >
              {/* the chip is the panel's colour: it stands out of the raised card */}
              <span className="flex size-avatar-md shrink-0 items-center justify-center rounded-full bg-bg text-accent-site">
                <Icon name={icon} size="lg" />
              </span>
              <div className="flex flex-col gap-3">
                <h3 className="text-2xl font-medium tracking-tight">
                  {t(`home.security.items.${key}.title`)}
                </h3>
                <p className="text-lead text-fg-muted">
                  {t(`home.security.items.${key}.text`)}
                </p>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
