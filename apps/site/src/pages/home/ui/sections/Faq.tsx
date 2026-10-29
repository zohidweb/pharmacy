import type { UiLocale } from '@pharmacy/shared-dto';
import { Icon } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { PageSection } from '@/shared/ui';

const QUESTIONS = [
  'browser',
  'hardware',
  'outage',
  'payment',
  'import',
  'cards',
] as const;

/** spec 6.2, п. 8: native <details> — opens without JavaScript, the answer stays in the HTML for search. */
export function Faq({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <PageSection id="faq" tone="surface" title={t('home.faq.title')}>
      <div className="flex max-w-(--ph-size-dialog-xl) flex-col divide-y divide-border border-y border-border">
        {QUESTIONS.map((key) => (
          <details key={key} className="group">
            <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold">
              {t(`home.faq.items.${key}.question`)}
              <span className="flex text-fg-muted transition-transform group-open:rotate-45">
                <Icon name="plus" size="sm" />
              </span>
            </summary>
            <p className="pb-4 text-fg-muted">
              {t(`home.faq.items.${key}.answer`)}
            </p>
          </details>
        ))}
      </div>
    </PageSection>
  );
}
