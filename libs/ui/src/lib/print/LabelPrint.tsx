'use client';

/*
 * Printing labels — price tags of the shelf (ADR-0022): like `SheetPrint`, a separate print root in `document.body`,
 * hidden on screen. Each child is one label of class `ph-label` and gets a page of its own: the named page of the size
 * (styles/print.css) is the label stock of the printer, with no margin.
 */
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type LabelSize = '58x40' | '40x30';

export interface LabelPrintProps {
  size: LabelSize;
  /** The labels, one page each. */
  children: ReactNode;
}

export function LabelPrint({ size, children }: LabelPrintProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="ph-print-root ph-print-labels"
      data-label-size={size}
      aria-hidden="true"
    >
      {children}
    </div>,
    document.body,
  );
}
