import { expect, test } from '@playwright/test';
import { activePlan, fixture } from './fixtures';

test.describe('phone timetable footer', () => {
  test.use({ hasTouch: true });
  for (const viewport of [{ width: 393, height: 852 }, { width: 844, height: 390 }]) {
    test(`legend and bottom export are hidden at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await fixture(page);
      await page.setViewportSize(viewport);
      await page.goto('');
      await page.getByRole('button', { name: 'Plan', exact: true }).click();
      await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
      await expect(activePlan(page).locator('.timetable-footer')).toBeHidden();
      await page.getByRole('button', { name: 'Więcej opcji planu', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Eksport semestru' })).toBeVisible();
    });
  }
});

test('desktop retains the timetable footer', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('');
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
  await expect(activePlan(page).locator('.timetable-footer')).toBeVisible();
  await expect(activePlan(page).getByRole('button', { name: 'Eksport semestru', exact: true })).toBeVisible();
});
