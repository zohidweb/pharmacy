/*
 * Code 128, set B (ISO/IEC 15417, ADR-0022): printable ASCII 32–126. Each symbol is six widths (bar, space, …) of
 * 11 modules; the check symbol is (104 + Σ position × value) mod 103; Stop is seven widths of 13 modules.
 */

// widths of the symbols 0–105 (103 Start A, 104 Start B, 105 Start C) and of Stop
// prettier-ignore
const WIDTHS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const STOP = '2331112';
const START_B = 104;

/** Printable ASCII only: the characters set B encodes. */
export const CODE128_B = /^[\x20-\x7E]+$/;

/** Modules of a set B symbol of the text: 11 × (characters + 3) + 2. */
export function code128Modules(text: string): boolean[] {
  const values = [...text].map((char) => char.charCodeAt(0) - 32);
  const check =
    values.reduce((sum, value, i) => sum + value * (i + 1), START_B) % 103;
  const modules: boolean[] = [];
  for (const widths of [
    WIDTHS[START_B],
    ...values.map((value) => WIDTHS[value]),
    WIDTHS[check],
    STOP,
  ]) {
    [...widths].forEach((width, i) => {
      for (let n = 0; n < Number(width); n += 1) modules.push(i % 2 === 0);
    });
  }
  return modules;
}
