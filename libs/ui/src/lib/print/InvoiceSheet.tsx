/*
 * An invoice as a document (spec 2026-10-15-billing-services, 6.3): the same sheet on screen and in
 * A4 print (inside `SheetPrint`). Every value comes formatted by the app — the kit knows no DTO and
 * no money.
 */
import { cx } from '../cx';

export interface InvoiceSheetRow {
  line: string;
  detail: string;
  amount: string;
}

export interface InvoiceSheetProps {
  /** «Счёт № … от …». */
  title: string;
  /** The supplier and the payer: a label and the lines of its requisites. */
  parties: ReadonlyArray<{ label: string; lines: readonly string[] }>;
  /** The headers of the columns. */
  columns: InvoiceSheetRow;
  rows: readonly InvoiceSheetRow[];
  /** Net, VAT, total; `strong` — the sum to pay. */
  totals: ReadonlyArray<{ label: string; value: string; strong?: boolean }>;
  /** The due date, the purpose of payment. */
  notes: ReadonlyArray<{ label: string; value: string }>;
  /** Layout only. */
  className?: string;
}

export function InvoiceSheet({
  title,
  parties,
  columns,
  rows,
  totals,
  notes,
  className,
}: InvoiceSheetProps) {
  return (
    <article
      className={cx('flex flex-col gap-6 text-md text-fg', className)}
    >
      <h1 className="m-0 text-xl font-semibold">{title}</h1>
      <div className="grid grid-cols-2 gap-6">
        {parties.map((party) => (
          <section key={party.label} className="flex flex-col gap-1">
            <h2 className="m-0 text-sm font-semibold text-fg-muted">
              {party.label}
            </h2>
            {party.lines.map((line, index) => (
              <p key={index} className="m-0 wrap-anywhere">
                {line}
              </p>
            ))}
          </section>
        ))}
      </div>
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="border-b border-border-strong">
            <th scope="col" className="px-2 py-2 text-left font-semibold">
              {columns.line}
            </th>
            <th scope="col" className="px-2 py-2 text-left font-semibold">
              {columns.detail}
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              {columns.amount}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="ph-sheet-row border-b border-border">
              <td className="px-2 py-2 align-top wrap-anywhere">{row.line}</td>
              <td className="px-2 py-2 align-top text-fg-muted">
                {row.detail}
              </td>
              <td className="px-2 py-2 text-right align-top whitespace-nowrap">
                {row.amount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="m-0 ms-auto flex flex-col gap-1 tabular-nums">
        {totals.map((total) => (
          <div
            key={total.label}
            className={cx(
              'flex justify-between gap-8',
              total.strong && 'text-lg font-semibold',
            )}
          >
            <dt>{total.label}</dt>
            <dd className="m-0 text-right whitespace-nowrap">{total.value}</dd>
          </div>
        ))}
      </dl>
      <dl className="m-0 flex flex-col gap-2">
        {notes.map((note) => (
          <div key={note.label} className="flex flex-col gap-1">
            <dt className="text-sm font-semibold text-fg-muted">
              {note.label}
            </dt>
            <dd className="m-0 wrap-anywhere">{note.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
