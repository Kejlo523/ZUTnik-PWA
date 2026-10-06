import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginRefresh, decideRefresh, finishRefresh, MANUAL_COOLDOWN } from '../../src/services/refreshPolicy';
import { cache, loadSession, saveSession, saveSettings, setCacheAccount } from '../../src/services/storage';
import { collapseCorrectedGrades } from '../../src/app/helpers';
import { parseSettingsBackup } from '../../src/services/settingsBackup';

beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });
const ledger = { lastAttempt: 0, lastManual: 0, retryAt: 0, failures: 0 };
const options = { now: 1_000_000, manual: false, online: true, fresh: false, hasCache: false };
describe('network policy', () => {
  it('never requests offline, including manual refresh', () => {
    expect(decideRefresh(ledger, { ...options, online: false, manual: true }).reason).toBe('offline');
  });
  it('keeps a five minute cooldown without renewing it on blocked clicks', () => {
    expect(decideRefresh({ ...ledger, lastManual: options.now - 120_000 }, { ...options, manual: true }).allow).toBe(false);
    expect(decideRefresh({ ...ledger, lastManual: options.now - MANUAL_COOLDOWN }, { ...options, manual: true }).allow).toBe(true);
  });
  it('uses fresh cache and backs off failures', () => {
    expect(decideRefresh(ledger, { ...options, fresh: true }).reason).toBe('fresh');
    expect(decideRefresh({ ...ledger, retryAt: options.now + 1 }, options).reason).toBe('backoff');
  });
  it('prevents simultaneous module refreshes, retries after backoff', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    expect(beginRefresh('test', 'grades', false, false, false).allow).toBe(true);
    expect(beginRefresh('test', 'grades', false, false, false).reason).toBe('inflight');
    finishRefresh('test', 'grades', false);
    expect(beginRefresh('test', 'grades', false, false, false).reason).toBe('backoff');
    vi.advanceTimersByTime(MANUAL_COOLDOWN);
    expect(beginRefresh('test', 'grades', false, false, false).allow).toBe(true);
    finishRefresh('test', 'grades', true);
  });
  it('retains the stats cooldown in memory when local storage is blocked', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const blockedRead = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    const blockedWrite = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    try {
      expect(beginRefresh('private-stats', 'stats', true, false, false).allow).toBe(true);
      expect(beginRefresh('private-stats', 'stats', true, false, false).reason).toBe('inflight');
      finishRefresh('private-stats', 'stats', true);
      vi.advanceTimersByTime(120_000);
      expect(beginRefresh('private-stats', 'stats', true, false, false).reason).toBe('cooldown');
      vi.advanceTimersByTime(180_000);
      expect(beginRefresh('private-stats', 'stats', true, false, false).allow).toBe(true);
      finishRefresh('private-stats', 'stats', true);
    } finally { blockedRead.mockRestore(); blockedWrite.mockRestore(); }
  });
  it('prefers a newer memory ledger when writes fail but an old stored ledger is readable', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    localStorage.setItem('zutnik_refresh:full-storage:stats', JSON.stringify({ ...ledger, lastAttempt: 900_000 }));
    const blocked = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    try {
      expect(beginRefresh('full-storage', 'stats', true, false, false).allow).toBe(true);
      finishRefresh('full-storage', 'stats', true);
      vi.advanceTimersByTime(120_000);
      expect(beginRefresh('full-storage', 'stats', true, false, false).reason).toBe('cooldown');
    } finally { blocked.mockRestore(); }
  });
  it('does not repeat automatic grade reads if a successful response could not be cached', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    expect(beginRefresh('uncached-success', 'grades', false, false, false).allow).toBe(true);
    finishRefresh('uncached-success', 'grades', true);
    vi.advanceTimersByTime(60_000);
    expect(beginRefresh('uncached-success', 'grades', false, false, false).reason).toBe('recent');
    expect(beginRefresh('new-range', 'plan', false, false, false).allow).toBe(true);
    finishRefresh('new-range', 'plan', true);
    expect(beginRefresh('new-range', 'plan', false, false, false).allow).toBe(true);
    finishRefresh('new-range', 'plan', true);
  });
});
describe('cache and sessions', () => {
  it('separates accounts and does not extend freshness when read', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000); setCacheAccount('one');
    cache.saveGrades('term', []); const ts = cache.loadGradesTimestamp('term');
    vi.advanceTimersByTime(60_000); expect(cache.loadGrades('term')).toEqual([]);
    expect(cache.loadGradesTimestamp('term')).toBe(ts);
    setCacheAccount('two'); expect(cache.loadGradesForce('term')).toBeNull();
  });
  it('preserves long-lived OAuth session and timestamps across reads', () => {
    saveSession({ userId: 'test', username: '', authKey: '', imageUrl: '', activeStudyId: null, persistedAt: 123, usos: { accessToken: 'fixture', accessTokenSecret: 'fixture', scopes: ['offline_access'] } });
    expect(loadSession()?.persistedAt).toBe(123); expect(loadSession()?.usos?.accessToken).toBe('fixture');
    saveSession(null); expect(loadSession()).toBeNull();
  });
  it('keeps the active session in memory when storage is full, without crashing', () => {
    const blocked = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    const session = { userId: 'quota-test', username: '', authKey: '', imageUrl: '', activeStudyId: null, usos: { accessToken: 'fixture', accessTokenSecret: 'fixture' } };
    try {
      expect(saveSession(session)).toBe(false); expect(loadSession()?.userId).toBe('quota-test');
      expect(saveSettings({ theme: 'dark', language: 'pl', compactPlan: false, gradesGrouping: true, notificationsEnabled: false, refreshMinutes: 30 })).toBe(false);
    } finally { blocked.mockRestore(); saveSession(null); }
  });
});
it('replaces a corrected grade without merging lab and lecture', () => {
  const base = { subjectName: 'Transmisja danych', courseId: 'TD', weight: 3, teacher: '' };
  const result = collapseCorrectedGrades([
    { ...base, type: 'Wykład', grade: '2', date: '2026-06-26' },
    { ...base, type: 'Wykład', grade: '3', date: '2026-07-07' },
    { ...base, type: 'Laboratorium', grade: '4', date: '2026-06-26' },
  ]);
  expect(result).toHaveLength(2); expect(result.find((grade) => grade.type === 'Wykład')?.grade).toBe('3');
  expect(result.find((grade) => grade.type === 'Wykład')?.gradeHistory).toContain('2');
});
it('imports only validated settings, not OAuth credentials', () => {
  const value = { version: 1, settings: { theme: 'dark', language: 'pl', compactPlan: false, gradesGrouping: true }, usos: { accessToken: 'no' } };
  expect(parseSettingsBackup(JSON.stringify(value))).not.toHaveProperty('usos');
  expect(() => parseSettingsBackup(JSON.stringify({ ...value, tiles: [{ action: 'javascript' }] }))).toThrow();
  const tile = { id: 'one', title: 'Plan', description: '', icon: 'calendar', action: 'plan' };
  expect(() => parseSettingsBackup(JSON.stringify({ ...value, tiles: [tile, tile] }))).toThrow();
  expect(() => parseSettingsBackup(JSON.stringify({ ...value, tiles: [{ ...tile, action: 'url', value: 'javascript:alert(1)' }] }))).toThrow();
});
