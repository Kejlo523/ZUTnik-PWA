import type { SessionPeriod } from '../types';
import type { TranslateFn } from './viewTypes';

export interface PeriodBoundary {
  period: SessionPeriod;
  edge: 'start' | 'end';
  kind: 'session' | 'break' | 'holiday';
}

export function periodBoundaries(periods: SessionPeriod[], left: string, right: string): PeriodBoundary[] {
  return periods.flatMap((period) => {
    const kind = /sesja|exam/.test(period.key) ? 'session' : /przerwa|break/.test(period.key) ? 'break' : 'holiday';
    const markers: PeriodBoundary[] = [];
    if (period.start > left && period.start <= right) markers.push({ period, edge: 'start', kind });
    if (period.end >= left && period.end < right) markers.push({ period, edge: 'end', kind });
    return markers;
  });
}

export function periodMarkerLabel(marker: PeriodBoundary, t: TranslateFn): string {
  const key = `periodName.${marker.period.key}`;
  const name = t(key);
  return `${t(`period.${marker.edge}`)} ${name === key ? marker.period.key.replaceAll('_', ' ') : name}`;
}
