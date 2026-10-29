import type { UiLocale } from '@pharmacy/shared-dto';
import { Card, Icon, type IconName } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { PageSection } from '@/shared/ui';

/*
 * spec 6.2, п. 4 — only what works in the cloud pilot: no 1C export, no fiscalisation, no offline
 * stores (spec 2, anti-goals).
 */
const FEATURES = [
  { key: 'pos', icon: 'receipt' },
  { key: 'stock', icon: 'package' },
  { key: 'purchasing', icon: 'truck' },
  { key: 'pricing', icon: 'tag' },
  { key: 'transfers', icon: 'store' },
  { key: 'counts', icon: 'calculator' },
  { key: 'reports', icon: 'download' },
  { key: 'roles', icon: 'users' },
  { key: 'import', icon: 'upload' },
] as const satisfies readonly { key: string; icon: IconName }[];

export function Features({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <PageSection
      id="features"
      tone="surface"
      title={t('home.features.title')}
      subtitle={t('home.features.subtitle')}
    >
      <ul className="grid gap-4 @xl:max-lg:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ key, icon }) => (
          <li key={key} className="flex">
            <Card className="flex flex-1 flex-col gap-3">
              <span className="flex size-avatar-sm items-center justify-center rounded-full bg-primary-subtle text-primary">
                <Icon name={icon} size="md" />
              </span>
              <h3 className="text-md font-semibold">
                {t(`home.features.items.${key}.title`)}
              </h3>
              <p className="text-sm text-fg-muted">
                {t(`home.features.items.${key}.text`)}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </PageSection>
  );
}
