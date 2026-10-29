import type { MetadataRoute } from 'next';
import { siteRobots } from '@/shared/seo';

// SITE_INDEXING and SITE_ORIGIN are read per request, never at build time (spec 5)
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return siteRobots();
}
