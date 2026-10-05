import { expect, it } from 'vitest';
import { buildPlanResultFromWindow, type PlanWindowData } from '../../src/services/api';
import { filterTimetable, timetablePages } from '../../src/services/timetablePages';

const window: PlanWindowData = {
  rangeStart: '2026-10-05', rangeEnd: '2026-10-18', album: 'test', sessionPeriods: [], entriesTotal: 2,
  daysWithData: ['2026-10-05', '2026-10-12'], verifiedWeeks: ['2026-10-05', '2026-10-12'],
  events: ['2026-10-05', '2026-10-12'].map((date) => ({ start: `${date}T10:00:00`, end: `${date}T11:30:00`, title: 'Statystyka', subject: 'Statystyka', lessonForm: 'Wykład', lessonFormShort: 'W', lessonStatus: '', lessonStatusShort: '', room: '', worker: '', groupName: '', tokName: '' })),
};

it('projects three adjacent ranges exclusively from the saved window', () => {
  const current = buildPlanResultFromWindow(window, { viewMode: 'week', currentDate: '2026-10-05' });
  const pages = timetablePages('week', '2026-10-05', current, window, []);
  expect(pages.map((page) => page.key)).toEqual(['week:2026-09-28', 'week:2026-10-05', 'week:2026-10-12']);
  expect(pages.map((page) => page.cached)).toEqual([false, true, true]);
  expect(pages[1].result).toBe(current);
  expect(pages[2].result.dayColumns[0].events[0].title).toBe('Statystyka');
});
it('does not display the previous range as the current range while loading', () => {
  const stale = buildPlanResultFromWindow(window, { viewMode: 'week', currentDate: '2026-10-05' });
  const pages = timetablePages('week', '2026-10-19', stale, window, []);
  expect(pages[1].cached).toBe(false);
  expect(pages[1].result.rangeStart).toBe('2026-10-19');
  expect(pages[1].result.hasAnyEventsInRange).toBe(false);
});
it('keeps the incoming page key when recycling it into the center', () => {
  const before = timetablePages('week', '2026-10-05', null, window, []);
  const after = timetablePages('week', '2026-10-12', null, window, []);
  expect(before[2].key).toBe(after[1].key);
  expect(before[2].result.dayColumns).toEqual(after[1].result.dayColumns);
});
it('does not mistake an unverified empty projection for a saved empty week', () => {
  const result = buildPlanResultFromWindow(window, { viewMode: 'week', currentDate: '2026-10-19' });
  expect(timetablePages('week', '2026-10-19', result, window, [])[1].cached).toBe(false);
});
it('applies subject filters to adjacent pages and month dots without mutating the snapshot', () => {
  const result = buildPlanResultFromWindow(window, { viewMode: 'week', currentDate: '2026-10-05' });
  const hidden = [result.subjectFilters[0].key];
  const pages = timetablePages('week', '2026-10-05', filterTimetable(result, hidden), window, hidden);
  expect(pages[1].result.hasAnyEventsInRange).toBe(false);
  expect(pages[2].result.hasAnyEventsInRange).toBe(false);
  expect(timetablePages('month', '2026-10-05', null, window, hidden)[1].result.monthGrid.flat().some((cell) => cell.hasPlan)).toBe(false);
  expect(window.events).toHaveLength(2);
});
it('handles month/year boundaries and a missing offline snapshot', () => {
  const pages = timetablePages('month', '2027-01-31', null, null, []);
  expect(pages.map((page) => page.key)).toEqual(['month:2026-12-01', 'month:2027-01-01', 'month:2027-02-01']);
  expect(pages.every((page) => !page.cached)).toBe(true);
  expect(timetablePages('day', '2027-01-01', null, null, []).map((page) => page.result.currentDate)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
});
