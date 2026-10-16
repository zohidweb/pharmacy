'use client';

/*
 * A4 printing of a document (an invoice): like `ReceiptPrint`, a separate print root in
 * `document.body` — hidden on screen, the only visible element in print; the named page `sheet`
 * (styles/print.css) gives it the A4 size. Not aria-hidden: on screen `display: none` already hides
 * it, and a PDF saved from the print dialog keeps its text in the tagged structure.
 */
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { printReceipt } from './ReceiptPrint';

/** Opens the browser print dialog once fonts are loaded, as for a receipt. */
export const printDocument = printReceipt;

export interface SheetPrintProps {
  children: ReactNode;
}

export function SheetPrint({ children }: SheetPrintProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="ph-print-root ph-print-sheet">{children}</div>,
    document.body,
  );
}
