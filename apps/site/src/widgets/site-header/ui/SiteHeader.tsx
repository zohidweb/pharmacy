/*
 * Header of every page (spec 4.5, п. 1): one line of 72 px from 1024 px: the name or logo (W3), «Возможности»,
 * «Тарифы», «Блог», «Контакты», RU/TJ, «Войти» (W4) and «Оставить заявку». It stays on top while the page scrolls
 * (sticky: it keeps its place in the flow, so no page goes under it); on the light page it is transparent, after 24 px
 * of scroll it gets the surface, a blur and the line below (HeaderScrollState, R5; amendment 4.4, п. 1). Its content
 * takes the width of the page (1320 px); the phone menu is light, on the page background.
 * Below 1024 px the menu is a full-screen <details>: it opens without JavaScript, its items appear one after another.
 * No `motion` here (controller ruling on Task 3): the header is on every page, so its animation is CSS only: the
 * menu items take the `site-enter` keyframes, the request button gives on press (`pressClassName`).
 */
import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { buttonClassName, Icon } from '@pharmacy/ui';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { mediaPath } from '@/shared/api';
import { siteEnv } from '@/shared/config';
import { getTranslator } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import { siteNameOf } from '@/shared/seo';
import { contentClassName, pressClassName } from '@/shared/ui';
import { HeaderScrollState } from './HeaderScrollState';
import { LocaleSwitch } from './LocaleSwitch';

export interface SiteHeaderProps {
  locale: UiLocale;
  /** `null` when the API is unavailable: the fallback name, no logo (W2). */
  info: PublicSiteInfo | null;
}

const menuLinkClass =
  'flex min-h-touch items-center rounded-full px-3 text-sm font-medium whitespace-nowrap text-fg-muted ' +
  'transition-colors hover:text-fg';

const signInClass =
  'flex min-h-touch items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap text-fg ' +
  'transition-colors hover:text-accent-site';

const panelLinkClass =
  'flex min-h-touch-primary items-center rounded-full text-2xl font-bold tracking-tight text-fg ' +
  'transition-colors hover:text-accent-site';

/** An item of the phone menu: it rises in at its place in the cascade when the menu opens (site-theme.css). */
function enterAt(index: number): CSSProperties {
  return { '--ph-site-enter-index': index } as CSSProperties;
}

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
    <HeaderScrollState className="group/header @container sticky top-0 z-(--ph-z-sticky)">
      {/* The background is its own layer, not the header's: a backdrop-filter on the header would become the
          containing block of the fixed menu panel and cut it to 72 px. It fades in, nothing moves. */}
      <div
        aria-hidden="true"
        className={
          'pointer-events-none absolute inset-0 border-b border-site-line bg-surface/90 ' +
          'backdrop-blur-site-header opacity-0 transition-opacity motion-reduce:transition-none ' +
          'group-data-scrolled/header:opacity-100 max-md:group-has-open/header:opacity-100'
        }
      />
      <div
        className={`${contentClassName} relative flex h-site-header items-center gap-4`}
      >
        <Link
          href={home}
          className="flex min-h-touch min-w-0 items-center rounded-full text-md font-bold tracking-tight text-fg"
        >
          {logoId ? (
            // a plain <img>: no next/image on the site (ADR-0023)
            <img
              src={mediaPath(logoId)}
              alt={name}
              className="h-icon-xl w-auto"
            />
          ) : (
            // a long name (the TJ fallback) wraps to a second line on a phone instead of an ellipsis
            // (spec 2026-11-10-public-site-mobile, M3); 72 px hold two lines
            <span className="line-clamp-2 leading-tight md:line-clamp-1">
              {name}
            </span>
          )}
        </Link>

        <nav aria-label={t('nav.label')} className="hidden md:block">
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
          <div className="hidden items-center gap-2 md:flex">
            <LocaleSwitch locale={locale} label={t('nav.language')} />
            <a href={signIn} className={signInClass}>
              {t('nav.signIn')}
            </a>
          </div>
          <div className="hidden @2xl:block">
            <Link
              href={connect}
              className={buttonClassName({ className: pressClassName })}
            >
              {t('nav.connect')}
            </Link>
          </div>

          <details className="group/menu md:hidden">
            <summary
              className={buttonClassName({
                variant: 'secondary',
                className: 'list-none',
              })}
            >
              <Icon
                name="menu"
                size="sm"
                className="group-open/menu:hidden"
              />
              <Icon
                name="x"
                size="sm"
                className="hidden group-open/menu:block"
              />
              {t('nav.menu')}
            </summary>
            {/* Full screen below the header line; it scrolls on its own if a short screen cannot hold it. */}
            <div className="fixed inset-x-0 top-site-header bottom-0 overflow-y-auto overscroll-contain border-t border-site-line bg-bg">
              <div className={`${contentClassName} flex flex-col gap-8 py-8`}>
                <nav aria-label={t('nav.label')}>
                  <ul className="flex flex-col gap-2">
                    {menu.map((item, index) => (
                      <li
                        key={item.href}
                        className="site-enter-open"
                        style={enterAt(index)}
                      >
                        <Link href={item.href} className={panelLinkClass}>
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
                <div className="flex flex-col items-start gap-4">
                  <div
                    className="site-enter-open"
                    style={enterAt(menu.length)}
                  >
                    <LocaleSwitch locale={locale} label={t('nav.language')} />
                  </div>
                  <div
                    className="site-enter-open w-full"
                    style={enterAt(menu.length + 1)}
                  >
                    <a
                      href={signIn}
                      className={buttonClassName({
                        variant: 'secondary',
                        size: 'lg',
                        block: true,
                      })}
                    >
                      {t('nav.signIn')}
                    </a>
                  </div>
                  <div
                    className="site-enter-open w-full"
                    style={enterAt(menu.length + 2)}
                  >
                    <Link
                      href={connect}
                      className={buttonClassName({
                        size: 'lg',
                        block: true,
                        className: pressClassName,
                      })}
                    >
                      {t('nav.connect')}
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
    </HeaderScrollState>
  );
}
