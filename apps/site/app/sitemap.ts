import type { MetadataRoute } from 'next';
import { siteSitemap } from '@/shared/seo';

// the build never asks the API; the API answer itself is cached for 60 s (spec 5)
export const dynamic = 'force-dynamic';

export default function sitemap(): Promise<MetadataRoute.Sitemap> {
  return siteSitemap();
}
