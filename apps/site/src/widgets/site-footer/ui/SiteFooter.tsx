/*
 * Footer of every page (spec 4.5, п. 11), the target of the «Контакты» menu item: four columns from 1024 px (brand,
 * sections, documents, contacts), one on a phone, on the page background; no decorative lines, no versions. Contacts
 * come from the site settings, only those that are filled. No supplier requisites: they are not in PublicSiteInfo (W5).
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

/** A link of a column list: secondary text that lights up on hover. */
const listLinkClass =
  'inline-flex min-h-touch items-center text-fg-muted transition-colors hover:text-fg md:min-h-0 md:py-1';

/** A contact value: the main text colour, the accent on hover. */
const contactLinkClass =
  'text-fg underline-offset-4 transition-colors hover:text-accent-site hover:underline';

const headingClass = 'text-sm font-semibold text-fg';

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
        <a
          href={`tel:${phone.replace(/[^\d+]/g, '')}`}
          className={contactLinkClass}
        >
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
        <a href={`mailto:${email}`} className={contactLinkClass}>
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
          className={contactLinkClass}
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
  const home = localePath(locale, '/');
  const sections = [
    { href: `${home}#features`, label: t('nav.features') },
    { href: localePath(locale, '/tariffs'), label: t('nav.tariffs') },
    { href: localePath(locale, '/blog'), label: t('nav.blog') },
    { href: localePath(locale, '/connect'), label: t('nav.connect') },
  ];
  const documents = [
    { href: localePath(locale, '/offer'), label: t('footer.offer') },
    { href: localePath(locale, '/privacy'), label: t('footer.privacy') },
  ];
  return (
    <footer
      id="contacts"
      className="border-t border-site-line bg-site-canvas text-sm"
    >
      <div className="mx-auto grid w-full max-w-(--ph-size-dialog-xl) gap-10 px-4 py-16 md:grid-cols-4 md:gap-8">
        <div className="flex flex-col gap-3">
          <Link
            href={home}
            className="self-start text-lg font-bold tracking-tight text-fg"
          >
            {name}
          </Link>
          {tagline && <p className="text-fg-muted">{tagline}</p>}
        </div>

        <nav aria-labelledby="footer-sections" className="flex flex-col gap-2">
          <h2 id="footer-sections" className={headingClass}>
            {t('footer.sections')}
          </h2>
          <ul className="flex flex-col">
            {sections.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={listLinkClass}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <section
          aria-labelledby="footer-documents"
          className="flex flex-col gap-2"
        >
          <h2 id="footer-documents" className={headingClass}>
            {t('footer.documents')}
          </h2>
          <ul className="flex flex-col">
            {documents.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={listLinkClass}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="footer-contacts"
          className="flex flex-col gap-2"
        >
          <h2 id="footer-contacts" className={headingClass}>
            {t('footer.contacts')}
          </h2>
          {contacts.length > 0 ? (
            <dl className="flex flex-col gap-3">
              {contacts.map((contact) => (
                <div key={contact.key}>
                  <dt className="text-xs text-fg-muted">{contact.label}</dt>
                  <dd className="wrap-anywhere text-fg">{contact.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>
              <Link
                href={localePath(locale, '/connect')}
                className={contactLinkClass}
              >
                {t('footer.noContacts')}
              </Link>
            </p>
          )}
        </section>
      </div>
    </footer>
  );
}
