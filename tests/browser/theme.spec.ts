import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixtures';

const themes = {
  dark: { background: 'rgb(16, 19, 23)', navigation: 'rgb(23, 28, 33)', chrome: '#101317', text: 'rgb(243, 245, 246)' },
  light: { background: 'rgb(244, 246, 247)', navigation: 'rgb(255, 255, 255)', chrome: '#f4f6f7', text: 'rgb(23, 32, 38)' },
};

async function expectTheme(page: Page, theme: 'light' | 'dark') {
  const colors = themes[theme];
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', colors.chrome);
  await expect(page.locator('meta[name="theme-color"]')).not.toHaveAttribute('media', /.+/);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', theme);
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
  await expect(page.locator('.app-shell')).toHaveCSS('background-color', colors.background);
  await expect(page.locator('.android-appbar')).toHaveCSS('background-color', colors.background);
  await expect(page.locator('.android-appbar h1')).toHaveCSS('color', colors.text);
  await expect(page.locator('.primary-navigation')).toHaveCSS('background-color', colors.navigation);
}

async function start(page: Page, theme: 'light' | 'dark' | 'system', system: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: system });
  const requests = await fixture(page);
  await page.addInitScript((preference) => {
    const settings = JSON.parse(localStorage.getItem('zutnik_pwa_settings')!);
    localStorage.setItem('zutnik_pwa_settings', JSON.stringify({ ...settings, theme: preference }));
  }, theme);
  await page.goto('');
  await expect(page.locator('.home-hero-study')).toContainText('Informatyka');
  return requests;
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ustawienia', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Motyw', exact: true })).toBeVisible();
}

for (const viewport of [{ name: 'phone', width: 393, height: 852 }, { name: 'small', width: 320, height: 568 }, { name: 'landscape', width: 844, height: 390 }, { name: 'desktop', width: 1366, height: 768 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`app and PWA chrome follow saved ${theme} regardless of system: ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await start(page, theme, theme === 'light' ? 'dark' : 'light');
      await expectTheme(page, theme);
      await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
      await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'default');
      await page.screenshot({ path: `test-results/theme-${viewport.name}-${theme}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

test('manual theme changes update both bars and browser metadata without requests', async ({ page }) => {
  const requests = await start(page, 'dark', 'dark');
  await openSettings(page);
  const count = requests.length;
  await page.getByRole('combobox', { name: 'Motyw', exact: true }).selectOption('light');
  await expectTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'light');
  await page.getByRole('combobox', { name: 'Motyw', exact: true }).selectOption('dark');
  await expectTheme(page, 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'dark');
  expect(requests.length).toBe(count);
});

test('system theme reacts to OS changes and survives offline API access on reload', async ({ page }) => {
  const requests = await start(page, 'system', 'dark');
  await expectTheme(page, 'dark');
  const count = requests.length;
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark');
  expect(requests.length).toBe(count);
  // The dev server has no SW; emulate offline API access but keep its shell available.
  await page.context().route('**/api/**', (route) => route.abort());
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { value: false }));
  await page.reload();
  await expectTheme(page, 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light');
});

test('switching from manual to system uses the current OS appearance immediately', async ({ page }) => {
  await start(page, 'dark', 'light');
  await openSettings(page);
  await page.getByRole('combobox', { name: 'Motyw', exact: true }).selectOption('system');
  await expectTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark');
});

test('login chrome follows the theme without requiring authentication', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => {
    localStorage.removeItem('zutnik_pwa_session');
    const settings = JSON.parse(localStorage.getItem('zutnik_pwa_settings')!);
    localStorage.setItem('zutnik_pwa_settings', JSON.stringify({ ...settings, theme: 'light' }));
  });
  await page.goto('');
  await expect(page.locator('.login-screen')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', themes.light.chrome);
  await expect(page.locator('.app-shell')).toHaveCSS('background-color', themes.light.background);
});
