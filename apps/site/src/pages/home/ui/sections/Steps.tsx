/*
 * «Как подключиться» (spec 4.5, п. 6; R6): five steps from the request to the first sale. The verb is the heading of a
 * step, with no «Шаг 1»: the order is the list's own (<ol>). From 1024 px the steps stand in a row under a line that
 * fills while the pinned section scrolls by; below, a column with a vertical line (StepsProgress). The step the line has
 * reached is marked, the current one is mint.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { getTranslator } from '@/shared/i18n';
import { StepsProgress } from './StepsProgress';

// request → operator's call → network and activation code → catalog → first sale
const STEPS = ['request', 'call', 'activation', 'catalog', 'sale'] as const;

export function Steps({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section id="steps" aria-labelledby="steps-title" className="scroll-mt-4">
      <div className="mx-auto w-full max-w-(--ph-size-dialog-xl) px-4">
        <StepsProgress
          header={
            <header className="flex max-w-(--ph-size-dialog-lg) flex-col gap-4">
              <h2 id="steps-title" className="text-section text-balance">
                {t('home.steps.title')}
              </h2>
              <p className="text-lead text-fg-muted">
                {t('home.steps.subtitle')}
              </p>
            </header>
          }
        >
          <ol className="grid gap-8 md:grid-cols-5 md:gap-6">
            {STEPS.map((key) => (
              <li
                key={key}
                data-step=""
                className="group/step flex gap-5 md:flex-col md:gap-6"
              >
                {/* the line runs under the markers; the page colour inside keeps it from showing through */}
                <span
                  data-step-marker=""
                  aria-hidden="true"
                  className="relative mt-1 size-4 shrink-0 rounded-full border-2 border-fg-muted bg-bg group-data-reached/step:border-accent-site group-data-reached/step:bg-accent-site md:mt-0"
                />
                <div className="flex flex-col gap-2">
                  <h3 className="text-xl font-bold tracking-tight group-data-current/step:text-accent-site">
                    {t(`home.steps.items.${key}.title`)}
                  </h3>
                  <p className="text-md text-fg-muted">
                    {t(`home.steps.items.${key}.text`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </StepsProgress>
      </div>
    </section>
  );
}
