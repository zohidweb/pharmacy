/*
 * Вопросы и ответы (spec 4.5, п. 9; R8): native <details>. A question opens by mouse, Enter or Space and without
 * JavaScript; the answer stays in the HTML for search. One line between the questions; the answer opens by its height
 * (`.site-accordion` in site-theme.css, at once with reduce or where the browser cannot), the plus turns into a cross.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { Icon } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';

const QUESTIONS = [
  'browser',
  'hardware',
  'outage',
  'payment',
  'import',
  'cards',
] as const;

export function Faq({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-4">
      <div className="mx-auto flex w-full max-w-site-content flex-col gap-10 px-4 md:px-8 py-16">
        <h2 id="faq-title" className="text-section text-balance">
          {t('home.faq.title')}
        </h2>
        <div className="flex flex-col divide-y divide-site-line border-y border-site-line">
          {QUESTIONS.map((key) => (
            <details key={key} className="site-accordion group/faq">
              <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-6 py-6 text-xl font-bold tracking-tight">
                {t(`home.faq.items.${key}.question`)}
                <span className="flex size-avatar-sm shrink-0 items-center justify-center rounded-full border border-site-line text-accent-site transition-transform duration-(--ph-duration-slow) ease-out group-open/faq:rotate-45">
                  <Icon name="plus" size="md" />
                </span>
              </summary>
              {/* an answer longer than one paragraph (25 words) keeps its paragraphs apart by a blank line */}
              <div className="flex max-w-(--ph-size-dialog-md) flex-col gap-3 pb-6 text-lead text-fg-muted">
                {t(`home.faq.items.${key}.answer`)
                  .split('\n\n')
                  .map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
