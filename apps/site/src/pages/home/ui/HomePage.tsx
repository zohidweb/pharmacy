import type { PublicSiteInfo, UiLocale } from '@pharmacy/shared-dto';
import { pickText } from '@/shared/lib';
import { Audience } from './sections/Audience';
import { CallToAction } from './sections/CallToAction';
import { CapabilityMarquee } from './sections/CapabilityMarquee';
import { Faq } from './sections/Faq';
import { Features } from './sections/Features';
import { Hero } from './sections/Hero';
import { PricingTeaser } from './sections/PricingTeaser';
import { Security } from './sections/Security';
import { Steps } from './sections/Steps';

export interface HomePageProps {
  locale: UiLocale;
  info: PublicSiteInfo;
}

/**
 * The home page: sections 2–10 of the redesign spec 4.5, top to bottom (the header and the footer come from the
 * layout).
 */
export function HomePage({ locale, info }: HomePageProps) {
  return (
    <main>
      <Hero
        locale={locale}
        tagline={pickText(info.settings.tagline, locale).trim()}
      />
      <CapabilityMarquee locale={locale} />
      <Audience locale={locale} />
      <Features locale={locale} />
      <Steps locale={locale} />
      <PricingTeaser locale={locale} pricing={info.pricing} />
      <Security locale={locale} />
      <Faq locale={locale} />
      <CallToAction locale={locale} />
    </main>
  );
}
