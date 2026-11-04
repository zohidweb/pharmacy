/*
 * Вопросы и ответы (amendment 2026-11-02-public-site-light-panels 4.4, п. 9; R8): native <details>, each a card of its
 * own. A question opens by mouse, Enter or Space and without JavaScript; the answer stays in the HTML for search. The
 * answer opens by its height (`.site-accordion` in site-theme.css, at once with reduce or where the browser cannot),
 * the plus turns into a cross.
 *
 * Spec 2026-11-04-public-site-home-polish, H9.5: from 1024 px the left column holds the heading and, under it, a help card
 * («Не нашли ответ?», a line and the main button to the request form), so the column is no longer empty. The whole
 * column is pinned (nothing sticks with reduce). On a phone the order is the heading, the questions, then the card: the
 * column wrapper is `display: contents` there and `order` places its two children around the list.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { cx, Icon } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import { contentClassName, panelBodyClassName } from '@/shared/ui';
import { PressableLink } from '@/shared/ui/motion';

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
        <div className="contents md:flex md:flex-col md:gap-10 md:self-start md:motion-safe:sticky md:motion-safe:top-site-sticky">
          <h2 id="faq-title" className="text-section text-balance">
            {t('home.faq.title')}
          </h2>
          {/* after the questions on a phone (order), under the heading from 1024 px */}
          <div className="order-3 flex flex-col items-start gap-4 rounded-site-card border border-site-line bg-surface p-6 lg:p-8">
            <h3 className="text-2xl font-bold tracking-tight">
              {t('home.faq.help.title')}
            </h3>
            <p className="text-lead text-fg-muted">{t('home.faq.help.text')}</p>
            <PressableLink
              href={localePath(locale, '/connect')}
              variant="primary"
              size="lg"
              className="mt-2"
            >
              {t('nav.connect')}
            </PressableLink>
          </div>
        </div>
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
