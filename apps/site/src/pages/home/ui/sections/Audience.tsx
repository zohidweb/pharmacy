import type { UiLocale } from '@pharmacy/shared-dto';
import { Card } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { PageSection } from '@/shared/ui';

// spec 6.2, п. 3: expiry dates and batches, shortages, several stores, the till during outages
const PAINS = ['expiry', 'shortages', 'stores', 'outages'] as const;

export function Audience({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <PageSection
      id="audience"
      title={t('home.audience.title')}
      subtitle={t('home.audience.subtitle')}
    >
      <ul className="grid gap-4 @xl:grid-cols-2">
        {PAINS.map((key) => (
          <li key={key} className="flex">
            <Card className="flex flex-1 flex-col gap-2">
              <h3 className="text-md font-semibold">
                {t(`home.audience.items.${key}.title`)}
              </h3>
              <p className="text-sm text-fg-muted">
                {t(`home.audience.items.${key}.text`)}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </PageSection>
  );
}
