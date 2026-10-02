/*
 * The cashier signs in by PIN on the terminal and lands on the POS; the PIN step and the POS with a
 * receipt have no serious or critical axe violations in a real browser (ADR-0009, «Доступность»).
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { CASHIER_PIN, PARACETAMOL } from './support/fake-api';
import { expect, openPos, receipt, scan, test } from './support/pos';

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
}

test('signs a cashier in by PIN and opens the POS', async ({ page, api }) => {
  api.signedIn = false;
  await page.goto('/login');
  await expect(
    page.getByRole('heading', { name: 'PIN кассира' }),
  ).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page
    .getByRole('group', { name: 'Кассир' })
    .getByRole('radio', { name: 'Зарина Р.' })
    .check();
  const keypad = page.getByRole('group', { name: 'Цифровая клавиатура' });
  for (const digit of CASHIER_PIN) {
    await keypad.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/pos$/);
  await expect(
    page.getByRole('list', { name: 'Найденные товары' }),
  ).toBeVisible();
});

test('has no serious axe violations on the POS with a receipt', async ({
  page,
}) => {
  await openPos(page);
  await scan(page, PARACETAMOL);
  await expect(
    receipt(page).getByText('Парацетамол 500 мг, таб. №10'),
  ).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
