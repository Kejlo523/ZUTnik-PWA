import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { activePlan, fixture } from './fixtures';

test('settings export excludes credentials and import applies tiles and filters immediately', async ({ page }) => {
  await fixture(page); await page.goto('');
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ustawienia', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Eksport ustawień' }).click();
  const file = await downloaded;
  const backup = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(JSON.stringify(backup)).not.toMatch(/fixture-token|fixture-secret|accessToken/);
  const filter = 'Transmisja danych||lec';
  await page.locator('input[type=file]').setInputFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, settings: { ...backup.settings, theme: 'light' }, filters: [filter], tiles: [{ id: 'custom', title: 'Moje oceny', description: '', icon: 'grade', action: 'grades' }] })) });
  await expect(page.getByRole('status')).toContainText('Ustawienia zaimportowane');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/light-plan.png' });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.tile')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Moje oceny', exact: true })).toBeVisible();
});

test('news details return to the news list, not home', async ({ page }) => {
  await fixture(page); await page.goto('');
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aktualności', exact: true }).click();
  await page.locator('.news-card').first().click();
  await expect(page.locator('.news-detail-title')).toContainText('Rozpoczęcie');
  await page.getByRole('button', { name: 'Wróć', exact: true }).click();
  await expect(page.locator('.news-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Aktualności', exact: true })).toBeVisible();
});

test('day and month views stay functional; expired OAuth preserves saved grades', async ({ page, context }) => {
  await fixture(page); await page.goto('');
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
  await activePlan(page).locator('.timetable-head button').first().click();
  await expect(page.getByRole('tab', { name: 'Dzień', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(activePlan(page).locator('.timetable-day')).toHaveCount(1);
  await expect(activePlan(page).locator('.timetable-event')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Miesiąc' }).click();
  await expect(activePlan(page).locator('.month-cell')).toHaveCount(42);
  await page.getByRole('tab', { name: 'Tydzień' }).click();
  await expect(activePlan(page).locator('.timetable-head button')).toHaveCount(5);
  await page.locator('.primary-navigation').getByRole('button', { name: 'Oceny', exact: true }).click();
  await expect(page.locator('.grade-group')).toHaveCount(2);
  await context.route('**/usos/grades', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'token_rejected' }) }));
  await page.getByRole('button', { name: 'Odśwież', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.grade-group')).toHaveCount(2);
  expect(await page.evaluate(() => !!localStorage.getItem('zutnik_pwa_session'))).toBe(true);
});

test('native vertical touch scrolling and horizontal week navigation do not conflict', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Touch injection uses the Chromium protocol.');
  await fixture(page); await page.setViewportSize({ width: 393, height: 852 }); await page.goto('');
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const swipe = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 5; i++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 5, y: from.y + (to.y - from.y) * i / 5 }] });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const range = await page.locator('.plan-appbar-range').textContent();
  await swipe({ x: 180, y: 600 }, { x: 180, y: 300 });
  await expect.poll(() => activePlan(page).locator('.timetable-scroll').evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  await expect(page.locator('.plan-appbar-range')).toHaveText(range!);
  // Finish native fling scrolling before injecting a separate horizontal gesture.
  await activePlan(page).locator('.timetable-scroll').evaluate((element) => new Promise<void>((resolve) => {
    let previous = element.scrollTop; let stable = 0;
    const frame = () => {
      stable = Math.abs(element.scrollTop - previous) < .5 ? stable + 1 : 0;
      previous = element.scrollTop;
      if (stable >= 8) resolve(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
  await swipe({ x: 290, y: 400 }, { x: 80, y: 400 });
  await expect(page.locator('.plan-appbar-range')).not.toHaveText(range!);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
