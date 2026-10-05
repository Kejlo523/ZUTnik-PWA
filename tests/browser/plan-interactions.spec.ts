import { expect, test } from '@playwright/test';
import { activePlan, fixture } from './fixtures';

for (const viewport of [{ width: 320, height: 640 }, { width: 393, height: 852 }, { width: 844, height: 390 }, { width: 1366, height: 768 }]) {
  test(`More uses Android rows and remains usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await fixture(page); await page.setViewportSize(viewport); await page.goto('');
    await page.getByRole('button', { name: 'Więcej', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Więcej' });
    await expect(sheet).toBeVisible();
    await sheet.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
    await expect(sheet.locator('.drawer-list')).toHaveCSS('flex-direction', 'column');
    const rows = await sheet.locator('.drawer-item').evaluateAll((items) => items.map((node) => node.getBoundingClientRect().toJSON()));
    expect(rows.every((row, i) => i === 0 || row.top >= rows[i - 1].bottom)).toBe(true);
    expect(rows.every((row) => row.height >= 54 && row.width > 250)).toBe(true);
    const rect = (await sheet.boundingBox())!;
    expect(Math.round(rect.y + rect.height)).toBe(viewport.height);
    expect(rect.width).toBeLessThanOrEqual(480);
    await sheet.getByRole('button', { name: 'Wyloguj', exact: true }).scrollIntoViewIfNeeded();
    await expect(sheet.getByRole('button', { name: 'Wyloguj', exact: true })).toBeInViewport();
    await sheet.evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ animations: 'disabled', path: `test-results/more-${viewport.width}x${viewport.height}.png` });
    await sheet.getByRole('button', { name: 'Zamknij', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: 'Więcej', exact: true }).click();
    await sheet.getByRole('button', { name: 'Ustawienia', exact: true }).click();
    await expect(page.getByLabel('Motyw')).toBeVisible();
  });
}

test('More supports dragging back and dismissing without closing on a cancelled gesture', async ({ page }) => {
  await fixture(page); await page.setViewportSize({ width: 393, height: 852 }); await page.goto('');
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Więcej' });
  await sheet.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
  const grip = (await sheet.locator('.sheet-grip').boundingBox())!;
  const x = grip.x + grip.width / 2; const y = grip.y + 18;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 20, { steps: 5 });
  await page.mouse.up();
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate((node) => Math.round(node.getBoundingClientRect().bottom))).toBe(852);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 110, { steps: 8 }); await page.mouse.up();
  await expect(sheet).toHaveCount(0);
});

for (const width of [320, 393, 1366]) {
  test(`period markers are translated, centered and separated from classes at ${width}px`, async ({ page, context }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
    await fixture(page); await page.setViewportSize({ width, height: 852 });
    await context.route('**/proxy/calendar', (route) => route.fulfill({ json: { periods: [{ key: 'wakacje_zimowe', start: '2026-10-06', end: '2026-10-08' }] } }));
    await page.goto(''); await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
    if (width < 700) expect((await page.locator('.timetable-surface').boundingBox())!.width).toBe(width);
    const labels = activePlan(page).locator('.timetable-boundary-label');
    await expect(labels).toHaveText(['Początek wakacji zimowych', 'Koniec wakacji zimowych']);
    const geometry = await labels.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const col = node.closest('.timetable-day')!;
      const column = col.getBoundingClientRect();
      const event = col.querySelector('.timetable-event')!.getBoundingClientRect();
      const previous = col.previousElementSibling!.querySelector('.timetable-event')!.getBoundingClientRect();
      return { centered: Math.abs(rect.y + rect.height / 2 - (column.y + column.height / 2)) < 1, gapLeft: rect.x - previous.right, gapRight: event.x - rect.right };
    }));
    expect(geometry.every((rect) => rect.centered && rect.gapLeft >= 1 && rect.gapRight >= 1)).toBe(true);
    await activePlan(page).locator('.timetable-scroll').evaluate((el) => { el.scrollTop = 190; });
    await page.screenshot({ animations: 'disabled', path: `test-results/period-markers-${width}.png` });
  });
}

test('vertical touch scrolling starts immediately after swiping in either direction', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch injection uses Chromium protocol.');
  await fixture(page); await page.setViewportSize({ width: 393, height: 852 }); await page.goto('');
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(activePlan(page).locator('.timetable-event').first()).toBeVisible();
  await expect(page.locator('.sync-indicator')).toHaveCount(0);
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const swipe = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 6; i++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6 }] });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const first = await activePlan(page).getAttribute('data-page-key');
  const range = await page.locator('.plan-appbar-range').textContent();
  await swipe({ x: 320, y: 400 }, { x: 60, y: 400 });
  await swipe({ x: 200, y: 610 }, { x: 200, y: 380 });
  await expect(activePlan(page)).not.toHaveAttribute('data-page-key', first!, { timeout: 300 });
  await expect.poll(() => activePlan(page).locator('.timetable-scroll').evaluate((el) => el.scrollTop), { timeout: 400 }).toBeGreaterThan(100);
  await expect(page.locator('.plan-appbar-range')).not.toHaveText(range!);
  await activePlan(page).locator('.timetable-scroll').evaluate((element) => new Promise<void>((resolve) => {
    let previous = element.scrollTop; let stable = 0;
    const frame = () => { stable = Math.abs(element.scrollTop - previous) < .5 ? stable + 1 : 0; previous = element.scrollTop; if (stable >= 8) resolve(); else requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }));
  await swipe({ x: 60, y: 400 }, { x: 320, y: 400 });
  const top = await activePlan(page).locator('.timetable-scroll').evaluate((el) => el.scrollTop);
  await swipe({ x: 200, y: 380 }, { x: 200, y: 610 });
  await expect(activePlan(page)).toHaveAttribute('data-page-key', first!, { timeout: 300 });
  await expect.poll(() => activePlan(page).locator('.timetable-scroll').evaluate((el) => el.scrollTop), { timeout: 400 }).toBeLessThan(top - 50);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
