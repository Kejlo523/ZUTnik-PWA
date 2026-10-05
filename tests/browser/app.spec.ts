import { test, expect } from '@playwright/test';
import { activePlan, fixture } from './fixtures';

for (const viewport of [{ name: 'mobile', width: 393, height: 852 }, { name: 'small', width: 320, height: 640 }, { name: 'desktop', width: 1366, height: 768 }, { name: 'landscape', width: 844, height: 390 }]) {
  test(`screens and scrolling: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const requests = await fixture(page);
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('');
    await expect(page.getByRole('heading', { name: 'Start', exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/${viewport.name}-home.png` });
    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
    await expect(page.locator('.sync-indicator')).toHaveCount(0);
    const scroller = activePlan(page).locator('.timetable-scroll');
    await scroller.evaluate((element) => { element.scrollTop = 180; });
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(180);
    await page.screenshot({ path: `test-results/${viewport.name}-plan.png` });
    const first = activePlan(page).locator('.timetable-event').first(); const key = await first.getAttribute('aria-label');
    const originalElement = await first.elementHandle();
    await page.getByRole('button', { name: 'Odśwież', exact: true }).click();
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(180);
    await expect(first).toHaveAttribute('aria-label', key!);
    await expect(page.locator('.sync-indicator')).toHaveCount(0);
    expect(await originalElement?.evaluate((element) => element.isConnected)).toBe(true);
    await first.click(); await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('.primary-navigation').getByRole('button', { name: 'Oceny', exact: true }).click();
    await expect(page.locator('.grade-group')).toHaveCount(2);
    await page.screenshot({ path: `test-results/${viewport.name}-grades.png` });
    await page.getByRole('button', { name: 'Więcej', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Więcej' })).toBeVisible();
    await page.screenshot({ path: `test-results/${viewport.name}-more.png` });
    await page.getByRole('button', { name: 'Ustawienia', exact: true }).click();
    await expect(page.getByLabel('Język', { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/${viewport.name}-settings.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
    expect(requests.filter((path) => path.endsWith('/timetable/week')).length).toBeLessThanOrEqual(4);
  });
}

test('home editing persists, search shortcut works, refresh cooldown avoids requests', async ({ page }) => {
  const requests = await fixture(page); await page.setViewportSize({ width: 393, height: 852 }); await page.goto('');
  await page.getByRole('button', { name: 'Edytuj kafelki' }).click();
  expect(await page.locator('.tile-editing').evaluateAll((tiles) => tiles.every((tile) => {
    const rect = tile.getBoundingClientRect();
    return [...tile.querySelectorAll('.tile-edit-tools button')].every((button) => {
      const box = button.getBoundingClientRect(); return box.width >= 44 && box.height >= 44 && box.left >= rect.left && box.right <= rect.right;
    });
  }))).toBe(true);
  await page.getByRole('button', { name: 'Dodaj kafelek' }).click();
  await page.getByLabel('Tytuł', { exact: true }).fill('Piotr');
  await page.getByLabel('Prowadzący / zapytanie').fill('Klęsk');
  await page.getByRole('button', { name: 'Gotowe', exact: true }).click();
  await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'Piotr', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Szukaj w planie' })).toBeVisible();
  await page.getByRole('button', { name: 'Piotr Klęsk [teacher-1]', exact: true }).click();
  await page.getByRole('button', { name: 'Szukaj', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
  await page.locator('.primary-navigation').getByRole('button', { name: 'Oceny', exact: true }).click();
  await expect(page.locator('.grade-group')).toHaveCount(2);
  await page.getByRole('button', { name: 'Odśwież', exact: true }).click();
  await expect.poll(() => requests.filter((path) => path.endsWith('/usos/grades')).length).toBe(2);
  await page.getByRole('button', { name: 'Odśwież', exact: true }).click();
  await expect(page.locator('.toast')).toBeVisible();
  expect(requests.filter((path) => path.endsWith('/usos/grades')).length).toBe(2);
});

test('cached grades and plan remain available offline without API attempts', async ({ page, context }) => {
  const requests = await fixture(page); await page.goto('');
  await page.locator('.primary-navigation').getByRole('button', { name: 'Oceny', exact: true }).click();
  await expect(page.locator('.grade-group')).toHaveCount(2);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
  await expect(page.locator('.sync-indicator')).toHaveCount(0);
  const count = requests.length;
  await context.setOffline(true);
  await page.locator('.primary-navigation').getByRole('button', { name: 'Oceny', exact: true }).click();
  await expect(page.locator('.grade-group')).toHaveCount(2);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
  await expect(page.locator('.offline-indicator')).toBeVisible();
  expect(requests.length).toBe(count);
  expect(await page.evaluate(() => !!localStorage.getItem('zutnik_pwa_session'))).toBeTruthy();
});
