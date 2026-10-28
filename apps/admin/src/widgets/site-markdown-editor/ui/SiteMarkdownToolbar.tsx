'use client';

import type { SiteMedia } from '@pharmacy/shared-dto';
import { Button } from '@pharmacy/ui';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'use-intl';
import { siteMediaEmbed } from '@/entities/site-content';
import { SiteMediaPickerDialog } from '@/features/site-media';

const LINK_TARGET = 'https://';
const TABLE_TEMPLATE = '| A | B |\n|---|---|\n|  |  |';

interface Selection {
  start: number;
  end: number;
}

interface Insertion {
  value: string;
  /** Where the cursor (or the selected part) lands once the text is replaced. */
  selection: Selection;
}

/** Start of the line that holds `position`. */
const lineStartOf = (value: string, position: number): number =>
  position === 0 ? 0 : value.lastIndexOf('\n', position - 1) + 1;

/** `## ` or `- ` at the start of the line of the cursor: the parser takes block markers only there. */
function withLinePrefix(
  value: string,
  { start, end }: Selection,
  prefix: string,
): Insertion {
  const at = lineStartOf(value, start);
  return {
    value: value.slice(0, at) + prefix + value.slice(at),
    selection: { start: start + prefix.length, end: end + prefix.length },
  };
}

/** `[label](https://)`: the chosen words become the label; the target is selected to be typed over. */
function withLink(
  value: string,
  { start, end }: Selection,
  placeholder: string,
): Insertion {
  const chosen = value.slice(start, end);
  // A label ends at the first `]`, holds no `[` and stays on one line: other words are not made a label.
  if (chosen !== '' && !/[[\]\r\n]/.test(chosen)) {
    const link = `[${chosen}](${LINK_TARGET})`;
    const targetStart = start + chosen.length + 3;
    return {
      value: value.slice(0, start) + link + value.slice(end),
      selection: { start: targetStart, end: targetStart + LINK_TARGET.length },
    };
  }
  const link = `[${placeholder}](${LINK_TARGET})`;
  return {
    value: value.slice(0, end) + link + value.slice(end),
    selection: { start: end + 1, end: end + 1 + placeholder.length },
  };
}

/** A block that stands on lines of its own (a picture, a table), after the selection. */
function withBlock(
  value: string,
  { end }: Selection,
  block: string,
): Insertion {
  const before = value.slice(0, end);
  const leading = before === '' || before.endsWith('\n') ? '' : '\n';
  const inserted = `${leading}${block}\n`;
  const caret = end + inserted.length;
  return {
    value: before + inserted + value.slice(end),
    selection: { start: caret, end: caret },
  };
}

export interface SiteMarkdownToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * The insert bar over a Markdown text field (ADR-0023): a heading, a list, a link, a picture from the library and
 * a table go in at the cursor as the restricted Markdown the parser knows. Mount it outside any `<form>`: the
 * picture dialog holds a form of its own, and forms do not nest.
 */
export function SiteMarkdownToolbar({
  textareaRef,
  value,
  onChange,
  disabled = false,
}: SiteMarkdownToolbarProps) {
  const t = useTranslations('siteMarkdown.toolbar');
  const [picking, setPicking] = useState(false);
  // Where the cursor was when the picture dialog opened: the dialog takes the focus away.
  const pickAt = useRef<Selection>({ start: 0, end: 0 });
  const pending = useRef<Selection | null>(null);

  // The cursor is put back after the parent has rendered the new text.
  useEffect(() => {
    const area = textareaRef.current;
    const selection = pending.current;
    if (!area || !selection) return undefined;
    pending.current = null;
    area.focus();
    area.setSelectionRange(selection.start, selection.end);
    // A closing dialog gives the focus back to the button that opened it in a task of its own; the cursor
    // keeps its place, so the text field only takes the focus once more after that.
    const refocus = window.setTimeout(() => area.focus(), 0);
    return () => window.clearTimeout(refocus);
  }, [value, textareaRef]);

  const current = (): Selection => {
    const area = textareaRef.current;
    return area
      ? { start: area.selectionStart, end: area.selectionEnd }
      : { start: value.length, end: value.length };
  };

  const apply = (insertion: Insertion) => {
    pending.current = insertion.selection;
    onChange(insertion.value);
  };

  const pick = (media: SiteMedia) => {
    apply(withBlock(value, pickAt.current, siteMediaEmbed(media)));
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label={t('label')}
        className="flex flex-wrap gap-2"
      >
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => apply(withLinePrefix(value, current(), '## '))}
        >
          {t('heading')}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => apply(withLinePrefix(value, current(), '- '))}
        >
          {t('list')}
        </Button>
        <Button
          variant="secondary"
          iconStart="link"
          disabled={disabled}
          onClick={() => apply(withLink(value, current(), t('linkText')))}
        >
          {t('link')}
        </Button>
        <Button
          variant="secondary"
          iconStart="image"
          disabled={disabled}
          onClick={() => {
            pickAt.current = current();
            setPicking(true);
          }}
        >
          {t('image')}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => apply(withBlock(value, current(), TABLE_TEMPLATE))}
        >
          {t('table')}
        </Button>
      </div>
      <SiteMediaPickerDialog
        open={picking}
        onClose={() => setPicking(false)}
        onPick={pick}
      />
    </>
  );
}
