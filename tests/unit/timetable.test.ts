import { expect, it } from 'vitest';
import { cachedTimetableWindow, clearTimetableAccount, syncTimetableWindow } from '../../src/services/timetable';
import { coversRange } from '../../src/services/timetable';
import type { SessionData } from '../../src/types';

const row = (start: string, worker = '') => ({ sourceId: `class:1:1:${start}T10:00:00:${start}T12:00:00`, start: `${start}T10:00:00`, end: `${start}T12:00:00`, subject: 'Statystyka', title: 'Statystyka', worker, lessonForm: 'Wykład', lessonFormShort: 'W' });
const session = (userId: string): SessionData => ({ userId, username: '', authKey: '', imageUrl: '', activeStudyId: 'study', usos: { accessToken: 'fixture', accessTokenSecret: 'fixture' } });
const search = { category: 'album', query: '' };
it('fetches visible weeks before catalog and bulk groups, then reuses the stored window', async () => {
  const calls: string[] = [];
  const account = session('bulk-test');
  const transport = async <T>(path: string, body?: Record<string, unknown>): Promise<T> => {
    calls.push(path);
    const data = path.endsWith('/week') ? [row(String(body?.start))]
      : path.endsWith('/catalog') ? [{ id: 'Z', start: '2026-10-01', end: '2027-02-28', groups: [{ course_unit_id: '1', group_number: '1', term_id: 'Z' }] }]
        : [row('2026-10-05', 'Jan Nowak'), row('2026-10-19', 'Jan Nowak')];
    return { data } as T;
  };
  const first = await syncTimetableWindow(account, search, '2026-10-05', '2026-10-18', transport, { bulk: true });
  expect(calls.map((path) => path.split('/').at(-1))).toEqual(['week', 'week', 'catalog', 'group']);
  expect(first.completeRanges).toEqual([{ start: '2026-10-01', end: '2027-02-28' }]);
  expect(first.events.find((event) => event.start.startsWith('2026-10-05'))?.worker).toBe('Jan Nowak');
  expect(coversRange(first, 'week', '2026-10-05', true)).toBe(true);
  const count = calls.length;
  await syncTimetableWindow(account, search, '2026-10-05', '2026-10-18', transport, { bulk: true });
  expect(calls.length).toBe(count);
  const saved = await cachedTimetableWindow(account, search); expect(saved?.events).toEqual(first.events);
});
it('a verified empty student week removes stale bulk classes for that week', async () => {
  const account = session('cancelled-test');
  const transport = async <T>(path: string): Promise<T> => ({ data: path.endsWith('/week') ? [] : path.endsWith('/catalog') ? [{ id: 'Z', start: '2026-10-01', end: '2027-02-28', groups: [{ course_unit_id: '1', group_number: '1', term_id: 'Z' }] }] : [row('2026-10-05'), row('2026-10-19')] }) as T;
  const result = await syncTimetableWindow(account, search, '2026-10-05', '2026-10-11', transport, { bulk: true });
  expect(result.events.some((event) => event.start.startsWith('2026-10-05'))).toBe(false);
  expect(result.events.some((event) => event.start.startsWith('2026-10-19'))).toBe(true);
});
it('does not infer freshness from a range containing missing weeks', () => {
  expect(coversRange({ rangeStart: '2026-10-01', rangeEnd: '2027-02-28', events: [], album: '', sessionPeriods: [], entriesTotal: 0, daysWithData: [], verifiedWeeks: ['2026-10-05'] }, 'week', '2026-10-19')).toBe(false);
});
it('removes persisted and in-memory timetable data on explicit logout', async () => {
  const account = session('logout-test');
  await syncTimetableWindow(account, search, '2026-10-05', '2026-10-11', async <T>() => ({ data: [row('2026-10-05')] }) as T);
  await clearTimetableAccount(account.userId);
  expect(await cachedTimetableWindow(account, search)).toBeNull();
});
it('does not write a response which finishes after logout', async () => {
  const account = session('logout-race-test');
  let finish: ((data: unknown) => void) | undefined;
  let started: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const operation = syncTimetableWindow(account, search, '2026-10-05', '2026-10-11', <T>() => new Promise<T>((resolve) => { finish = resolve as (data: unknown) => void; started?.(); }));
  const rejected = expect(operation).rejects.toThrow('Synchronizacja anulowana');
  await ready; await clearTimetableAccount(account.userId); finish?.({ data: [row('2026-10-05')] });
  await rejected; expect(await cachedTimetableWindow(account, search)).toBeNull();
});
