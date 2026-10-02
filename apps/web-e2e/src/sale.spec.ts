/*
 * A sale online through the real HTTP client: scan by the USB HID scanner → receipt line → payment;
 * the request carries the Idempotency-Key (the UUIDv7 of the operation) and a correlation ID.
 */
import { PARACETAMOL } from './support/fake-api';
import { expect, openPos, payCash, receipt, scan, test } from './support/pos';

test('sells a scanned product with an Idempotency-Key', async ({
  page,
  api,
}) => {
  await openPos(page);
  await scan(page, PARACETAMOL);
  await expect(
    receipt(page).getByText('Парацетамол 500 мг, таб. №10'),
  ).toBeVisible();

  const paid = await payCash(page);
  await expect(paid.getByText('Чек №1042', { exact: true })).toBeVisible();

  expect(api.receiptRequests).toHaveLength(1);
  const [request] = api.receiptRequests;
  expect(request.idempotencyKey).toBe(request.body.id);
  // UUIDv7: version nibble 7
  expect(request.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  expect(request.correlationId).toBeTruthy();
});
