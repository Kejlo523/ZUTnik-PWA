import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanResult, SessionData, ViewMode } from '../types';
import { buildPlanResultFromWindow, fetchPlanWindow, type PlanWindowData } from '../services/api';
import { cachedTimetableWindow, coversRange, timetableScope } from '../services/timetable';
import { beginRefresh, finishRefresh } from '../services/refreshPolicy';
import { cache } from '../services/storage';
import { planCacheKey } from '../app/helpers';

type Search = { category: string; query: string };
export function useTimetable({ session, mode, date, search, onResult, onLoading, onUpdated, ensureValid, onError, onToast }: {
  session: SessionData | null; mode: ViewMode; date: string; search: Search;
  onResult: React.Dispatch<React.SetStateAction<PlanResult | null>>;
  onLoading: (value: boolean) => void; onUpdated: (value: number) => void;
  ensureValid: (session: SessionData) => Promise<boolean>; onError: (error: unknown) => void; onToast: (message: string) => void;
}) {
  const sequence = useRef(0);
  const requests = useRef(new Map<string, Promise<PlanWindowData>>());
  const owner = useRef(session?.userId);
  owner.current = session?.userId;
  const scope = session ? timetableScope(session, search) : '';
  const [snapshot, setSnapshot] = useState<{ scope: string; window: PlanWindowData } | null>(null);
  useEffect(() => { sequence.current++; }, [session?.userId, session?.usos?.accessToken]);

  const load = useCallback(async (override?: Search, force = false, newDate?: string) => {
    if (!session) return;
    const target = newDate || date;
    const query = { category: override?.category ?? search.category, query: (override?.query ?? search.query).trim() };
    const id = ++sequence.current;
    const key = `${session.userId}:${mode}:${target}:${query.category}:${query.query}`;
    const cacheKey = planCacheKey(mode, target, session.activeStudyId);
    let hasCache = false;
    const current = () => sequence.current === id && owner.current === session.userId;
    const publish = (window: PlanWindowData) => {
      if (!current()) return;
      setSnapshot({ scope: timetableScope(session, query), window });
      const result = buildPlanResultFromWindow(window, { viewMode: mode, currentDate: target });
      onResult((previous) => JSON.stringify(previous) === JSON.stringify(result) ? previous : result);
      onUpdated(window.fetchedAt || 0);
      if (!query.query && coversRange(window, mode, target)) cache.savePlan(cacheKey, result, window.fetchedAt);
      hasCache = true;
    };
    const saved = await cachedTimetableWindow(session, query);
    if (!current()) return;
    if (saved) publish(saved);
    else if (!query.query) {
      const legacyView = cache.loadPlanForce(cacheKey);
      if (legacyView) { hasCache = true; onResult(legacyView); onUpdated(cache.loadPlanTimestamp(cacheKey)); }
      else onResult(null);
    } else onResult(null);

    const existing = requests.current.get(key);
    if (existing) {
      onLoading(true);
      try { publish(await existing); } catch (error) { if (current() && !hasCache) onError(error); }
      finally { if (current()) onLoading(false); }
      return;
    }
    const decision = beginRefresh(session.userId, 'plan', force, Boolean(saved && coversRange(saved, mode, target, true)), Boolean(saved && coversRange(saved, mode, target)));
    if (!decision.allow) {
      onLoading(false);
      if (force) onToast(decision.reason === 'cooldown' ? 'Plan odświeżono niedawno. Ponów za 5 minut.' : decision.reason === 'offline' ? 'Tryb offline. Pokazuję zapisany plan.' : 'Pobieranie chwilowo wstrzymane. Pokazuję zapisany plan.');
      return;
    }
    if (!(await ensureValid(session)) || !current()) { finishRefresh(session.userId, 'plan', true); return; }
    onLoading(true);
    const request = fetchPlanWindow(session, { viewMode: mode, currentDate: target, studyId: session.activeStudyId,
      search: query, force, onUpdate: publish });
    requests.current.set(key, request);
    try { publish(await request); finishRefresh(session.userId, 'plan', true); }
    catch (error) {
      finishRefresh(session.userId, 'plan', false);
      if (current()) { if (!hasCache) onError(error); else if (force) onToast('Nie udało się zakończyć synchronizacji. Zachowano zapisany plan.'); }
    } finally {
      requests.current.delete(key);
      if (current()) onLoading(false);
    }
  }, [session, date, mode, search.category, search.query, ensureValid, onResult, onLoading, onUpdated, onError, onToast]);
  return { load, window: snapshot?.scope === scope ? snapshot.window : null };
}
