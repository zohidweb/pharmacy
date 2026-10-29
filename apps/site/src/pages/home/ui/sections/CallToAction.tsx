import type { UiLocale } from '@pharmacy/shared-dto';
import { buttonClassName } from '@pharmacy/ui';
import Link from 'next/link';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';

/** spec 6.2, п. 9: the request button once more, at the end of the page. */
export function CallToAction({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section aria-labelledby="cta-title" className="bg-primary text-on-primary">
      <div className="mx-auto flex w-full max-w-(--ph-size-dialog-xl) flex-col items-start gap-4 px-4 py-12">
        <h2 id="cta-title" className="text-2xl font-bold tracking-tight">
          {t('home.cta.title')}
        </h2>
        <p className="max-w-(--ph-size-dialog-lg)">{t('home.cta.text')}</p>
        <Link
          href={localePath(locale, '/connect')}
          className={buttonClassName({ variant: 'secondary', size: 'lg' })}
        >
          {t('nav.connect')}
        </Link>
      </div>
    </section>
  );
}
