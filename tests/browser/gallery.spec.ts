import { test, expect } from '@playwright/test';
import { fixture } from './fixtures';

test('gallery displays images and is keyboard accessible without leaving the article', async ({ page, context }) => {
  await fixture(page); await page.setViewportSize({ width: 393, height: 852 });
  const base = String(test.info().project.use.baseURL);
  const first = new URL('icons/icon-192.png', base).href;
  const second = new URL('icons/icon-512.png', base).href;
  await context.route('**/proxy/rss', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ xml: `<rss version="2.0"><channel><item><title>Aktualność ze zdjęciami</title><link>https://example.edu/news</link><description><![CDATA[<p>Komunikat.</p><img src="${first}" alt="Pierwsze zdjęcie"><img src="${second}" alt="Drugie zdjęcie">]]></description></item></channel></rss>` }) }));
  await page.goto(''); await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aktualności', exact: true }).click();
  await page.locator('.news-card').first().click();
  await page.getByRole('button', { name: 'Otwórz zdjęcie 1 z 2' }).click();
  await expect(page.getByRole('dialog', { name: 'Galeria zdjęć' })).toBeVisible();
  await expect.poll(() => page.locator('.news-gallery-slide.is-active img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.news-gallery-counter')).toHaveText('2 / 2');
  await page.getByRole('button', { name: 'Przybliż zdjęcie' }).click();
  await expect(page.locator('.news-gallery-viewport')).toHaveClass(/is-zoomed/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.news-detail-title')).toBeVisible();
});
