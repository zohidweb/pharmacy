import type { UiLocale } from '@pharmacy/shared-dto';
import { getTranslator } from '@/shared/i18n';
import { PageSection } from '@/shared/ui';

// spec 6.2, п. 5: request → operator's call → network and activation code → catalog → first sale
const STEPS = ['request', 'call', 'activation', 'catalog', 'sale'] as const;

export function Steps({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <PageSection id="steps" title={t('home.steps.title')}>
      <ol className="grid gap-6 lg:grid-cols-5">
        {STEPS.map((key, index) => (
          <li key={key} className="flex gap-4 lg:flex-col">
            <span
              aria-hidden="true"
              className="flex size-avatar-sm shrink-0 items-center justify-center rounded-full bg-primary text-md font-bold text-on-primary tabular-nums"
            >
              {index + 1}
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="text-md font-semibold">
                {t(`home.steps.items.${key}.title`)}
              </h3>
              <p className="text-sm text-fg-muted">
                {t(`home.steps.items.${key}.text`)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </PageSection>
  );
}
