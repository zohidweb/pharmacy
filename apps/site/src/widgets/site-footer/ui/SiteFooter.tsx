/*
 * Footer of every page (spec 6.2, п. 10), the target of the «Контакты» menu item: the offer and the privacy
 * policy, the contacts from the site settings — only those that are filled. No supplier requisites: they
 * are not in PublicSiteInfo (W5).
 */
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getTranslator } from '@/shared/i18n';
import { localePath, pickText } from '@/shared/lib';
import { siteNameOf } from '@/shared/seo';

export interface SiteFooterProps {
  locale: UiLocale;
  /** `null` when the API is unavailable: the fallback name, no contacts (W2). */
  info: PublicSiteInfo | null;
}

interface Contact {
  key: string;
  label: string;
  value: ReactNode;
}

const linkClass = 'text-primary hover:underline';

/** Messenger links come from the operator; only https addresses become links. */
function isHttps(url: string): boolean {
  return /^https:\/\/\S+$/i.test(url.trim());
}

function contactsOf(info: PublicSiteInfo | null, locale: UiLocale): Contact[] {
  if (!info) return [];
  const t = getTranslator(locale);
  const { settings } = info;
  const phone = settings.phone.trim();
  const email = settings.email.trim();
  const address = pickText(settings.address, locale).trim();
  const hours = pickText(settings.workingHours, locale).trim();
  const contacts: Contact[] = [];
  if (phone) {
    contacts.push({
      key: 'phone',
      label: t('footer.phone'),
      value: (
        <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={linkClass}>
          {phone}
        </a>
      ),
    });
  }
  if (email) {
    contacts.push({
      key: 'email',
      label: t('footer.email'),
      value: (
        <a href={`mailto:${email}`} className={linkClass}>
          {email}
        </a>
      ),
    });
  }
  if (address) {
    contacts.push({
      key: 'address',
      label: t('footer.address'),
      value: address,
    });
  }
  if (hours) {
    contacts.push({ key: 'hours', label: t('footer.hours'), value: hours });
  }
  for (const [key, url] of [
    ['telegram', settings.telegramUrl],
    ['whatsapp', settings.whatsappUrl],
  ] as const) {
    if (!isHttps(url)) continue;
    contacts.push({
      key,
      label: t(`footer.${key}`),
      value: (
        <a
          href={url.trim()}
          target="_blank"
          rel="noopener nofollow"
          className={linkClass}
        >
          {t(`footer.${key}`)}
        </a>
      ),
    });
  }
  return contacts;
}

export function SiteFooter({ locale, info }: SiteFooterProps) {
  const t = getTranslator(locale);
  const name = siteNameOf(info, locale);
  const tagline = info ? pickText(info.settings.tagline, locale).trim() : '';
  const contacts = contactsOf(info, locale);
  return (
    <footer
      id="contacts"
      className="@container border-t border-border bg-surface text-sm"
    >
      <div className="mx-auto grid w-full max-w-(--ph-size-dialog-xl) gap-8 px-4 py-10 @2xl:grid-cols-3">
        <div className="flex flex-col gap-2">
          <p className="text-md font-bold tracking-tight">{name}</p>
          {tagline && <p className="text-fg-muted">{tagline}</p>}
        </div>

        <section
          aria-labelledby="footer-contacts"
          className="flex flex-col gap-3"
        >
          <h2 id="footer-contacts" className="font-semibold">
            {t('footer.contacts')}
          </h2>
          {contacts.length > 0 ? (
            <dl className="flex flex-col gap-2">
              {contacts.map((contact) => (
                <div key={contact.key}>
                  <dt className="text-xs text-fg-muted">{contact.label}</dt>
                  <dd className="wrap-anywhere">{contact.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-fg-muted">
              <Link href={localePath(locale, '/connect')} className={linkClass}>
                {t('footer.noContacts')}
              </Link>
            </p>
          )}
        </section>

        <section
          aria-labelledby="footer-documents"
          className="flex flex-col gap-3"
        >
          <h2 id="footer-documents" className="font-semibold">
            {t('footer.documents')}
          </h2>
          <ul className="flex flex-col gap-2">
            <li>
              <Link href={localePath(locale, '/offer')} className={linkClass}>
                {t('footer.offer')}
              </Link>
            </li>
            <li>
              <Link href={localePath(locale, '/privacy')} className={linkClass}>
                {t('footer.privacy')}
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </footer>
  );
}
