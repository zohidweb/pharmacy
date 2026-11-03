/*
 * Вопросы и ответы (amendment 2026-11-02-public-site-light-panels 4.4, п. 9; R8): native <details>, each a card of its
 * own. The heading stays pinned on the left from 1024 px (nothing sticks with reduce). A question opens by mouse, Enter
 * or Space and without JavaScript; the answer stays in the HTML for search. The answer opens by its height
 * (`.site-accordion` in site-theme.css, at once with reduce or where the browser cannot), the plus turns into a cross.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { cx, Icon } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { contentClassName, panelBodyClassName } from '@/shared/ui';

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
      <div
        className={cx(
          contentClassName,
          panelBodyClassName,
          'grid gap-10 md:grid-cols-site-aside md:gap-16',
        )}
      >
        <h2
          id="faq-title"
          className="text-section text-balance md:self-start md:motion-safe:sticky md:motion-safe:top-site-sticky"
        >
          {t('home.faq.title')}
        </h2>
        <div className="flex flex-col gap-4">
          {QUESTIONS.map((key) => (
            <details
              key={key}
              className="site-accordion group/faq rounded-site-card border border-site-line bg-surface px-6 md:px-8"
            >
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
