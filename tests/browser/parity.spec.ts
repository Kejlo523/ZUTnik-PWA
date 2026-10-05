import { test, expect, type Page } from '@playwright/test';
import { fixture } from './fixtures';

async function openMore(page: Page, name: string) {
  await page.locator('.primary-navigation').getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
}

for (const viewport of [{ name: 'narrow', width: 320, height: 640 }, { name: 'phone', width: 393, height: 852 }, { name: 'pc', width: 1366, height: 768 }]) {
  test(`Android layouts and cold loading: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const requests = await fixture(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const gates = new Map<string, { wait: Promise<void>; release: () => void }>();
    for (const module of ['grades', 'finance', 'info']) {
      let release!: () => void;
      const wait = new Promise<void>((resolve) => { release = resolve; });
      gates.set(module, { wait, release });
    }
    await page.route('**/api/usos/**', async (route) => {
      const module = new URL(route.request().url()).pathname.split('/').at(-1)!;
      const gate = gates.get(module);
      if (gate) await gate.wait;
      await route.fallback();
    });
    await page.goto('');
    await page.locator('.primary-navigation').getByRole('button', { name: 'Oceny', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Ładowanie ocen' })).toBeVisible();
    await expect(page.locator('.grades-header-wrapper .metric-card')).toHaveCount(3);
    await expect(page.locator('.grade-group-skeleton')).toHaveCount(4);
    expect(await page.locator('.skeleton-block').first().evaluate((node) => getComputedStyle(node).animationName)).toBe('skeleton-pulse');
    await page.screenshot({ animations: 'disabled', path: `test-results/parity-${viewport.name}-grades-loading.png` });
    gates.get('grades')!.release();
    await expect(page.locator('.grades-loading')).toHaveCount(0);
    await expect(page.locator('.grades-header-wrapper .metric-value').first()).toHaveText('3,75');
    const transmission = page.locator('.grade-subject').filter({ has: page.getByRole('button', { name: /Transmisja danych/ }) });
    await expect(transmission.locator('.grade-preview-pill')).toHaveCount(2);
    await expect(transmission.locator('.grade-preview-correction').filter({ hasText: '2 → 3' })).toBeVisible();
    expect(await transmission.locator('.grade-preview-pill').evaluateAll((nodes) => new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top))).size)).toBe(1);
    await transmission.getByRole('button', { name: /Transmisja danych/ }).click();
    await expect(transmission.locator('.grade-row')).toHaveCount(2);
    expect(await transmission.locator('.grade-row').first().evaluate((node) => !node.closest('.grade-group'))).toBe(true);
    await page.screenshot({ animations: 'disabled', path: `test-results/parity-${viewport.name}-grades.png` });

    await page.locator('.primary-navigation').getByRole('button', { name: 'Studia', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Ładowanie informacji o studiach' })).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: `test-results/parity-${viewport.name}-info-loading.png` });
    gates.get('info')!.release();
    await expect(page.getByText('ELS123', { exact: true })).toBeVisible();
    await expect(page.locator('.info-screen').getByRole('button', { name: 'Odśwież', exact: true })).toHaveCount(1);
    await expect(page.locator('.info-card-head')).toHaveText(['Postęp ECTS', 'Legitymacja ELS', 'Aktualne studia', 'Przebieg studiów']);
    await page.screenshot({ animations: 'disabled', path: `test-results/parity-${viewport.name}-info.png` });

    await openMore(page, 'Finanse');
    await expect(page.getByRole('status', { name: 'Ładowanie finansów' })).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: `test-results/parity-${viewport.name}-finance-loading.png` });
    gates.get('finance')!.release();
    await expect(page.locator('.finance-status-chip.due')).toBeVisible();
    await expect(page.locator('.finance-summary-grid .metric-card')).toHaveCount(4);
    await page.getByRole('tab', { name: 'Należności', exact: true }).click();
    await expect(page.locator('.finance-record-title')).toHaveText('Opłata za legitymację');
    await page.screenshot({ animations: 'disabled', path: `test-results/parity-${viewport.name}-finance.png` });

    await openMore(page, 'Przydatne strony');
    await expect(page.locator('a[href="https://quiz.endozero.pl"]')).toBeVisible();
    await expect(page.locator('.link-thumb')).toHaveCount(await page.locator('.link-card').count());
    await page.screenshot({ animations: 'disabled', path: `test-results/parity-${viewport.name}-links.png` });
    await openMore(page, 'Ustawienia');
    await expect(page.getByLabel('Motyw')).toBeVisible();
    await page.getByLabel('Motyw').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByLabel('Motyw').selectOption('dark');
    await page.screenshot({ animations: 'disabled', path: `test-results/parity-${viewport.name}-settings.png` });
    await openMore(page, 'O aplikacji');
    await expect(page.locator('.about-logo-img')).toBeVisible();
    await expect(page.locator('.about-logo-img')).toHaveCSS('width', '96px');
    await expect(page.getByRole('button', { name: 'Udostępnij', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Kod źródłowy' })).toHaveAttribute('href', 'https://github.com/Kejlo523/ZUTnik');
    await expect(page.getByRole('link', { name: 'Polityka prywatności' })).toHaveAttribute('href', 'https://zutnik.endozero.pl/privacy_policy.html');
    await page.screenshot({ animations: 'disabled', path: `test-results/parity-${viewport.name}-about.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    expect(requests.filter((path) => path.endsWith('/usos/finance'))).toHaveLength(1);
  });
}

test('finance upstream failure preserves saved data, repeated refresh is rate limited, offline makes no requests', async ({ page, context }) => {
  const requests = await fixture(page);
  await page.goto(''); await openMore(page, 'Finanse');
  await expect(page.locator('.finance-record-title')).toHaveText('Opłata za legitymację');
  let attempts = 0;
  await page.route('**/api/usos/finance', async (route) => { attempts++; await route.fulfill({ status: 503, json: { error: 'test_upstream_unavailable' } }); });
  await page.getByRole('button', { name: 'Odśwież finanse', exact: true }).click();
  await expect.poll(() => attempts).toBe(1);
  await expect(page.locator('.finance-screen')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.finance-record-title')).toHaveText('Opłata za legitymację');
  await expect(page.locator('.banner.error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Odśwież finanse', exact: true }).click();
  await expect(page.locator('.toast')).toBeVisible();
  expect(attempts).toBe(1);
  await page.reload();
  await page.getByRole('heading', { name: 'Finanse', exact: true }).waitFor();
  await page.locator('.primary-navigation').getByRole('button', { name: 'Start', exact: true }).click();
  await context.setOffline(true);
  await openMore(page, 'Finanse');
  await expect(page.locator('.finance-record-title')).toHaveText('Opłata za legitymację');
  await page.getByRole('button', { name: 'Odśwież finanse', exact: true }).click();
  expect(attempts).toBe(1);
  expect(requests.filter((path) => path.endsWith('/usos/finance'))).toHaveLength(1);
});

test('loading bars and skeletons respect reduced motion', async ({ page }) => {
  await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/usos/grades', async (route) => { await gate; await route.fallback(); });
  await page.goto('');
  await page.locator('.primary-navigation').getByRole('button', { name: 'Oceny', exact: true }).click();
  await expect(page.locator('.grade-group-skeleton').first()).toBeVisible();
  await expect(page.locator('.loading-indicator i')).toHaveCount(3);
  expect(await page.locator('.loading-indicator i').first().evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  expect(await page.locator('.skeleton-block').first().evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  release();
  await expect(page.locator('.grade-group-skeleton')).toHaveCount(0);
});
