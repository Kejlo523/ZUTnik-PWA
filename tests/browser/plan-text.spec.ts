import { expect, test } from '@playwright/test';
import { activePlan, fixture, rows } from './fixtures';

const subjects = ['Sztuczna inteligencja', 'Zarządzanie', 'Język angielski', 'Rachunkowość', 'Podstawy ochrony informacji', 'Ekonomika gospodarki żywnościowej', 'Inżynierski projekt zespołowy', 'Programowanie aplikacji webowych 1'];

for (const viewport of [{ width: 320, height: 640 }, { width: 393, height: 740 }, { width: 412, height: 915 }, { width: 844, height: 390 }, { width: 1366, height: 768 }]) {
  test(`dense timetable has complete text lines at ${viewport.width}x${viewport.height}`, async ({ page, context }) => {
    await fixture(page); await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/timetable/week', (route) => {
      const start = route.request().postDataJSON().start;
      const events = rows(start).flatMap((row, day) => [0, 1, 2, 3].map((index) => {
        const date = row.start.slice(0, 10);
        const hour = index < 2 ? 8 : 10;
        const minute = index % 2 ? '30' : '15';
        const subject = subjects[(day * 2 + index) % subjects.length];
        return { ...row, sourceId: `${row.sourceId}-${index}`, title: subject, subject, start: `${date}T${String(hour).padStart(2, '0')}:${minute}:00`, end: `${date}T${String(hour + (index % 2 ? 2 : 1)).padStart(2, '0')}:${index % 2 ? '00' : '45'}:00` };
      }));
      return route.fulfill({ json: { data: events } });
    });
    await page.goto(''); await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await expect(activePlan(page).locator('button.timetable-event')).toHaveCount(20);
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => activePlan(page).locator('.timetable-event-title-space').first().evaluate((node) => node.style.getPropertyValue('--title-lines'))).not.toBe('');
    if (viewport.width < 700) expect((await page.locator('.timetable-surface').boundingBox())!.y).toBeLessThan(160);
    const geometry = await activePlan(page).locator('button.timetable-event').evaluateAll((events) => events.map((event) => {
      const box = event.getBoundingClientRect();
      const space = event.querySelector<HTMLElement>('.timetable-event-title-space')!;
      const title = space.querySelector<HTMLElement>('.timetable-event-title')!;
      const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
      const lines = Number(space.style.getPropertyValue('--title-lines'));
      const type = event.querySelector('.timetable-event-type')!.getBoundingClientRect();
      const clocks = [...event.querySelectorAll('.timetable-event-time > span')].filter((node) => getComputedStyle(node).display !== 'none').map((node) => node.getBoundingClientRect());
      return {
        regular: getComputedStyle(title).fontWeight === '400',
        titleFits: getComputedStyle(space).visibility === 'hidden' || lines * lineHeight <= space.getBoundingClientRect().height + .02,
        typeFits: type.bottom <= box.bottom && type.top >= space.getBoundingClientRect().bottom,
        timeFits: clocks.every((clock) => clock.x >= box.x && clock.right <= box.right && clock.bottom <= space.getBoundingClientRect().top),
      };
    }));
    expect(geometry.every((item) => item.regular && item.titleFits && item.typeFits && item.timeFits)).toBe(true);
    await activePlan(page).locator('.timetable-scroll').evaluate((node) => { node.scrollTop = 95; });
    await page.screenshot({ path: `test-results/dense-plan-${viewport.width}x${viewport.height}.png` });
    await activePlan(page).locator('button.timetable-event').filter({ has: page.locator('.timetable-event-title', { hasText: 'Sztuczna inteligencja' }) }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Sztuczna inteligencja');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(activePlan(page).locator('button.timetable-event')).toHaveCount(20);
    expect(errors).toEqual([]);
  });
}
