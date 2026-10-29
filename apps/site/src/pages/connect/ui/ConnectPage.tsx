/*
 * «Оставить заявку» (spec 6.4, W11). The server part checks the privacy policy the visitor consents to (the page's
 * language, the API falls back to RU — the same check the API makes on submit): none published — «Приём заявок
 * скоро откроется» and the contacts from the settings instead of the form.
 */
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { Card } from '@pharmacy/ui';
import { ConnectionRequestForm } from '@/features/connection-request';
import { getLegalDocument } from '@/shared/api';
import { getMessages, getTranslator } from '@/shared/i18n';
import { pickText } from '@/shared/lib';

export interface ConnectPageProps {
  locale: UiLocale;
  info: PublicSiteInfo;
}

const linkClass = 'text-primary hover:underline';

function ClosedForm({ locale, info }: ConnectPageProps) {
  const t = getTranslator(locale);
  const phone = info.settings.phone.trim();
  const email = info.settings.email.trim();
  const hours = pickText(info.settings.workingHours, locale).trim();
  const hasContacts = Boolean(phone || email);
  return (
    <Card
      as="section"
      aria-labelledby="request-closed"
      className="flex flex-col gap-4"
    >
      <h2 id="request-closed" className="text-xl font-bold tracking-tight">
        {t('connect.closed.title')}
      </h2>
      <p className="text-fg-muted">
        {hasContacts ? t('connect.closed.contacts') : t('connect.closed.later')}
      </p>
      {hasContacts && (
        <dl className="flex flex-col gap-2">
          {phone && (
            <div>
              <dt className="text-xs text-fg-muted">{t('footer.phone')}</dt>
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
              <dt className="text-xs text-fg-muted">{t('footer.email')}</dt>
              <dd className="wrap-anywhere">
                <a href={`mailto:${email}`} className={linkClass}>
                  {email}
                </a>
              </dd>
            </div>
          )}
          {hours && (
            <div>
              <dt className="text-xs text-fg-muted">{t('footer.hours')}</dt>
              <dd>{hours}</dd>
            </div>
          )}
        </dl>
      )}
    </Card>
  );
}

export async function ConnectPage({ locale, info }: ConnectPageProps) {
  // only whether it exists; an unavailable API shows error.tsx (W2)
  const privacy = await getLegalDocument('privacy', locale);
  const t = getTranslator(locale);
  const { connect, apiErrors } = getMessages(locale);
  return (
    <main className="mx-auto flex w-full max-w-(--ph-size-dialog-lg) flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          {t('connect.title')}
        </h1>
        {privacy && <p className="text-fg-muted">{t('connect.intro')}</p>}
      </header>
      {privacy ? (
        <ConnectionRequestForm
          locale={locale}
          messages={{ connect, apiErrors }}
          workingHours={pickText(info.settings.workingHours, locale).trim()}
        />
      ) : (
        <ClosedForm locale={locale} info={info} />
      )}
    </main>
  );
}
