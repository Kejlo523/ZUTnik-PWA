import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixtures';

const series = Array.from({ length: 30 }, (_, i) => ({ key: `2026-09-${String(i + 1).padStart(2, '0')}`, labelShort: `${i + 1}.09`, labelLong: `${i + 1} września`, activeDevices: 10 + (i * 7) % 31, successfulLogins: i % 6, newDevices: i % 3 }));
const snapshot = {
  series, kpis: { todayActiveDevices: 27, uniqueActive30d: 123, returningDevices30d: 84, returningShare30d: 68.3, newDevices30d: 39, successfulLoginsToday: 5, successfulLoginsTotal: 204, totalDevices: 170, totalApiHits: 8102, averageActive7d: 25.4, averageLogins7d: 2.9, todayDeltaActive: 3, todayDeltaLogins: 1, newDevicesToday: 2 },
  peaks: { active: null, logins: null }, topDays: [], recentRows: series.slice(-7), activeMix: [], loginMethods: [{ key: 'usos', label: 'USOS OAuth', count: 204, share: 100 }], loginMethodCoverage: { recordedTotal: 204, overallTotal: 204, isPartial: false },
  meta: { todayKey: '2026-09-30', trackedSinceLabel: '1 czerwca 2026', updatedAtLabel: '6 paź 2026, 22:00', chartMax: 40 },
  network: { requests: 126, cacheHits: 943, coalesced: 81, backoffSkips: 12, errors: 2, entries: 24, bytes: 84320, pending: 0, startedAt: Date.parse('2026-10-05T08:00:00Z'), updatedAt: Date.parse('2026-10-06T20:00:00Z'), endpoints: [{ endpoint: 'services/tt/student', requests: 83, cacheHits: 640, coalesced: 32, backoffSkips: 0, errors: 0 }, { endpoint: 'services/grades/terms2', requests: 14, cacheHits: 108, coalesced: 20, backoffSkips: 12, errors: 2 }, { endpoint: 'services/courses/user_ects_points', requests: 8, cacheHits: 76, coalesced: 4, backoffSkips: 0, errors: 0 }] },
};

async function start(page: Page, theme = 'dark', delay = 0) {
  await fixture(page);
  await page.addInitScript((theme) => {
    const session = JSON.parse(localStorage.getItem('zutnik_pwa_session')!);
    localStorage.setItem('zutnik_pwa_session', JSON.stringify({ ...session, userId: '57796' }));
    const settings = JSON.parse(localStorage.getItem('zutnik_pwa_settings')!);
    localStorage.setItem('zutnik_pwa_settings', JSON.stringify({ ...settings, theme }));
  }, theme);
  let count = 0;
  await page.context().route('**/api/stats/snapshot', async (route) => {
    count++;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ snapshot }) });
  });
  await page.goto('');
  await openStats(page);
  return () => count;
}
async function openStats(page: Page) {
  await page.locator('.primary-navigation').getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Statystyki', exact: true }).click();
}

for (const viewport of [{ name: 'small', width: 320, height: 568 }, { name: 'phone', width: 393, height: 852 }, { name: 'desktop', width: 1366, height: 768 }]) {
  for (const theme of ['light', 'dark']) {
    test(`clear responsive statistics and nonblank chart: ${viewport.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
      const count = await start(page, theme);
      await expect(page.getByRole('img', { name: 'Aktywne urządzenia', exact: true })).toBeVisible();
      await expect.poll(() => page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext('2d')!;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let filled = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) filled++;
        return filled;
      })).toBeGreaterThan(100);
      await page.screenshot({ path: `test-results/stats-${viewport.name}-${theme}.png` });
      const before = count();
      await page.getByRole('button', { name: '7 dni', exact: true }).click();
      await page.getByRole('button', { name: 'Nowe urządzenia', exact: true }).click();
      await expect(page.getByRole('img', { name: 'Nowe urządzenia', exact: true })).toBeVisible();
      await page.getByText('Dane dzienne', { exact: true }).click();
      await expect(page.locator('.stats-history tbody tr')).toHaveCount(7);
      await page.getByRole('tab', { name: 'Ruch USOS', exact: true }).click();
      await expect(page.locator('.stats-endpoints tbody tr')).toHaveCount(3);
      await expect(page.locator('.stats-screen')).not.toContainText(/Legacy API|Źródła logowania|Inne/);
      await page.screenshot({ path: `test-results/stats-traffic-${viewport.name}-${theme}.png` });
      expect(count()).toBe(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.stats-screen').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test('stats cache survives reload and offline; a refresh burst is not repeated', async ({ page }) => {
  const count = await start(page);
  await expect(page.locator('canvas')).toBeVisible();
  expect(count()).toBe(1);
  await page.locator('.appbar-actions').getByRole('button', { name: 'Odśwież', exact: true }).click();
  await expect.poll(count).toBe(2);
  await expect(page.locator('.stats-screen')).toHaveAttribute('aria-busy', 'false');
  for (let i = 0; i < 5; i++) await page.locator('.appbar-actions').getByRole('button', { name: 'Odśwież', exact: true }).click();
  await page.locator('.primary-navigation').getByRole('button', { name: 'Start', exact: true }).click();
  await openStats(page);
  await expect(page.locator('canvas')).toBeVisible();
  await page.reload(); await expect(page.locator('canvas')).toBeVisible();
  expect(count()).toBe(2);
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await page.reload(); await expect(page.locator('canvas')).toBeVisible();
  await page.locator('.appbar-actions').getByRole('button', { name: 'Odśwież', exact: true }).click();
  expect(count()).toBe(2);
});

test('skeleton matches the chart layout; refresh is disabled while loading', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await start(page, 'dark', 2000);
  await expect(page.locator('.stats-chart-loading')).toBeVisible();
  await expect(page.locator('.stats-kpi')).toHaveCount(4);
  await expect(page.locator('.appbar-actions').getByRole('button', { name: 'Odśwież', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/stats-loading.png' });
  await expect(page.locator('canvas')).toBeVisible();
});

test('stats entry remains unavailable for other accounts', async ({ page }) => {
  const requests = await fixture(page); await page.goto('');
  await page.locator('.primary-navigation').getByRole('button', { name: 'Więcej', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Statystyki', exact: true })).toHaveCount(0);
  expect(requests.some((path) => path.includes('/stats/'))).toBe(false);
});

test('Pink and live custom colors update chart pixels without reloading statistics', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const count = await start(page, 'pink');
  await expect(page.locator('canvas')).toBeVisible();
  const chartColorPixels = () => page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--mz-primary').trim();
    const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let matching = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === rgb[0] && pixels[i + 1] === rgb[1] && pixels[i + 2] === rgb[2] && pixels[i + 3] === 255) matching++;
    return matching;
  });
  await expect.poll(chartColorPixels).toBeGreaterThan(100);
  await page.screenshot({ path: 'test-results/stats-pink.png' });
  await page.evaluate(() => document.documentElement.style.setProperty('--mz-primary', '#156bdd'));
  await expect.poll(() => errors).toEqual([]);
  await expect.poll(chartColorPixels).toBeGreaterThan(100);
  expect(count()).toBe(1);
  await page.locator('.primary-navigation').getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ustawienia', exact: true }).click();
  await page.locator('#app-theme').selectOption('custom');
  await page.getByRole('button', { name: 'Paleta błękitna', exact: true }).click();
  await openStats(page);
  await expect.poll(chartColorPixels).toBeGreaterThan(100);
  await page.screenshot({ path: 'test-results/stats-custom.png' });
  expect(count()).toBe(1);
  expect(errors).toEqual([]);
});
