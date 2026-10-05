import { test, expect, type Page } from '@playwright/test';
import { fixture } from './fixtures';

const actionName = 'Zapisz jako aplikację';
const installButton = (page: Page) => page.getByRole('button', { name: actionName, exact: true });
const guide = (page: Page) => page.getByRole('dialog', { name: actionName, exact: true });

async function start(page: Page) {
  const requests = await fixture(page);
  await page.goto('');
  await expect(page.locator('.home-hero-study')).toContainText('Informatyka');
  await expect(installButton(page)).toBeVisible();
  return requests;
}

async function nativePrompt(page: Page, outcome: 'accepted' | 'dismissed' | 'error' | 'pending') {
  await page.evaluate((result) => {
    const state = window as Window & {
      __promptCalls?: number;
      __resolveInstall?: (choice: { outcome: 'accepted' | 'dismissed' }) => void;
    };
    state.__promptCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        state.__promptCalls!++;
        if (result === 'error') throw new Error('Install prompt unavailable');
      },
      userChoice: result === 'pending'
        ? new Promise((resolve) => { state.__resolveInstall = resolve; })
        : Promise.resolve({ outcome: result === 'accepted' ? 'accepted' : 'dismissed' }),
    });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('Install prompt was not captured');
  }, outcome);
}

const platforms = [
  { name: 'android', width: 393, height: 852, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36', platform: 'Linux', touch: 5, target: 'Na ekranie głównym telefonu', step: 'Dodaj do ekranu głównego' },
  { name: 'iphone-safari', width: 393, height: 852, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', touch: 5, target: 'Na ekranie początkowym iPhone’a lub iPada', step: 'Dodaj do ekranu początkowego' },
  { name: 'iphone-chrome', width: 393, height: 852, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0.0.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', touch: 5, target: 'Na ekranie początkowym iPhone’a lub iPada', step: 'otwórz ten sam adres w Safari' },
  { name: 'ipad-desktop-mode', width: 1024, height: 768, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', platform: 'MacIntel', touch: 5, target: 'Na ekranie początkowym iPhone’a lub iPada', step: 'Dodaj do ekranu początkowego' },
  { name: 'mac-safari', width: 1440, height: 900, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', platform: 'MacIntel', touch: 0, target: 'W Docku na Macu', step: 'Dodaj do Docka' },
  { name: 'desktop-firefox', width: 1366, height: 768, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0', platform: 'Win32', touch: 0, target: 'Na komputerze', step: 'otwórz ten sam adres w Chrome lub Edge' },
  { name: 'small-phone', width: 320, height: 568, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36', platform: 'Linux', touch: 5, target: 'Na ekranie głównym telefonu', step: 'Dodaj do ekranu głównego' },
  { name: 'landscape', width: 844, height: 390, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36', platform: 'Linux', touch: 5, target: 'Na ekranie głównym telefonu', step: 'Dodaj do ekranu głównego' },
];

for (const platform of platforms) {
  test(`manual installation fits and makes no API requests: ${platform.name}`, async ({ page }) => {
    await page.setViewportSize(platform);
    await page.addInitScript((profile) => {
      Object.defineProperties(navigator, {
        userAgent: { value: profile.userAgent }, platform: { value: profile.platform },
        maxTouchPoints: { value: profile.touch },
      });
    }, platform);
    const requests = await start(page);
    const count = requests.length;
    await expect(page.getByRole('button', { name: 'Edytuj kafelki' })).toHaveCount(0);
    await installButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(guide(page)).toBeVisible();
    await expect(guide(page)).toContainText(platform.target);
    await expect(guide(page)).toContainText(platform.step);
    await expect(guide(page).locator('.pwa-install-steps li')).toHaveCount(3);
    const image = guide(page).locator('img');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    expect(await guide(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await guide(page).evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})));
      await document.fonts.ready;
    });
    await page.screenshot({ path: `test-results/install-${platform.name}.png` });
    await guide(page).getByRole('button', { name: 'Rozumiem', exact: true }).click();
    await expect(guide(page)).toHaveCount(0);
    await expect(installButton(page)).toBeFocused();
    expect(requests.length).toBe(count);
  });
}

test('accepting a native prompt removes installation actions', async ({ page }) => {
  await start(page);
  await nativePrompt(page, 'accepted');
  await installButton(page).click();
  await expect(installButton(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __promptCalls: number }).__promptCalls)).toBe(1);
  await expect(guide(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('button', { name: 'O aplikacji', exact: true }).click();
  await expect(page.locator('.about-screen')).toBeVisible();
  await expect(installButton(page)).toHaveCount(0);
});

test('dismissed prompt is consumed once; a new prompt can still install', async ({ page }) => {
  await start(page);
  await nativePrompt(page, 'dismissed');
  await installButton(page).click();
  await expect(installButton(page)).toBeEnabled();
  await expect(guide(page)).toHaveCount(0);
  await installButton(page).click();
  await expect(guide(page)).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __promptCalls: number }).__promptCalls)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(guide(page)).toHaveCount(0);
  await nativePrompt(page, 'accepted');
  await installButton(page).click();
  await expect(installButton(page)).toHaveCount(0);
});

test('native prompt failure opens guidance without an unhandled error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page);
  await nativePrompt(page, 'error');
  await installButton(page).click();
  await expect(guide(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(installButton(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

test('native installation cannot be launched twice while pending', async ({ page }) => {
  await start(page);
  await nativePrompt(page, 'pending');
  await installButton(page).click();
  await expect(installButton(page)).toBeDisabled();
  await installButton(page).evaluate((element: HTMLButtonElement) => element.click());
  expect(await page.evaluate(() => (window as Window & { __promptCalls: number }).__promptCalls)).toBe(1);
  await page.evaluate(() => (window as Window & { __resolveInstall: (choice: { outcome: 'dismissed' }) => void }).__resolveInstall({ outcome: 'dismissed' }));
  await expect(installButton(page)).toBeEnabled();
});

test('installation from browser chrome hides the action and closes guidance', async ({ page }) => {
  await start(page);
  await installButton(page).click();
  await expect(guide(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(guide(page)).toHaveCount(0);
  await expect(installButton(page)).toHaveCount(0);
});

test('switching to standalone reacts without reloading the app', async ({ page }) => {
  await page.addInitScript(() => {
    let appMode = false;
    const modes = new Set<MediaQueryList>();
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const media = original(query);
      if (query === '(display-mode: standalone)') {
        Object.defineProperty(media, 'matches', { get: () => appMode });
        modes.add(media);
      }
      return media;
    };
    (window as Window & { __enterAppMode: () => void }).__enterAppMode = () => {
      appMode = true;
      modes.forEach((media) => media.dispatchEvent(new Event('change')));
    };
  });
  await start(page);
  await installButton(page).click();
  await page.evaluate(() => (window as Window & { __enterAppMode: () => void }).__enterAppMode());
  await expect(guide(page)).toHaveCount(0);
  await expect(installButton(page)).toHaveCount(0);
});

for (const mode of ['standalone', 'minimal-ui', 'ios']) {
  test(`already installed ${mode} has no installation action`, async ({ page }) => {
    await fixture(page);
    await page.addInitScript((displayMode) => {
      if (displayMode === 'ios') { Object.defineProperty(navigator, 'standalone', { value: true }); return; }
      const match = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const media = match(query);
        if (query === `(display-mode: ${displayMode})`) Object.defineProperty(media, 'matches', { value: true });
        return media;
      };
    }, mode);
    await page.goto('');
    await expect(page.getByRole('heading', { name: 'Start', exact: true })).toBeVisible();
    await expect(installButton(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edytuj kafelki' })).toHaveCount(0);
  });
}

test('browser Back closes the install sheet without leaving Home', async ({ page }) => {
  await start(page);
  await installButton(page).click();
  await expect(guide(page)).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(guide(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Start', exact: true })).toBeVisible();
});

test('insecure origins show the HTTPS requirement instead of invoking installation', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false }));
  await start(page);
  await nativePrompt(page, 'accepted');
  await installButton(page).click();
  await expect(guide(page)).toContainText('wymagają HTTPS');
  expect(await page.evaluate(() => (window as Window & { __promptCalls: number }).__promptCalls)).toBe(0);
});

test('the About installation action uses the same flow', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('button', { name: 'O aplikacji', exact: true }).click();
  await installButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(guide(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guide(page)).toHaveCount(0);
  await expect(installButton(page)).toBeFocused();
});

test('installation guidance follows the English language setting', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem('zutnik_pwa_settings')!);
    localStorage.setItem('zutnik_pwa_settings', JSON.stringify({ ...settings, language: 'en' }));
  });
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save as an app', exact: true }).click();
  const instructions = page.getByRole('dialog', { name: 'Save as an app', exact: true });
  await expect(instructions.locator('.pwa-install-steps li')).toHaveCount(3);
  await expect(instructions).not.toContainText('install.');
  await instructions.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(instructions).toHaveCount(0);
});
