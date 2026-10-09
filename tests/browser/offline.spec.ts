import { test, expect } from '@playwright/test';
import { activePlan, fixture } from './fixtures';

test.afterEach(async ({ request }) => {
  if (process.env.TEST_PRODUCTION) await request.post('http://127.0.0.1:8879/__test/connection', { data: { offline: false } });
});

for (const theme of [
  { name: 'light', background: '#f4f6f7', backgroundRgb: 'rgb(244, 246, 247)', navigation: 'rgb(255, 255, 255)' },
  { name: 'pink', background: '#ffd6eb', backgroundRgb: 'rgb(255, 214, 235)', navigation: 'rgb(255, 246, 251)' },
  { name: 'custom', background: '#eef4ff', backgroundRgb: 'rgb(238, 244, 255)', navigation: 'rgb(255, 255, 255)' },
]) {
test(`production PWA cold-starts offline with lazy screens, saved login, and ${theme.name} theme`, async ({ page, context, browserName, request }) => {
  test.skip(!process.env.TEST_PRODUCTION, 'Requires the built production app and its service worker.');
  await fixture(page, false);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript((theme) => {
    const settings = JSON.parse(localStorage.getItem('zutnik_pwa_settings') || '{}');
    localStorage.setItem('zutnik_pwa_settings', JSON.stringify({ ...settings, theme: theme.name,
      customPalette: { accent: '#2161e8', background: '#eef4ff', surface: '#ffffff', text: '#182943', lecture: '#b9c8e8', laboratory: '#d7bce2', exercises: '#a9ddd5' } }));
  }, theme);
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
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', theme.background);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light');
  await expect(page.locator('.android-appbar')).toHaveCSS('background-color', theme.backgroundRgb);
  await expect(page.locator('.primary-navigation')).toHaveCSS('background-color', theme.navigation);
  if (theme.name !== 'light') await expect(page.locator('html')).toHaveAttribute('data-theme-variant', theme.name);
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
  await page.screenshot({ path: `test-results/production-offline-plan-${theme.name}.png` });
  expect(requests.length).toBe(before);
});
}
