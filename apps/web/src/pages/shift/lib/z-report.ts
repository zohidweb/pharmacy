/* Lines of the printed Z-report (UI mockup «Смена · Z-отчёт»), same rules as the sale receipt. */
import type { PosStoreSettings, ZReport } from '@pharmacy/shared-dto';
import {
  CURRENCY_SIGN,
  formatDateTime,
  formatMoney,
  receiptCenter,
  receiptRow,
  receiptRule,
} from '@pharmacy/shared-util';

const amount = (minor: number) =>
  formatMoney(minor, { withSign: false, plainSpaces: true });

export interface ZReportLabels {
  title: string;
  shift: string;
  cashier: string;
  opened: string;
  closed: string;
  receipts: string;
  method: { cash: string; card: string; qr: string; nfc: string };
  returns: (count: number) => string;
  revenue: string;
  opening: string;
  cashIn: string;
  cashOut: string;
  expected: string;
  actual: string;
  discrepancy: string;
  byTerminal: (method: string) => string;
  fiscalPlaceholder: string;
  taxId: string;
}

export function zReportLines(
  report: ZReport,
  settings: Pick<PosStoreSettings, 'storeName' | 'storeAddress' | 'taxId'>,
  labels: ZReportLabels,
  cols: number,
): string[] {
  const { shift } = report;
  const row = (left: string, right: string) => receiptRow(left, right, cols);
  const out: string[] = [
    ...receiptCenter(labels.title, cols),
    ...receiptCenter(`${settings.storeName} · ${settings.storeAddress}`, cols),
    ...receiptCenter(`${labels.taxId} ${settings.taxId}`, cols),
    receiptRule(cols),
    ...row(labels.shift, `№${shift.number}`),
    ...row(labels.cashier, shift.openedBy),
    ...row(labels.opened, formatDateTime(shift.openedAt)),
    ...row(
      labels.closed,
      shift.closedAt ? formatDateTime(shift.closedAt) : '—',
    ),
    receiptRule(cols),
    ...row(labels.receipts, String(shift.receipts)),
    ...(['cash', 'card', 'qr', 'nfc'] as const).flatMap((m) =>
      row(labels.method[m], amount(shift.byMethod[m].amountMinor)),
    ),
    ...row(
      labels.returns(shift.returns.count),
      `-${amount(shift.returns.amountMinor)}`,
    ),
    ...row(labels.revenue, `${amount(shift.revenueMinor)} ${CURRENCY_SIGN}`),
    receiptRule(cols),
    ...row(labels.opening, amount(shift.cash.openingMinor)),
    ...row(`+ ${labels.cashIn}`, amount(shift.cash.inMinor)),
    ...row(`- ${labels.cashOut}`, amount(shift.cash.outMinor)),
    ...row(labels.expected, amount(shift.cash.expectedMinor)),
    ...row(labels.actual, amount(report.actualCashMinor)),
    ...row(
      labels.discrepancy,
      `${amount(report.discrepancyMinor)} ${CURRENCY_SIGN}`,
    ),
  ];
  const diffs = (['card', 'qr', 'nfc'] as const).filter(
    (m) => report.terminalDiff[m] !== 0,
  );
  if (diffs.length > 0) {
    out.push(receiptRule(cols));
    for (const m of diffs) {
      out.push(
        ...row(
          labels.byTerminal(labels.method[m]),
          amount(report.terminalDiff[m]),
        ),
      );
    }
  }
  out.push(receiptRule(cols), ...receiptCenter(labels.fiscalPlaceholder, cols));
  return out;
}
