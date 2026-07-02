type FilterablePlanEvent = {
  subjectKey?: string;
  title?: string;
  typeClass?: string;
  typeLabel?: string;
};

function normalizeText(value: string | undefined): string {
  return String(value || '').trim();
}

function readableTypeLabel(event: FilterablePlanEvent): string {
  return normalizeText(event.typeLabel) || 'Zajęcia';
}

export function normalizePlanFilterString(value: string | undefined): string {
  const lower = normalizeText(value).toLowerCase();
  if (!lower) return '';
  return lower
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd');
}

export function planFilterTypeKey(typeClass: string | undefined, typeLabel?: string): string {
  const classKey = normalizePlanFilterString(typeClass);
  const labelKey = normalizePlanFilterString(typeLabel);
  const hay = `${classKey} ${labelKey}`.trim();

  if (!hay) return '';
  if (classKey === 'lec' || classKey === 'lecture' || classKey.endsWith('-lecture')) return 'lec';
  if (classKey === 'aud' || classKey === 'cw' || classKey === 'auditory' || classKey.endsWith('-auditory')) return 'aud';
  if (classKey === 'lab' || classKey.endsWith('-lab')) return 'lab';
  if (classKey === 'le' || classKey === 'lek' || classKey === 'lk' || classKey === 'lectorate' || classKey.endsWith('-lectorate')) return 'lek';

  if (labelKey === 'w' || hay.includes('wyklad') || hay.includes('lecture')) return 'lec';
  if (labelKey === 'a' || labelKey === 'cw' || hay.includes('cwiczen') || hay.includes('audytoryjne') || hay.includes('auditory') || hay.includes('auditorium')) return 'aud';
  if (labelKey === 'l' || hay.includes('laboratorium') || hay.includes('laboratory') || hay.includes('lab')) return 'lab';
  if (labelKey === 'le' || labelKey === 'lek' || labelKey === 'lk' || hay.includes('lektorat') || hay.includes('lectorate') || hay.includes('language course')) return 'lek';

  return '';
}

export function getPlanEventSubjectLabel(event: FilterablePlanEvent): string {
  return normalizeText(event.title) || normalizeText(event.subjectKey) || 'Przedmiot';
}

export function getPlanEventFilterTypeKey(event: FilterablePlanEvent): string {
  return planFilterTypeKey(event.typeClass, event.typeLabel);
}

export function getPlanEventFilterKey(event: FilterablePlanEvent): string {
  const subjectKey = normalizeText(event.subjectKey) || normalizeText(event.title) || 'Przedmiot';
  const typeKey = getPlanEventFilterTypeKey(event) || 'class';
  return `${subjectKey}||${typeKey}`;
}

export function getPlanEventFilterLabel(event: FilterablePlanEvent): string {
  const subjectLabel = getPlanEventSubjectLabel(event);
  return `${subjectLabel} (${readableTypeLabel(event)})`;
}

export function extractPlanFilterTypeKey(filterKey: string | undefined): string {
  const raw = normalizeText(filterKey);
  const separator = raw.lastIndexOf('||');
  if (separator < 0 || separator >= raw.length - 2) return '';
  const suffix = raw.slice(separator + 2).trim();
  return planFilterTypeKey(suffix, suffix);
}

export function normalizePlanFilterKey(value: string | undefined): string {
  const raw = normalizeText(value);
  if (!raw) return '';

  const separator = raw.lastIndexOf('||');
  if (separator < 0 || separator >= raw.length - 2) return raw;

  const subject = raw.slice(0, separator).trim();
  const suffix = raw.slice(separator + 2).trim();
  if (!subject || !suffix) return raw;

  const mappedType = planFilterTypeKey(suffix, suffix);
  return `${subject}||${mappedType || suffix}`;
}
