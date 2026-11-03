/*
 * The final call (spec 4.5, п. 10): the colour block across the page, a large heading and the same button as in the
 * header and on the first screen, «Оставить заявку» (one label for one action). On the block the text is the main text
 * colour; mint is only the fill of the button (site-theme.css).
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import { PressableLink, Reveal } from '@/shared/ui/motion';

export function CallToAction({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section
      aria-labelledby="cta-title"
      data-surface="green"
      className="text-fg"
    >
      <Reveal className="mx-auto flex w-full max-w-site-content flex-col items-start gap-8 px-4 md:px-8 py-16 md:flex-row md:items-end md:justify-between md:gap-16">
        <div className="flex max-w-(--ph-size-dialog-lg) flex-col gap-4">
          <h2 id="cta-title" className="text-section text-balance">
            {t('home.cta.title')}
          </h2>
          <p className="max-w-(--ph-size-dialog-md) text-lead">
            {t('home.cta.text')}
          </p>
        </div>
        <PressableLink
          href={localePath(locale, '/connect')}
          variant="primary"
          size="lg"
          className="shrink-0"
        >
          {t('nav.connect')}
        </PressableLink>
      </Reveal>
    </section>
  );
}
