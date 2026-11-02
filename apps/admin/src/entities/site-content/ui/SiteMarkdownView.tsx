'use client';

import { parseSiteMarkdown } from '@pharmacy/shared-util';
import { SiteMarkdown } from '@pharmacy/ui';
import { useMemo } from 'react';
import { siteMediaContentUrl } from '../api/site-content-queries';

/**
 * The preview of an article or a document (ADR-0023): renders what the public site renders — the text goes
 * through `parseSiteMarkdown` and only its tree is drawn.
 */
export function SiteMarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseSiteMarkdown(source), [source]);
  return (
    <SiteMarkdown
      blocks={blocks}
      mediaSrc={siteMediaContentUrl}
      links="new-tab"
    />
  );
}
