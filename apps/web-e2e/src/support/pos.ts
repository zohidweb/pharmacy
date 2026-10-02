/*
 * Fixtures of the e2e tests: a fresh browser context per test (its own IndexedDB, cache and Service
 * Worker) with the fake API installed, and the cashier's actions — open the POS, scan like a USB
 * HID scanner (a fast burst of keys and Enter, read by `event.code`), pay.
 */
import { expect, test as base, type Page } from '@playwright/test';
import { FakeApi } from './fake-api';

export const test = base.extend<{ api: FakeApi }>({
  // automatic: no test may reach the static server for /api/v1 by forgetting the fixture
  api: [
    async ({ context }, use) => {
      const api = new FakeApi();
      await api.install(context);
      await use(api);
    },
    { auto: true },
  ],
});

export { expect };

export const receipt = (page: Page) =>
  page.getByRole('region', { name: 'Чек' });

export async function openPos(page: Page) {
  await page.goto('/pos');
  await expect(
    page.getByRole('list', { name: 'Найденные товары' }),
  ).toBeVisible();
}

/**
 * A USB HID scanner: one burst of key presses (`event.code` Digit…, no layout) and Enter, faster
 * than a person types. Sent in one go on the page — separate CDP calls under a loaded machine
 * would be slower than the scanner's 35 ms gap and look like typing.
 */
export async function scan(page: Page, code: string) {
  await page.evaluate((digits) => {
    const target = document.activeElement ?? document.body;
    const press = (key: string, keyCode: string) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, code: keyCode, bubbles: true }),
      );
    for (const digit of digits) press(digit, `Digit${digit}`);
    press('Enter', 'Enter');
  }, code);
}

export async function payCash(page: Page) {
  await receipt(page)
    .getByRole('button', { name: /Оплатить/ })
    .click();
  return page.getByRole('dialog', { name: 'Чек оплачен' });
}

/** The number of operations waiting in the outbox, as the header shows it. */
export const bufferBadge = (page: Page, count: number) =>
  page.getByText(`Нет связи — в буфере: ${count}`);
