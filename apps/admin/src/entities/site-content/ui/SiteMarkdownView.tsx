'use client';

import {
  isSafeHref,
  parseSiteMarkdown,
  type SiteBlock,
  type SiteInline,
} from '@pharmacy/shared-util';
import { Fragment, useMemo, type ReactNode } from 'react';
import { siteMediaContentUrl } from '../api/site-content-queries';

function renderInline(nodes: readonly SiteInline[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.kind === 'text') {
      let content: ReactNode = node.text;
      if (node.italic) content = <em>{content}</em>;
      if (node.bold) content = <strong>{content}</strong>;
      return <Fragment key={index}>{content}</Fragment>;
    }
    const children = renderInline(node.children);
    // The parser drops unsafe targets already; the check is repeated so that a tree from elsewhere cannot make a link.
    if (!isSafeHref(node.href))
      return <Fragment key={index}>{children}</Fragment>;
    // A preview must not take the operator away from the unsaved text: everything but mail opens in a new tab.
    const newTab = !node.href.toLowerCase().startsWith('mailto:');
    return (
      <a
        key={index}
        href={node.href}
        rel="noopener nofollow"
        target={newTab ? '_blank' : undefined}
        className="text-primary underline hover:text-primary-hover"
      >
        {children}
      </a>
    );
  });
}

function renderBlock(block: SiteBlock, index: number): ReactNode {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h2 key={index} className="mt-2 text-lg font-bold text-fg">
          {renderInline(block.children)}
        </h2>
      ) : (
        <h3 key={index} className="mt-1 text-md font-semibold text-fg">
          {renderInline(block.children)}
        </h3>
      );
    case 'paragraph':
      return (
        <p key={index} className="text-sm text-fg">
          {renderInline(block.children)}
        </p>
      );
    case 'list': {
      const items = block.items.map((item, itemIndex) => (
        <li key={itemIndex}>{renderInline(item)}</li>
      ));
      const className = 'ps-6 text-sm text-fg';
      return block.ordered ? (
        <ol key={index} className={`${className} list-decimal`}>
          {items}
        </ol>
      ) : (
        <ul key={index} className={`${className} list-disc`}>
          {items}
        </ul>
      );
    }
    case 'quote':
      return (
        <blockquote
          key={index}
          className="border-s-4 border-border-strong ps-4 text-sm text-fg-muted"
        >
          {renderInline(block.children)}
        </blockquote>
      );
    case 'table':
      return (
        <div key={index} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm text-fg">
            <thead>
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    scope="col"
                    className="border border-border bg-surface-sunken px-3 py-2 text-start font-semibold"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border border-border px-3 py-2 align-top"
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'image':
      return (
        <figure key={index} className="m-0 flex flex-col gap-2">
          <img
            src={siteMediaContentUrl(block.mediaId)}
            // a caption is shown (and read) as the figcaption; without one the description is empty anyway
            alt=""
            loading="lazy"
            className="max-w-full rounded-md border border-border"
          />
          {block.caption && (
            <figcaption className="text-xs text-fg-subtle">
              {block.caption}
            </figcaption>
          )}
        </figure>
      );
  }
}

/**
 * The restricted Markdown of the public site as React elements (ADR-0023): the preview of an article or a
 * document renders what the site renders. The text goes through `parseSiteMarkdown` and only its tree is drawn —
 * raw HTML and unsafe links stay plain text, nothing is set as an HTML string.
 */
export function SiteMarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseSiteMarkdown(source), [source]);
  return <div className="flex flex-col gap-4">{blocks.map(renderBlock)}</div>;
}
