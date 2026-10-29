'use client';

import { controlClassName, Field, SegmentedControl } from '@pharmacy/ui';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { SiteMarkdownView } from '@/entities/site-content';
import { SiteMarkdownToolbar } from './SiteMarkdownToolbar';

type Mode = 'text' | 'preview';

export interface SiteMarkdownEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  rows?: number;
}

/**
 * A Markdown text field of the public site (articles, documents): the field with the insert bar, and a switch
 * «Текст / Предпросмотр» that shows the text drawn by the same renderer as the site's. The field stays mounted
 * under the preview, so the cursor and the scroll are where the operator left them. Mount it outside any
 * `<form>` (see `SiteMarkdownToolbar`).
 */
export function SiteMarkdownEditor({
  label,
  value,
  onChange,
  hint,
  error,
  rows = 16,
}: SiteMarkdownEditorProps) {
  const t = useTranslations('siteMarkdown');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<Mode>('text');

  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SiteMarkdownToolbar
              textareaRef={textarea}
              value={value}
              onChange={onChange}
              disabled={mode === 'preview'}
            />
            <SegmentedControl
              label={t('mode.label')}
              value={mode}
              onValueChange={setMode}
              options={[
                {
                  value: 'text',
                  label: t('mode.text'),
                  ariaLabel: t('mode.text'),
                },
                {
                  value: 'preview',
                  label: t('mode.preview'),
                  ariaLabel: t('mode.preview'),
                },
              ]}
            />
          </div>
          <textarea
            ref={textarea}
            rows={rows}
            hidden={mode === 'preview'}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={`${controlClassName} resize-y py-3`}
            {...control}
          />
          {mode === 'preview' && (
            <div
              role="region"
              aria-label={t('mode.preview')}
              className="min-h-48 rounded-(--ph-input-radius) border border-(--ph-input-border) bg-surface p-4"
            >
              {value.trim() === '' ? (
                <p className="text-sm text-fg-subtle">{t('previewEmpty')}</p>
              ) : (
                <SiteMarkdownView source={value} />
              )}
            </div>
          )}
        </>
      )}
    </Field>
  );
}
