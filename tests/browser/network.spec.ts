import { expect, test } from '@playwright/test';
import { fixture } from './fixtures';

test('grades and studies share ECTS and repeated screen visits do not refetch', async ({ page }) => {
  const requests = await fixture(page); await page.goto('');
  const nav = page.locator('.primary-navigation');
  await nav.getByRole('button', { name: 'Oceny', exact: true }).click();
  await expect(page.locator('.grade-group')).toHaveCount(2);
  await expect.poll(() => requests.filter((path) => path.endsWith('/usos/credits')).length).toBe(1);
  await nav.getByRole('button', { name: 'Studia', exact: true }).click();
  await expect(page.getByText('Wydział Informatyki', { exact: true })).toBeVisible();
  expect(requests.filter((path) => path.endsWith('/usos/credits'))).toHaveLength(1);
  for (let i = 0; i < 3; i++) {
    await nav.getByRole('button', { name: 'Oceny', exact: true }).click();
    await expect(page.locator('.grade-group')).toHaveCount(2);
    await nav.getByRole('button', { name: 'Studia', exact: true }).click();
    await expect(page.getByText('Wydział Informatyki', { exact: true })).toBeVisible();
  }
  expect(requests.filter((path) => path.endsWith('/usos/grades'))).toHaveLength(1);
  expect(requests.filter((path) => path.endsWith('/usos/info'))).toHaveLength(1);
  expect(requests.filter((path) => path.endsWith('/usos/credits'))).toHaveLength(1);
  await nav.getByRole('button', { name: 'Oceny', exact: true }).click();
  await page.locator('.appbar-actions').getByRole('button', { name: 'Odśwież', exact: true }).click();
  await expect.poll(() => requests.filter((path) => path.endsWith('/usos/credits')).length).toBe(2);
});

test('startup validation and study loading share their in-flight profile request', async ({ page }) => {
  const requests = await fixture(page);
  await page.addInitScript(() => {
    const session = JSON.parse(localStorage.getItem('zutnik_pwa_session')!);
    localStorage.setItem('zutnik_pwa_session', JSON.stringify({ ...session, persistedAt: 1 }));
  });
  await page.goto('');
  await expect(page.locator('.home-hero-study')).toContainText('Informatyka');
  expect(requests.filter((path) => path.endsWith('/usos/me'))).toHaveLength(1);
});
