import type { SessionData, SessionPeriod, ViewMode } from '../types';
import type { PlanWindowData } from './api';
import { readResource, removeResources, saveResource, type SavedResource } from './offlineStore';

export interface TimetableGroup { course_unit_id: string; group_number: string; course_name?: { pl?: string }; term_id: string; }
interface Term { id: string; start: string; end: string; groups: TimetableGroup[]; }
type Row = Record<string, string>;
type Transport = <T>(path: string, payload?: Record<string, unknown>) => Promise<T>;
interface Snapshot { weeks: Record<string, SavedResource<Row[]>>; groups: Record<string, SavedResource<Row[]>>; catalog?: SavedResource<Term[]>; completeTerms: string[]; }
const snapshots = new Map<string, Promise<Snapshot>>();
const inflight = new Map<string, Promise<unknown>>();
const generations = new Map<string, number>();
const SIX_HOURS = 6 * 3_600_000;
const SEVEN_DAYS = 7 * 86_400_000;
export function shiftDay(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10);
}
export function monday(day: string) { const date = new Date(`${day}T12:00:00Z`); return shiftDay(day, -((date.getUTCDay() + 6) % 7)); }
export function coversRange(window: PlanWindowData, mode: ViewMode, day: string, fresh = false) {
  const date = new Date(`${day}T12:00:00Z`);
  const start = mode === 'week' ? monday(day) : mode === 'month' ? `${day.slice(0, 7)}-01` : day;
  const end = mode === 'week' ? shiftDay(start, 6) : mode === 'month'
    ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10) : day;
  if (!fresh && window.completeRanges?.some((item) => item.start <= start && item.end >= end)) return true;
  for (let week = monday(start); week <= end; week = shiftDay(week, 7)) {
    if (!window.verifiedWeeks?.includes(week)) return false;
    if (fresh && Date.now() - (window.verifiedWeekTimes?.[week] ?? 0) >= SIX_HOURS) return false;
  }
  return true;
}
export function timetableScope(session: SessionData, search: { category: string; query: string }) { return `${session.userId}:${session.activeStudyId || ''}:${search.query ? `${search.category}:${search.query}` : 'personal'}`; }
export async function clearTimetableAccount(account: string) {
  generations.set(account, (generations.get(account) ?? 0) + 1);
  for (const key of snapshots.keys()) if (key.startsWith(`${account}:`)) snapshots.delete(key);
  await removeResources(`timetable:${account}:`);
}
async function snapshot(scope: string): Promise<Snapshot> {
  if (!snapshots.has(scope)) snapshots.set(scope, readResource<Snapshot>(`timetable:${scope}`).then((entry) => entry?.data ?? { weeks: {}, groups: {}, completeTerms: [] }));
  while (snapshots.size > 32) snapshots.delete(snapshots.keys().next().value!);
  return snapshots.get(scope)!;
}

function windowFrom(state: Snapshot, session: SessionData, periods: SessionPeriod[]): PlanWindowData | null {
  const weeks = Object.keys(state.weeks).sort();
  if (!weeks.length && !Object.keys(state.groups).length) return null;
  const merged = new Map<string, Row>();
  const metadata = new Map<string, Row>();
  for (const entry of Object.values(state.groups)) for (const row of entry.data) {
    if (row.sourceId) metadata.set(row.sourceId, row);
    const week = monday(row.start.slice(0, 10));
    if (!state.weeks[week]) merged.set(row.sourceId || JSON.stringify(row), row);
  }
  for (const entry of Object.values(state.weeks)) for (const row of entry.data) {
    const group = metadata.get(row.sourceId);
    const enriched = group ? { ...row, worker: row.worker || group.worker, lessonForm: row.lessonForm || group.lessonForm, lessonFormShort: row.lessonFormShort || group.lessonFormShort } : row;
    merged.set(row.sourceId || JSON.stringify(row), enriched);
  }
  const completed = state.catalog?.data.filter((term) => state.completeTerms.includes(term.id)) ?? [];
  const starts = [...weeks, ...completed.map((term) => term.start)];
  const ends = [...weeks.map((week) => shiftDay(week, 6)), ...completed.map((term) => term.end)];
  const events = [...merged.values()];
  return { rangeStart: starts.sort()[0] || '', rangeEnd: ends.sort().at(-1) || '', album: session.userId, events, sessionPeriods: periods, entriesTotal: events.length, daysWithData: [...new Set(events.map((row) => row.start.slice(0, 10)))].sort(), verifiedWeeks: weeks,
    completeRanges: completed.map((term) => ({ start: term.start, end: term.end })),
    verifiedWeekTimes: Object.fromEntries(Object.entries(state.weeks).map(([week, entry]) => [week, entry.ts])),
    fetchedAt: Math.max(0, ...Object.values(state.weeks).map((entry) => entry.ts), ...Object.values(state.groups).map((entry) => entry.ts)) };
}

