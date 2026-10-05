import type { PlanResult, ViewMode } from '../types';
import { buildPlanResultFromWindow, type PlanWindowData } from './api';
import { coversRange } from './timetable';
import { getPlanEventFilterKey } from '../planFilters';
import { relayoutDayEvents } from '../app/planLayout';

const EMPTY_WINDOW: PlanWindowData = {
  rangeStart: '', rangeEnd: '', album: '', events: [], sessionPeriods: [], entriesTotal: 0, daysWithData: [],
};

export function filterTimetable(result: PlanResult, hiddenKeys: string[]): PlanResult {
  if (!hiddenKeys.length) return result;
  const hidden = new Set(hiddenKeys);
  const dayColumns = result.dayColumns.map((column) => ({ ...column,
    events: relayoutDayEvents(column.events.filter((event) => !hidden.has(getPlanEventFilterKey(event)))),
  }));
  const visibleDates = new Set(dayColumns.filter((column) => column.events.length).map((column) => column.date));
  return { ...result, dayColumns,
    monthGrid: result.monthGrid.map((week) => week.map((cell) => ({ ...cell, hasPlan: visibleDates.has(cell.date) }))),
    hasAnyEventsInRange: visibleDates.size > 0,
  };
}

export interface TimetablePage { key: string; result: PlanResult; cached: boolean; }

// Adjacent pages are projections of the saved window, never prefetch requests.
export function timetablePages(mode: ViewMode, date: string, current: PlanResult | null, window: PlanWindowData | null, hiddenKeys: string[]): TimetablePage[] {
  const build = (day: string) => buildPlanResultFromWindow(window ?? EMPTY_WINDOW, { viewMode: mode, currentDate: day });
  const center = build(date);
  return [center.prevDate, date, center.nextDate].map((day) => {
    const projected = day === date ? center : build(day);
    const matches = current?.viewMode === mode && current.rangeStart === projected.rangeStart && current.rangeEnd === projected.rangeEnd;
    return { key: `${mode}:${projected.rangeStart}`, result: matches ? current : filterTimetable(projected, hiddenKeys),
      cached: Boolean(window ? coversRange(window, mode, day) : matches),
    };
  });
}
