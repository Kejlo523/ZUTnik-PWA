import { test, expect } from '@playwright/test';
import { fixture } from './fixtures';

for (const viewport of [{ name: 'phone', width: 320, height: 640 }, { name: 'pc', width: 1366, height: 768 }]) {
  test(`remaining screens and login: ${viewport.name}`, async ({ page }) => {
    await fixture(page); await page.setViewportSize(viewport); await page.goto('');
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    for (const screen of [{ label: 'Finanse', selector: '.finance-record-card', file: 'finance' }, { label: 'Aktualności', selector: '.news-card', file: 'news' }, { label: 'Przydatne strony', selector: '.link-card', file: 'links' }, { label: 'O aplikacji', selector: '.about-app-name', file: 'about' }]) {
      await page.locator('.primary-navigation').getByRole('button', { name: 'Więcej', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: screen.label, exact: true }).click();
      await expect(page.locator(screen.selector).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: `test-results/${viewport.name}-${screen.file}.png` });
    }
    await page.locator('.primary-navigation').getByRole('button', { name: 'Studia', exact: true }).click();
    await expect(page.getByText('Wydział Informatyki', { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/${viewport.name}-info.png` });
    await page.locator('.primary-navigation').getByRole('button', { name: 'Więcej', exact: true }).click();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Zaloguj przez USOS' })).toBeVisible();
    await page.screenshot({ path: `test-results/${viewport.name}-login.png` });
    expect(errors).toEqual([]);
  });
}
