/*
 * The outbox of the POS in a real browser (ADR-0015): a sale during an outage waits in IndexedDB
 * and is sent once the connection is back; a retry after a lost answer never makes a second sale;
 * a rejected operation goes to «Требует разбора»; the buffer and the draft survive a reload.
 */
import { PARACETAMOL } from './support/fake-api';
import {
  bufferBadge,
  expect,
  openPos,
  payCash,
  receipt,
  scan,
  test,
} from './support/pos';

/** The outbox waits up to a ping of the connection detector (10 s) plus a backoff. */
const RESEND = { timeout: 45_000 };

test('keeps selling during an outage and sends the receipt when the connection is back', async ({
  page,
  api,
}) => {
  await openPos(page);
  await scan(page, PARACETAMOL);
  await expect(
    receipt(page).getByText('Парацетамол 500 мг, таб. №10'),
  ).toBeVisible();

  api.online = false;
  const paid = await payCash(page);
  await expect(
    paid.getByText(/Нет связи: чек сохранён в буфере/),
  ).toBeVisible();
  await paid.getByRole('button', { name: 'Новый чек' }).click();
  await expect(bufferBadge(page, 1)).toBeVisible();
  expect(api.sales).toBe(0);

  api.online = true;
  await expect(page.getByText('В сети · очередь: 0')).toBeVisible(RESEND);
  expect(api.sales).toBe(1);
  const keys = new Set(api.receiptRequests.map((r) => r.idempotencyKey));
  expect(keys.size).toBe(1);
});

test('never sells twice when the answer of the server is lost', async ({
  page,
  api,
}) => {
  await openPos(page);
  await scan(page, PARACETAMOL);
  await expect(
    receipt(page).getByText('Парацетамол 500 мг, таб. №10'),
  ).toBeVisible();

  // the server takes the sale, the answer does not reach the POS: the outbox retries
  api.loseNextReceiptAnswer();
  await payCash(page);
  await expect(page.getByText('В сети · очередь: 0')).toBeVisible(RESEND);

  expect(api.receiptRequests.length).toBeGreaterThanOrEqual(2);
  expect(new Set(api.receiptRequests.map((r) => r.idempotencyKey)).size).toBe(
    1,
  );
  expect(api.sales).toBe(1);
});

test('puts a rejected receipt aside for review instead of dropping it', async ({
  page,
  api,
}) => {
  await openPos(page);
  await scan(page, PARACETAMOL);
  await expect(
    receipt(page).getByText('Парацетамол 500 мг, таб. №10'),
  ).toBeVisible();

  api.failNextReceiptWith(409, 'idempotency_conflict');
  await payCash(page);
  await expect(page.getByText('Требует разбора: 1')).toBeVisible(RESEND);
  expect(api.sales).toBe(0);

  // the operation is kept: the shift screen lists it for the manager
  await page.goto('/shift');
  await expect(page.getByText(/Требует разбора/).first()).toBeVisible();
});

test('pauses the outbox when the session has expired', async ({
  page,
  api,
}) => {
  await openPos(page);
  await scan(page, PARACETAMOL);
  await expect(
    receipt(page).getByText('Парацетамол 500 мг, таб. №10'),
  ).toBeVisible();

  api.failNextReceiptWith(401, 'unauthenticated');
  await payCash(page);
  await expect(page.getByText('Отправка ждёт входа в систему')).toBeVisible(
    RESEND,
  );
  expect(api.sales).toBe(0);
});

test('keeps the buffer and the draft receipt through a reload', async ({
  page,
  api,
}) => {
  await openPos(page);
  await scan(page, PARACETAMOL);
  await expect(
    receipt(page).getByText('Парацетамол 500 мг, таб. №10'),
  ).toBeVisible();
  api.online = false;
  const paid = await payCash(page);
  await paid.getByRole('button', { name: 'Новый чек' }).click();
  await expect(bufferBadge(page, 1)).toBeVisible();

  // the next customer: a line in the draft, then the page is reloaded
  await scan(page, '4870001000079');
  await expect(
    receipt(page).getByText('Витамин D3 2000 МЕ, капс. №60'),
  ).toBeVisible();
  api.online = true;
  await page.reload();
  await expect(
    receipt(page).getByText('Витамин D3 2000 МЕ, капс. №60'),
  ).toBeVisible();
  await expect(page.getByText('В сети · очередь: 0')).toBeVisible(RESEND);
  expect(api.sales).toBe(1);
});
