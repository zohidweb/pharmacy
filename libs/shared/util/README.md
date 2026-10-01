# @pharmacy/shared-util

Utilities shared by `apps/api`, `apps/web` and `apps/admin` (`type:util`).

- `formatMoney`, `parseMoneyToMinor` — money in integer dirams, TJS only (ADR-0016).
- `formatDateOnly`, `formatDateTime`, `toAppDate`, `daysBetween` — dates in Asia/Dushanbe.
- `uuidv7` — time-ordered ids and the Idempotency-Key of buffered POS operations (ADR-0015, `uuid`).
- `receiptRow`, `receiptWrap`, `receiptCenter`, `receiptRule` — fixed-width lines of printed receipts.

`npx nx test shared-util` — unit tests (Jest).
