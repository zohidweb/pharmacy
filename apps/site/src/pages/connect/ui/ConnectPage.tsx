/*
 * «Оставить заявку» (spec 6.4, W11; redesign 4.6). The server part checks the privacy policy the visitor consents to
 * (the page's language, the API falls back to RU: the same check the API makes on submit). With it, two columns from
 * 1024 px: on the left what happens after the request (three points) on a dark panel, on the right the form on the
 * surface of the light page. None published: «Приём заявок скоро откроется» and the contacts from the settings instead
 * of the form.
 * No `motion` on this page: the heading and the «Заявка принята» screen rise in by CSS.
 */
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { Icon, type IconName } from '@pharmacy/ui';
import { ConnectionRequestForm } from '@/features/connection-request';
import { getLegalDocument } from '@/shared/api';
import { getMessages, getTranslator } from '@/shared/i18n';
import { pickText } from '@/shared/lib';
import {
  pageClassName,
  pageHeaderClassName,
  pageLeadClassName,
  pageTitleClassName,
} from '@/shared/ui';

export interface ConnectPageProps {
  locale: UiLocale;
  info: PublicSiteInfo;
}

const linkClass =
  'font-semibold text-accent-site transition-colors hover:text-primary-hover hover:underline';

/** What happens after the request, in its order: the call, the network with its code, the first sale. */
const NEXT_STEPS: readonly {
  key: 'call' | 'activation' | 'start';
  icon: IconName;
}[] = [
  { key: 'call', icon: 'clock' },
  { key: 'activation', icon: 'key-round' },
  { key: 'start', icon: 'receipt' },
];

function NextSteps({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section
      aria-labelledby="request-next"
      data-surface="dark"
      className="flex flex-col gap-8 rounded-site-panel p-6 md:p-10"
    >
      <h2 id="request-next" className="text-section text-balance">
        {t('connect.next.title')}
      </h2>
      <ol className="flex flex-col divide-y divide-site-line border-y border-site-line">
        {NEXT_STEPS.map(({ key, icon }) => (
          <li key={key} className="flex gap-4 py-6">
            <span className="flex size-avatar-sm shrink-0 items-center justify-center rounded-full border border-site-line text-accent-site">
              <Icon name={icon} size="md" />
            </span>
            <div className="flex flex-col gap-2">
              <h3 className="text-xl font-bold tracking-tight">
                {t(`connect.next.items.${key}.title`)}
              </h3>
              <p className="text-lead text-fg-muted">
                {t(`connect.next.items.${key}.text`)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ClosedForm({ locale, info }: ConnectPageProps) {
  const t = getTranslator(locale);
  const phone = info.settings.phone.trim();
  const email = info.settings.email.trim();
  const hours = pickText(info.settings.workingHours, locale).trim();
  const hasContacts = Boolean(phone || email);
  return (
    <section
      aria-labelledby="request-closed"
      className="flex max-w-(--ph-size-dialog-lg) flex-col gap-6 rounded-site-card border border-site-line bg-surface p-6 md:p-10"
    >
      <h2
        id="request-closed"
        className="text-2xl font-bold tracking-tight text-balance"
      >
        {t('connect.closed.title')}
      </h2>
      <p className="text-lead text-fg-muted">
        {hasContacts ? t('connect.closed.contacts') : t('connect.closed.later')}
      </p>
      {hasContacts && (
        <dl className="flex flex-col gap-4 text-lead">
          {phone && (
            <div>
              <dt className="text-sm text-fg-muted">{t('footer.phone')}</dt>
              <dd>
                <a
                  href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                  className={linkClass}
                >
                  {phone}
                </a>
              </dd>
            </div>
          )}
          {email && (
            <div>
              <dt className="text-sm text-fg-muted">{t('footer.email')}</dt>
              <dd className="wrap-anywhere">
                <a href={`mailto:${email}`} className={linkClass}>
                  {email}
                </a>
              </dd>
            </div>
          )}
          {hours && (
            <div>
              <dt className="text-sm text-fg-muted">{t('footer.hours')}</dt>
              <dd>{hours}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

export async function ConnectPage({ locale, info }: ConnectPageProps) {
  // only whether it exists; an unavailable API shows error.tsx (W2)
  const privacy = await getLegalDocument('privacy', locale);
  const t = getTranslator(locale);
  const { connect, apiErrors } = getMessages(locale);
  return (
    <main className={pageClassName}>
      <header className={pageHeaderClassName}>
        <h1 className={pageTitleClassName}>{t('connect.title')}</h1>
        {privacy && <p className={pageLeadClassName}>{t('connect.intro')}</p>}
      </header>
      {privacy ? (
        <div className="grid items-start gap-12 md:grid-cols-site-aside md:gap-16">
          <NextSteps locale={locale} />
          <ConnectionRequestForm
            locale={locale}
            messages={{ connect, apiErrors }}
            workingHours={pickText(info.settings.workingHours, locale).trim()}
          />
        </div>
      ) : (
        <ClosedForm locale={locale} info={info} />
      )}
    </main>
  );
}
