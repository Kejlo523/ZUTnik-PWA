import { expect, it } from 'vitest';
import { periodBoundaries, periodMarkerLabel } from '../../src/app/calendarPeriods';
import { createT } from '../../src/i18n';

it('marks the first day and the day after the inclusive end of a period', () => {
  const periods = [{ key: 'wakacje_zimowe', start: '2026-10-06', end: '2026-10-08' }];
  const start = periodBoundaries(periods, '2026-10-05', '2026-10-06');
  const end = periodBoundaries(periods, '2026-10-08', '2026-10-09');
  expect(start.map((m) => m.edge)).toEqual(['start']);
  expect(end.map((m) => m.edge)).toEqual(['end']);
  expect(periodBoundaries(periods, '2026-10-07', '2026-10-08')).toEqual([]);
  expect(periodMarkerLabel(start[0], createT('pl'))).toBe('Początek wakacji zimowych');
  expect(periodMarkerLabel(end[0], createT('en'))).toBe('End of winter holidays');
});

it('preserves overlapping boundaries and short periods between visible days', () => {
  const periods = [
    { key: 'sesja_zimowa', start: '2026-10-06', end: '2026-10-08' },
    { key: 'przerwa_dydaktyczna', start: '2026-10-06', end: '2026-10-06' },
  ];
  expect(periodBoundaries(periods, '2026-10-05', '2026-10-07').map((m) => [m.period.key, m.edge])).toEqual([
    ['sesja_zimowa', 'start'], ['przerwa_dydaktyczna', 'start'], ['przerwa_dydaktyczna', 'end'],
  ]);
});

it('translates every calendar key without leaking an internal translation key', () => {
  const keys = ['sesja_zimowa', 'sesja_letnia', 'sesja_poprawkowa', 'przerwa_dydaktyczna_zimowa', 'przerwa_dydaktyczna_letnia', 'przerwa_dydaktyczna', 'wakacje_zimowe', 'wakacje_letnie'];
  for (const language of ['pl', 'en'] as const) {
    for (const key of keys) expect(periodMarkerLabel({ period: { key, start: '', end: '' }, edge: 'start', kind: 'holiday' }, createT(language))).not.toMatch(/periodName\.|_/);
    expect(periodMarkerLabel({ period: { key: 'nowy_okres', start: '', end: '' }, edge: 'end', kind: 'holiday' }, createT(language))).not.toMatch(/periodName\.|_/);
  }
});
