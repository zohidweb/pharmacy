/*
 * Service Worker of the cloud build (ADR-0015, ось 6б): after the first visit the POS opens with no
 * network at all (pages and static from the precache, catalog from IndexedDB) and keeps selling
 * into the buffer; a new version waits while a receipt is in progress and is activated only when
 * the receipt is empty.
 */
import type { Page } from '@playwright/test';
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

/** The worker takes control (clients.claim); the app then reloads once while the receipt is empty. */
async function waitForWorker(page: Page) {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    null,
    {
      timeout: 30_000,
    },
  );
  await expect(
    page.getByRole('list', { name: 'Найденные товары' }),
  ).toBeVisible();
}

test('opens the POS without any network after the first visit', async ({
  page,
  context,
  api,
}) => {
  await openPos(page);
  await waitForWorker(page);

  await context.setOffline(true);
  api.online = false;
  await page.reload();
  await expect(
    page.getByRole('list', { name: 'Найденные товары' }),
  ).toBeVisible();
  await scan(page, PARACETAMOL);
  await expect(
    receipt(page).getByText('Парацетамол 500 мг, таб. №10'),
  ).toBeVisible();
  const paid = await payCash(page);
  await expect(
    paid.getByText(/Нет связи: чек сохранён в буфере/),
  ).toBeVisible();
  await paid.getByRole('button', { name: 'Новый чек' }).click();
  await expect(bufferBadge(page, 1)).toBeVisible();

  await context.setOffline(false);
  api.online = true;
  await expect(page.getByText('В сети · очередь: 0')).toBeVisible({
    timeout: 45_000,
  });
  expect(api.sales).toBe(1);
});

test('activates a new version only when the receipt is empty', async ({
  page,
  context,
}) => {
  // the app checks for a waiting worker every 30 s: the test moves the clock instead of waiting
  await page.clock.install();
  await openPos(page);
  await waitForWorker(page);

  // a new build: the test server serves the worker with other bytes to this context
  await context.addCookies([
    { name: 'e2e-sw-release', value: 'next', url: page.url() },
  ]);
  await scan(page, PARACETAMOL);
  await expect(
    receipt(page).getByText('Парацетамол 500 мг, таб. №10'),
  ).toBeVisible();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.waiting);
  });

  // a sale is in progress: the new version keeps waiting
  await page.clock.fastForward(31_000);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
      ),
    )
    .toBe(true);
  await expect(
    receipt(page).getByText('Парацетамол 500 мг, таб. №10'),
  ).toBeVisible();

  // the receipt is emptied: the next check activates it and the page reloads on the new version
  await receipt(page)
    .getByRole('button', {
      name: 'Удалить из чека: Парацетамол 500 мг, таб. №10',
    })
    .click();
  await expect(receipt(page).getByText('Чек пуст')).toBeVisible();
  const reloaded = page.waitForEvent('load');
  await page.clock.fastForward(31_000);
  await reloaded;
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
      ),
    )
    .toBe(false);
});
