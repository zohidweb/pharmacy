import {
  isSafeHref,
  type SiteBlock,
  type SiteInline,
} from '@pharmacy/shared-util';
import { Fragment, type ReactNode } from 'react';

export interface SiteMarkdownProps {
  /** The tree from `parseSiteMarkdown` (@pharmacy/shared-util). */
  blocks: readonly SiteBlock[];
  /** The address of an uploaded picture by its id. */
  mediaSrc: (mediaId: string) => string;
  /**
   * `new-tab` — everything but `mailto:` opens in a new tab (a preview must not take the operator away from the
   * unsaved text); `external-new-tab` — only `http(s):` opens in a new tab, site paths stay in the same one.
   */
  links: 'new-tab' | 'external-new-tab';
}

function opensInNewTab(href: string, links: SiteMarkdownProps['links']) {
  const lower = href.toLowerCase();
  if (links === 'new-tab') return !lower.startsWith('mailto:');
  return lower.startsWith('http://') || lower.startsWith('https://');
}

function renderInline(
  nodes: readonly SiteInline[],
  links: SiteMarkdownProps['links'],
): ReactNode {
  return nodes.map((node, index) => {
    if (node.kind === 'text') {
      let content: ReactNode = node.text;
      if (node.italic) content = <em>{content}</em>;
      if (node.bold) content = <strong>{content}</strong>;
      return <Fragment key={index}>{content}</Fragment>;
    }
    const children = renderInline(node.children, links);
    // The parser drops unsafe targets already; the check is repeated so that a tree from elsewhere cannot make a link.
    if (!isSafeHref(node.href))
      return <Fragment key={index}>{children}</Fragment>;
    const newTab = opensInNewTab(node.href, links);
    // The preview keeps the rel on every link (mail included); the site only on the external ones.
    return (
      <a
        key={index}
        href={node.href}
        rel={newTab || links === 'new-tab' ? 'noopener nofollow' : undefined}
        target={newTab ? '_blank' : undefined}
        className="text-primary underline hover:text-primary-hover"
      >
        {children}
      </a>
    );
  });
}

function renderBlock(
  block: SiteBlock,
  index: number,
  props: SiteMarkdownProps,
): ReactNode {
  const { links, mediaSrc } = props;
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h2 key={index} className="mt-2 text-lg font-bold text-fg">
          {renderInline(block.children, links)}
        </h2>
      ) : (
        <h3 key={index} className="mt-1 text-md font-semibold text-fg">
          {renderInline(block.children, links)}
        </h3>
      );
    case 'paragraph':
      return (
        <p key={index} className="text-sm text-fg">
          {renderInline(block.children, links)}
        </p>
      );
    case 'list': {
      const items = block.items.map((item, itemIndex) => (
        <li key={itemIndex}>{renderInline(item, links)}</li>
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
          {renderInline(block.children, links)}
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
                    {renderInline(cell, links)}
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
                      {renderInline(cell, links)}
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
            src={mediaSrc(block.mediaId)}
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
 * The restricted Markdown of the public site as React elements (ADR-0023): the admin preview and the site render
 * the same tree. Only the parsed tree is drawn — raw HTML and unsafe links stay plain text, nothing is set as an
 * HTML string. No hooks and no client code: it works in a server component.
 */
export function SiteMarkdown(props: SiteMarkdownProps) {
  return (
    <div className="flex flex-col gap-4">
      {props.blocks.map((block, index) => renderBlock(block, index, props))}
    </div>
  );
}
