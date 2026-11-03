/*
 * «Как подключиться» (amendment 2026-11-02-public-site-light-panels 4.4, п. 6; R6, L11): a dark panel, five steps from
 * the request to the first sale. The verb is the heading of a step, with no «Шаг 1»: the order is the list's own (<ol>).
 * From 1024 px the steps stand in a row under a line that fills while the pinned section scrolls by; below, a column with
 * a vertical line (StepsProgress). Over each step a large number: mint for the steps the line has reached, a faint mint
 * (decorative, not text) for those ahead; the heading of the current step is mint.
 *
 * Padding: the panel's own 48 px on a phone and 96 px from 1024 px with reduce (nothing pinned). The pinned frame from
 * 1024 px keeps 64 px instead (StepsProgress): it is one screen high and centres the steps, so its free height already
 * leaves 92 to 206 px above them (1024 × 768 to 1440 × 900, both languages), while 96 px would make the frame taller
 * than the screen under the header with the Tajik texts (1024 × 768, 1280 × 720) and cut its lower edge while pinned.
 * On a phone the marker sits in the middle of the 56 px number line (mt-5); the line starts under the first marker.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { cx } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { contentClassName, panelClassName } from '@/shared/ui';
import { StepsProgress } from './StepsProgress';

// request → operator's call → network and activation code → catalog → first sale
const STEPS = ['request', 'call', 'activation', 'catalog', 'sale'] as const;

export function Steps({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section
      id="steps"
      aria-labelledby="steps-title"
      data-surface="dark"
      className={cx(panelClassName, 'scroll-mt-4')}
    >
      <div className={contentClassName}>
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
                  className="relative mt-5 size-4 shrink-0 rounded-full border-2 border-fg-muted bg-bg group-data-reached/step:border-accent-site group-data-reached/step:bg-accent-site md:mt-0"
                />
                <div className="flex flex-col gap-2">
                  {/* decorative: the order is the list's own */}
                  <span
                    aria-hidden="true"
                    className="text-site-figure-sm text-site-step-future group-data-reached/step:text-accent-site md:text-site-figure"
                  >
                    {String(STEPS.indexOf(key) + 1).padStart(2, '0')}
                  </span>
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