export async function cachedTimetableWindow(session: SessionData, search: { category: string; query: string }, periods: SessionPeriod[] = []) {
  if (!periods.length) periods = (await readResource<SessionPeriod[]>('academic-calendar'))?.data ?? [];
  return windowFrom(await snapshot(timetableScope(session, search)), session, periods);
}

export async function syncTimetableWindow(session: SessionData, search: { category: string; query: string }, start: string, end: string, transport: Transport, options: {
  force?: boolean; periods?: SessionPeriod[]; onUpdate?: (window: PlanWindowData) => void; bulk?: boolean;
} = {}): Promise<PlanWindowData> {
  const scope = timetableScope(session, search);
  const generation = generations.get(session.userId) ?? 0;
  const assertCurrent = () => {
    if (generation !== (generations.get(session.userId) ?? 0)) throw new Error('Synchronizacja anulowana po wylogowaniu.');
  };
  const state = await snapshot(scope);
  const periods = options.periods ?? [];
  const publish = async () => {
    assertCurrent();
    const sorted = Object.keys(state.weeks).sort((a, b) => state.weeks[a].ts - state.weeks[b].ts);
    if (sorted.length > 32) for (const day of sorted.slice(0, sorted.length - 32)) delete state.weeks[day];
    const groups = Object.keys(state.groups).sort((a, b) => state.groups[a].ts - state.groups[b].ts);
    if (groups.length > 96) for (const key of groups.slice(0, groups.length - 96)) delete state.groups[key];
    state.completeTerms = state.completeTerms.filter((id) => state.catalog?.data.find((term) => term.id === id)?.groups.every((group) => !!state.groups[`${group.course_unit_id}:${group.group_number}`]));
    await saveResource(`timetable:${scope}`, state);
    const window = windowFrom(state, session, periods);
    if (window) options.onUpdate?.(window);
  };
  async function request<T>(kind: string, body: Record<string, unknown>) {
    assertCurrent();
    const key = `${scope}:${kind}:${JSON.stringify(body)}`;
    if (!inflight.has(key)) {
      const promise = transport<{ data: T }>(`/usos/timetable/${kind}`, body).then((result) => result.data).finally(() => inflight.delete(key));
      inflight.set(key, promise);
    }
    return inflight.get(key)! as Promise<T>;
  }
  for (let week = monday(start), count = 0; week <= end && count < 6; week = shiftDay(week, 7), count++) {
    if (!navigator.onLine) break;
    const saved = state.weeks[week];
    if (saved && !options.force && Date.now() - saved.ts < SIX_HOURS) continue;
    const data = await request<Row[]>('week', { start: week, ...search, album: session.userId, force: options.force === true });
    state.weeks[week] = { data, ts: Date.now() };
    await publish();
  }
  if (!search.query && options.bulk && navigator.onLine && document.visibilityState !== 'hidden') {
    if (!state.catalog || Date.now() - state.catalog.ts > SEVEN_DAYS) state.catalog = { data: await request<Term[]>('catalog', {}), ts: Date.now() };
    const terms = state.catalog.data.filter((term) => term.start <= end && term.end >= start);
    for (const term of terms) {
      if (term.groups.length > 48) continue;
      let complete = true;
      for (const group of term.groups) {
        if (!navigator.onLine || document.hidden) { complete = false; break; }
        const key = `${group.course_unit_id}:${group.group_number}`;
        const saved = state.groups[key];
        if (saved && Date.now() - saved.ts < SEVEN_DAYS) continue;
        state.groups[key] = { data: await request<Row[]>('group', { unit: group.course_unit_id, number: group.group_number, metadata: group }), ts: Date.now() };
        await publish();
      }
      if (complete && !state.completeTerms.includes(term.id)) state.completeTerms.push(term.id);
    }
    await publish();
  }
  const window = windowFrom(state, session, periods);
  if (!window) throw new Error(navigator.onLine ? 'Brak planu w USOS.' : 'Brak zapisanego planu w tym zakresie.');
  return window;
}
