import { siteEnv } from './env';

/** Absolute address on the public origin (canonical, hreflang, sitemap, Open Graph). Server only. */
export function absoluteUrl(path: string): string {
  return siteEnv().siteOrigin + path;
}
