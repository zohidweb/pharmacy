'use client';

/*
 * A4 printing of a document (an invoice): like `ReceiptPrint`, a separate print root in
 * `document.body` — hidden on screen, the only visible element in print; the named page `sheet`
 * (styles/print.css) gives it the A4 size. Print with `printReceipt()`.
 */
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SheetPrintProps {
  children: ReactNode;
}

export function SheetPrint({ children }: SheetPrintProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="ph-print-root ph-print-sheet" aria-hidden="true">
      {children}
    </div>,
    document.body,
  );
}
