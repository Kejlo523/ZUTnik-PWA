import { test, expect } from '@playwright/test';
import { activePlan, fixture } from './fixtures';

test.afterEach(async ({ request }) => {
  if (process.env.TEST_PRODUCTION) await request.post('http://127.0.0.1:8879/__test/connection', { data: { offline: false } });
});

test('production PWA cold-starts offline with lazy screens and saved login', async ({ page, context, browserName, request }) => {
  test.skip(!process.env.TEST_PRODUCTION, 'Requires the built production app and its service worker.');
  await fixture(page, false);
  const requests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/')) requests.push(request.url()); });
  await page.goto('');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.locator('.primary-navigation').getByRole('button', { name: 'Oceny', exact: true }).click();
  await expect(page.locator('.grade-group')).toHaveCount(2);
  await page.locator('.primary-navigation').getByRole('button', { name: 'Studia', exact: true }).click();
  await expect(page.getByText('Wydział Informatyki', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finanse', exact: true }).click();
  await expect(page.locator('.finance-record-card')).toHaveCount(1);
  await page.locator('.primary-navigation').getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
  await expect(page.locator('.sync-indicator')).toHaveCount(0);
  const before = requests.length;
  // WebKit's offline emulation rejects even cached SW responses (Playwright #42775).
  // Disconnect the fixture origin instead; no app shell or API can arrive from it.
  if (browserName === 'webkit') {
    await request.post('http://127.0.0.1:8879/__test/connection', { data: { offline: true } });
    await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  } else await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Plan zajęć', exact: true })).toBeVisible();
  await page.locator('.primary-navigation').getByRole('button', { name: 'Oceny', exact: true }).click();
  await expect(page.locator('.grade-group')).toHaveCount(2);
  await page.locator('.primary-navigation').getByRole('button', { name: 'Studia', exact: true }).click();
  await expect(page.getByText('Wydział Informatyki', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finanse', exact: true }).click();
  await expect(page.locator('.finance-record-card')).toHaveCount(1);
  await page.locator('.primary-navigation').getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
  await expect(page.locator('.offline-indicator')).toBeVisible();
  await page.screenshot({ path: 'test-results/production-offline-plan.png' });
  expect(requests.length).toBe(before);
});
