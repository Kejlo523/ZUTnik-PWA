import type { PlanResult } from '../types';

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

function timestampUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function buildFileName(planResult: PlanResult): string {
  const rangeDays = Math.round(
    (new Date(`${planResult.rangeEnd}T00:00:00`).getTime() - new Date(`${planResult.rangeStart}T00:00:00`).getTime())
    / 86_400_000,
  ) + 1;

  if (rangeDays > 45) {
    return `zutnik-plan-semestr-${planResult.rangeStart}-${planResult.rangeEnd}.ics`;
  }

  const suffix = planResult.viewMode === 'day'
    ? 'dzien'
    : planResult.viewMode === 'month'
      ? 'miesiac'
      : 'tydzien';
  return `zutnik-plan-${suffix}-${planResult.currentDate}.ics`;
}

export function exportPlanToIcs(planResult: PlanResult): boolean {
  const events = planResult.dayColumns.flatMap((column) => column.events.map((event) => ({ date: column.date, event })));
  if (!events.length) return false;

  const generatedAt = timestampUtc(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ZUTnik PWA//Plan Export//PL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText('ZUTnik - Plan zajęć')}`,
  ];

  for (const { date, event } of events) {
    const description = [
      event.typeLabel ? `Typ: ${event.typeLabel}` : '',
      event.group ? `Grupa: ${event.group}` : '',
      event.teacher ? `Prowadzący: ${event.teacher}` : '',
      event.tooltip ? event.tooltip : '',
    ].filter(Boolean).join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(`${date}-${event.startMin}-${event.endMin}-${event.subjectKey || event.title}@zutnik-pwa`)}`,
      `DTSTAMP:${generatedAt}`,
      `DTSTART:${formatIcsDateTime(date, event.startStr)}`,
      `DTEND:${formatIcsDateTime(date, event.endStr)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
    );

    if (event.room && event.room !== '-') {
      lines.push(`LOCATION:${escapeIcsText(event.room)}`);
    }
    if (description) {
      lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildFileName(planResult);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
