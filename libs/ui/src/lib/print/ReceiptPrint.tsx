'use client';

/*
 * Receipt printing (skill ui-standards-tokens, «Печать чеков»): fixed-width lines prepared by
 * `receiptRow` & co. (@pharmacy/shared-util) are shown as an on-screen preview and printed from a
 * separate print root through the browser print dialog — the rest of the app is hidden in print.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../cx';

export type PaperWidth = '58' | '80';

/** Columns of the paper widths; must match --ph-receipt-cols in tokens/print.css. */
export const RECEIPT_COLUMNS: Record<PaperWidth, number> = {
  '58': 32,
  '80': 42,
};

export interface ReceiptPreviewProps {
  lines: readonly string[];
  paperWidth: PaperWidth;
  /** Localized name of the preview, e.g. «Предпросмотр чека». */
  label: string;
  /** Layout only. */
  className?: string;
}

/** On-screen paper: monospace, the same columns as the printout. */
export function ReceiptPreview({
  lines,
  paperWidth,
  label,
  className,
}: ReceiptPreviewProps) {
  return (
    <figure
      aria-label={label}
      data-receipt-width={paperWidth}
      className={cx(
        'm-0 max-h-(--ph-receipt-preview-height) overflow-y-auto rounded-md border border-border bg-surface p-4 shadow-sm',
        className,
      )}
    >
      <pre className="m-0 w-fit font-mono text-xs whitespace-pre text-fg">
        {lines.join('\n')}
      </pre>
    </figure>
  );
}

export interface ReceiptPrintProps {
  lines: readonly string[];
  paperWidth: PaperWidth;
}

/** Hidden on screen; in print it is the only visible element. */
export function ReceiptPrint({ lines, paperWidth }: ReceiptPrintProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="ph-print-root"
      data-receipt-width={paperWidth}
      aria-hidden="true"
    >
      {lines.map((line, index) => (
        <div key={index} className="ph-print-line">
          {line || ' '}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Opens the browser print dialog once fonts are loaded (else the first receipt uses a fallback). */
export async function printReceipt(): Promise<void> {
  await document.fonts?.ready;
  window.print();
}
