/*
 * Безопасность (spec 2026-11-04-public-site-home-polish, H5; amendment 2026-11-02-public-site-light-panels 4.4, п. 8,
 * L10): the «manifesto», no panel. Two columns from 1024 px, the heading with a short text on the left, rows between
 * lines on the right: the benefit is the row's heading (24 px, Medium) with its explanation under it, an icon in a
 * mint circle at the side.
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
import { contentClassName, panelBodyClassName } from '@/shared/ui';
import { RevealGroup, RevealItem } from '@/shared/ui/motion';

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
      className="scroll-mt-4"
    >
      <div
        className={cx(
          contentClassName,
          panelBodyClassName,
          'grid gap-10 md:grid-cols-site-aside md:gap-16',
        )}
      >
        <header className="flex flex-col gap-4 md:self-start">
          <h2 id="security-title" className="text-section text-balance">
            {t('home.security.title')}
          </h2>
          <p className="text-lead text-fg-muted">
            {t('home.security.subtitle')}
          </p>
        </header>
        <RevealGroup
          as="ul"
          className="flex flex-col divide-y divide-site-line"
        >
          {CLAIMS.map(({ key, icon }) => (
            <RevealItem
              key={key}
              as="li"
              className="flex gap-5 py-6 first:pt-0 last:pb-0 md:py-8 md:first:pt-0 md:last:pb-0"
            >
              <span className="flex size-avatar-md shrink-0 items-center justify-center rounded-full bg-surface-sunken text-accent-site">
                <Icon name={icon} size="lg" />
              </span>
              <div className="flex flex-col gap-2">
                <h3 className="text-2xl font-medium tracking-tight">
                  {t(`home.security.items.${key}.title`)}
                </h3>
                <p className="max-w-(--ph-size-dialog-md) text-lead text-fg-muted">
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
