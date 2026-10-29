import type { UiLocale } from '@pharmacy/shared-dto';
import { Icon } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { PageSection } from '@/shared/ui';

/*
 * spec 6.2, п. 7 — exactly these five statements, each true of the deployment: own server (ADR-0020),
 * nightly copies checked by a restore (ADR-0019), encrypted copies off the host (ADR-0020 amendment),
 * HTTPS (ADR-0012), roles checked on the server (ADR-0018).
 */
const CLAIMS = ['server', 'backups', 'offsite', 'https', 'roles'] as const;

export function Security({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <PageSection id="security" title={t('home.security.title')}>
      <ul className="grid gap-6 @xl:max-lg:grid-cols-2 lg:grid-cols-3">
        {CLAIMS.map((key) => (
          <li key={key} className="flex gap-3">
            <span className="flex size-avatar-sm shrink-0 items-center justify-center rounded-full bg-success-subtle text-success">
              <Icon name="check" size="md" />
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="text-md font-semibold">
                {t(`home.security.items.${key}.title`)}
              </h3>
              <p className="text-sm text-fg-muted">
                {t(`home.security.items.${key}.text`)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </PageSection>
  );
}
