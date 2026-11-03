/*
 * The final call (amendment 2026-11-02-public-site-light-panels 4.4, п. 10): a mint panel, a large heading and the same
 * button as in the header and on the first screen, «Оставить заявку» (one label for one action). On the mint panel the
 * kit's primary button is dark (emerald-950 with mint-50 text), as the amendment asks (site-theme.css).
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { cx } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import {
  contentClassName,
  panelBodyClassName,
  panelClassName,
} from '@/shared/ui';
import { PressableLink, Reveal } from '@/shared/ui/motion';

export function CallToAction({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section
      aria-labelledby="cta-title"
      data-surface="mint"
      className={panelClassName}
    >
      <Reveal
        className={cx(
          contentClassName,
          panelBodyClassName,
          'flex flex-col items-start gap-8 md:flex-row md:items-end md:justify-between md:gap-16',
        )}
      >
        <div className="flex max-w-(--ph-size-dialog-lg) flex-col gap-4">
          <h2
            id="cta-title"
            className="text-display-sm text-balance md:text-display"
          >
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
