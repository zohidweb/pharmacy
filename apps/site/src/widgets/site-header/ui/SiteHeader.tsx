/*
 * Header of every page (spec 6.2, п. 1): logo or name (W3), menu, RU/TJ, «Войти» (W4) and the request
 * button. On a narrow screen the menu folds into <details> — no JavaScript needed to open it.
 */
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { buttonClassName, Icon } from '@pharmacy/ui';
import Link from 'next/link';
import { mediaPath } from '@/shared/api';
import { siteEnv } from '@/shared/config';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import { siteNameOf } from '@/shared/seo';
import { LocaleSwitch } from './LocaleSwitch';

export interface SiteHeaderProps {
  locale: UiLocale;
  /** `null` when the API is unavailable: the fallback name, no logo (W2). */
  info: PublicSiteInfo | null;
}

const menuLinkClass =
  'flex min-h-touch items-center rounded-sm px-3 text-sm font-medium text-fg hover:bg-surface-sunken';

export function SiteHeader({ locale, info }: SiteHeaderProps) {
  const t = getTranslator(locale);
  const name = siteNameOf(info, locale);
  const logoId = info?.settings.logoMediaId;
  const home = localePath(locale, '/');
  const connect = localePath(locale, '/connect');
  // «Войти» leads to apps/web (W4)
  const signIn = siteEnv().webOrigin;
  const menu = [
    // the features block lives on the home page, the contacts in the footer of every page
    { href: `${home}#features`, label: t('nav.features') },
    { href: localePath(locale, '/tariffs'), label: t('nav.tariffs') },
    { href: localePath(locale, '/blog'), label: t('nav.blog') },
    { href: '#contacts', label: t('nav.contacts') },
  ];

  return (
    <header className="@container relative border-b border-border bg-surface">
      <div className="mx-auto flex min-h-topbar w-full max-w-(--ph-size-dialog-xl) items-center gap-4 px-4">
        <Link
          href={home}
          className="flex min-h-touch min-w-0 items-center text-md font-bold tracking-tight text-fg"
        >
          {logoId ? (
            // a plain <img>: no next/image on the site (ADR-0023)
            <img
              src={mediaPath(logoId)}
              alt={name}
              className="h-icon-xl w-auto"
            />
          ) : (
            <span className="truncate">{name}</span>
          )}
        </Link>

        <nav aria-label={t('nav.label')} className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {menu.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={menuLinkClass}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-3 lg:flex">
            <LocaleSwitch locale={locale} label={t('nav.language')} />
            <a
              href={signIn}
              className={buttonClassName({ variant: 'tertiary' })}
            >
              {t('nav.signIn')}
            </a>
          </div>
          <div className="hidden @2xl:block">
            <Link href={connect} className={buttonClassName()}>
              {t('nav.connect')}
            </Link>
          </div>

          <details className="lg:hidden">
            <summary
              className={buttonClassName({
                variant: 'secondary',
                className: 'list-none',
              })}
            >
              <Icon name="menu" size="sm" />
              {t('nav.menu')}
            </summary>
            <div className="absolute inset-x-0 top-full z-(--ph-z-dropdown) border-b border-border bg-surface shadow-lg">
              <div className="mx-auto flex w-full max-w-(--ph-size-dialog-xl) flex-col gap-4 p-4">
                <nav aria-label={t('nav.label')}>
                  {/* plain links: a link to another page closes the menu by a full navigation; a same-page anchor
                      (#contacts, #features on the home page) only scrolls and leaves it open */}
                  <ul className="flex flex-col">
                    {menu.map((item) => (
                      <li key={item.href}>
                        <a href={item.href} className={menuLinkClass}>
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
                <div className="flex flex-wrap items-center gap-3">
                  <LocaleSwitch locale={locale} label={t('nav.language')} />
                  <a
                    href={signIn}
                    className={buttonClassName({ variant: 'secondary' })}
                  >
                    {t('nav.signIn')}
                  </a>
                  <div className="@2xl:hidden">
                    <a href={connect} className={buttonClassName()}>
                      {t('nav.connect')}
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
