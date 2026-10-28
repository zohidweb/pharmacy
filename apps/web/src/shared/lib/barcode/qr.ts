import { correction, generate } from 'lean-qr';

/**
 * QR modules of a text (ADR-0022: the library lean-qr, correction level M at least): rows of the square matrix,
 * true — dark. The quiet zone is the drawing's.
 */
export function qrModules(text: string): boolean[][] {
  const code = generate(text, { minCorrectionLevel: correction.M });
  return Array.from({ length: code.size }, (_, y) =>
    Array.from({ length: code.size }, (__, x) => code.get(x, y)),
  );
}
