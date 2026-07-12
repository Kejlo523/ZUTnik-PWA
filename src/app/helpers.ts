import type { Grade, PlanSubjectFilter, SessionData, ViewMode } from '../types';
import { extractPlanFilterTypeKey, normalizePlanFilterString } from '../planFilters';

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDateLabel(v: string, lang: string = 'pl'): string {
  const d = new Date(`${v}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return v;
  const loc = lang === 'en' ? 'en-US' : 'pl-PL';
  return new Intl.DateTimeFormat(loc, { day: '2-digit', month: '2-digit', weekday: 'short' }).format(d);
}

export function fmtWeekdayShort(v: string, lang: string = 'pl'): string {
  const d = new Date(`${v}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return v;
  const loc = lang === 'en' ? 'en-US' : 'pl-PL';
  return new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(d);
}

export function fmtDayMonth(v: string, lang: string = 'pl'): string {
  const d = new Date(`${v}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return v;
  const loc = lang === 'en' ? 'en-US' : 'pl-PL';
  return new Intl.DateTimeFormat(loc, { day: '2-digit', month: '2-digit' }).format(d);
}

export function fmtHour(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function isWeekendDate(dateYmd: string): boolean {
  const d = new Date(`${dateYmd}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return false;
  const day = d.getDay();
  return day === 0 || day === 6;
}

function normalizeMatch(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const PLAN_TEACHER_TITLE_TOKENS = new Set([
  'prof',
  'profesor',
  'dr',
  'doktor',
  'hab',
  'habilitowany',
  'inz',
  'inż',
  'mgr',
  'magister',
  'lic',
  'licencjat',
  'doc',
  'docent',
  'lek',
  'med',
]);

function normalizeTeacherToken(token: string): string {
  return normalizeMatch(token).replace(/[^a-z-]/g, '');
}

export function toPlanTeacherSearchQuery(value: string): string {
  const tokens = String(value || '')
    .replace(/[(),]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return '';

  const filtered = tokens.filter((token) => {
    const normalized = normalizeTeacherToken(token);
    return normalized && !PLAN_TEACHER_TITLE_TOKENS.has(normalized);
  });

  if (filtered.length === 0) return '';

  const uppercaseNameTokens = filtered.filter((token) => {
    const cleaned = token.replace(/[.,]/g, '');
    return cleaned.length > 0 && cleaned === cleaned.toUpperCase();
  });

  const source = uppercaseNameTokens.length >= 2
    ? uppercaseNameTokens.map((token) => token.replace(/[.,]/g, ''))
    : filtered.map((token) => token.replace(/[.,]/g, '').toUpperCase());

  if (source.length < 2) return source.join(' ');
  return [...source.slice(1), source[0]].join(' ');
}

export function isFinalGradeType(type: string, subjectName?: string): boolean {
  const t = normalizeMatch(type);
  if (
    t.includes('ocena koncowa') ||
    t.includes('koncowa') ||
    t.includes('final') ||
    t.includes('abschluss')
  ) {
    return true;
  }
  if (!t) {
    const s = normalizeMatch(subjectName || '');
    return (
      s.includes('ocena koncowa') ||
      s.includes('koncowa') ||
      s.includes('final') ||
      s.includes('abschluss')
    );
  }
  return false;
}

export function cleanGradeText(value: string | undefined): string {
  const text = String(value || '').trim();
  const lower = text.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return '';
  return text;
}

export function extractGradeBaseSubject(value: string | undefined): string {
  const text = cleanGradeText(value);
  if (!text.endsWith(')')) return text;

  const open = text.lastIndexOf('(');
  if (open <= 0) return text;

  return text.slice(0, open).trim();
}

export function extractGradeTypeFromSubject(value: string | undefined): string {
  const text = cleanGradeText(value);
  if (!text.endsWith(')')) return '';

  const open = text.lastIndexOf('(');
  if (open < 0 || open >= text.length - 2) return '';

  return text.slice(open + 1, -1).trim();
}

function resolveGradeTypeFromCourseId(courseId: string | undefined): string | null {
  const match = cleanGradeText(courseId).match(/-([A-Z]{2})$/i);
  if (!match) return null;

  switch (match[1].toUpperCase()) {
    case 'WK':
      return 'lec';
    case 'CW':
      return 'aud';
    case 'LB':
      return 'lab';
    case 'LE':
    case 'LK':
      return 'lek';
    default:
      return null;
  }
}

function isGenericGradeTypeLabel(type: string): boolean {
  return type.includes('koncowa')
    || type.includes('final')
    || type.includes('zaliczen')
    || type.includes('egzamin')
    || type.includes('exam');
}

export function resolveGradeTypeKey(grade: Grade): string | null {
  const fromCourseId = resolveGradeTypeFromCourseId(grade.courseId);
  if (fromCourseId) return fromCourseId;

  let type = normalizePlanFilterString(grade.type);
  if (!type) {
    type = normalizePlanFilterString(extractGradeTypeFromSubject(grade.subjectName));
  }
  if (!type || isGenericGradeTypeLabel(type)) return null;

  if (type === 'l' || type.includes('lab')) return 'lab';
  if (type === 'a' || type.includes('aud')) return 'aud';
  if (type === 'w' || type.includes('wyk') || type.includes('lec')) return 'lec';
  if (type.includes('laboratorium') || type.includes('laboratory')) return 'lab';
  if (type.includes('audytoryjne') || type.includes('auditory') || type.includes('auditorium')) return 'aud';
  if (type.includes('wyklad') || type.includes('lecture')) return 'lec';
  if (type.includes('lektorat') || type.includes('lectorate') || type.includes('language course') || type.includes('angiels')) return 'lek';
  if (type.includes('cwiczen')) return 'aud';
  return null;
}

export function planSubjectFilterSubject(item: PlanSubjectFilter): string {
  return cleanGradeText(item.subjectLabel)
    || extractGradeBaseSubject(item.label)
    || cleanGradeText(item.label);
}

export function gradeMatchesHiddenPlanFilter(grade: Grade, item: PlanSubjectFilter): boolean {
  const gradeSubject = extractGradeBaseSubject(grade.subjectName) || cleanGradeText(grade.subjectName);
  const filterSubject = planSubjectFilterSubject(item);
  if (!normalizePlanFilterString(gradeSubject) || normalizePlanFilterString(gradeSubject) !== normalizePlanFilterString(filterSubject)) {
    return false;
  }

  const gradeTypeKey = resolveGradeTypeKey(grade);
  const filterTypeKey = cleanGradeText(item.typeKey) || extractPlanFilterTypeKey(item.key);
  return !gradeTypeKey || !filterTypeKey || gradeTypeKey === filterTypeKey;
}

export function getSessionSignature(session: SessionData | null): string {
  if (!session) return '';
  return [
    session.userId,
    session.authKey,
    session.usos?.accessToken ?? '',
    session.usos?.accessTokenSecret ?? '',
  ].join('|');
}

export function gradeTone(g: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  const normalized = g.trim().toLowerCase();
  if (normalized === '-' || normalized === '') return 'neutral';
  if (normalized === 'zal' || normalized === 'zaliczone') return 'ok';
  if (normalized === 'niezal' || normalized === 'niezaliczone') return 'bad';

  const v = Number.parseFloat(g.replace(',', '.'));
  if (!Number.isFinite(v)) return 'neutral';
  if (v > 2) return 'ok';
  return 'bad';
}

export function parseGradeNum(g: string): number | null {
  const v = Number.parseFloat(g.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FAIL_TO_PASS_CORRECTION_WINDOW_MS = 120 * DAY_MS;
const PAIR_CORRECTION_WINDOW_MS = 45 * DAY_MS;

function gradeTimestamp(grade: Grade): number {
  const value = cleanGradeText(grade.date);
  if (!value) return 0;

  const iso = Date.parse(value);
  if (Number.isFinite(iso)) return iso;

  const pl = value.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!pl) return 0;
  return Date.UTC(Number(pl[3]), Number(pl[2]) - 1, Number(pl[1]));
}

function gradeSession(grade: Grade): number {
  const value = Number.parseInt(String(grade.examSessionNumber || ''), 10);
  return Number.isFinite(value) ? value : 0;
}

function correctionKey(grade: Grade, index: number): string {
  const subject = normalizePlanFilterString(extractGradeBaseSubject(grade.subjectName) || grade.subjectName);
  if (!subject) return `unique:${index}`;

  const type = resolveGradeTypeKey(grade)
    || normalizePlanFilterString(grade.type || extractGradeTypeFromSubject(grade.subjectName))
    || (isFinalGradeType(grade.type, grade.subjectName) ? 'final' : 'grade');
  const courseId = normalizePlanFilterString(grade.courseId || '');
  return `${subject}|${courseId}|${type}`;
}

function shouldCollapseCorrection(entries: Array<{ grade: Grade; index: number }>): boolean {
  const values = new Set<string>();
  const courseIds = new Set<string>();
  const sessions = new Set<number>();
  const numeric: number[] = [];
  const times: number[] = [];

  for (const { grade } of entries) {
    const value = cleanGradeText(grade.grade).replace(',', '.');
    if (value) values.add(value);
    const courseId = normalizePlanFilterString(grade.courseId || '');
    if (courseId) courseIds.add(courseId);
    const session = gradeSession(grade);
    if (session > 0) sessions.add(session);
    const parsed = parseGradeNum(value);
    if (parsed !== null) numeric.push(parsed);
    const time = gradeTimestamp(grade);
    if (time > 0) times.push(time);
  }

  if (values.size < 2 || numeric.length < 2) return false;
  if (sessions.size > 1) return true;

  const span = times.length > 0 ? Math.max(...times) - Math.min(...times) : Number.POSITIVE_INFINITY;
  if (Math.min(...numeric) <= 2 && Math.max(...numeric) > 2 && span <= FAIL_TO_PASS_CORRECTION_WINDOW_MS) {
    return true;
  }
  return entries.length === 2 && courseIds.size <= 1 && span <= PAIR_CORRECTION_WINDOW_MS;
}

function compareGradeOrder(
  left: { grade: Grade; index: number },
  right: { grade: Grade; index: number },
): number {
  const byTime = gradeTimestamp(left.grade) - gradeTimestamp(right.grade);
  if (byTime !== 0) return byTime;
  const bySession = gradeSession(left.grade) - gradeSession(right.grade);
  if (bySession !== 0) return bySession;
  const leftValue = parseGradeNum(left.grade.grade);
  const rightValue = parseGradeNum(right.grade.grade);
  if (leftValue !== null && rightValue !== null && leftValue !== rightValue) return leftValue - rightValue;
  return left.index - right.index;
}

export function collapseCorrectedGrades(source: Grade[]): Grade[] {
  const grouped = new Map<string, Array<{ grade: Grade; index: number }>>();
  source.forEach((grade, index) => {
    const key = correctionKey(grade, index);
    const entries = grouped.get(key) || [];
    entries.push({ grade, index });
    grouped.set(key, entries);
  });

  const result: Grade[] = [];
  for (const entries of grouped.values()) {
    if (entries.length < 2 || !shouldCollapseCorrection(entries)) {
      result.push(...entries.map(({ grade }) => ({ ...grade, gradeHistory: [...(grade.gradeHistory || [])] })));
      continue;
    }

    const ordered = [...entries].sort(compareGradeOrder);
    const active = ordered[ordered.length - 1].grade;
    const history: string[] = [];
    for (const { grade } of ordered) {
      const value = cleanGradeText(grade.grade);
      if (value && history[history.length - 1]?.replace(',', '.') !== value.replace(',', '.')) history.push(value);
    }
    result.push({ ...active, gradeHistory: history });
  }
  return result;
}

export function gradeCorrectionLabel(grade: Grade): string {
  const current = cleanGradeText(grade.grade);
  if (!current || !grade.gradeHistory || grade.gradeHistory.length < 2) return '';
  const previous = grade.gradeHistory.find((value) => cleanGradeText(value).replace(',', '.') !== current.replace(',', '.'));
  return previous ? `${previous} → ${current}` : '';
}

export function planTypeShort(typeClass: string, typeLabel: string): string {
  const codes: Record<string, string> = {
    lecture: 'W', lab: 'L', auditory: 'Ć', exercise: 'Ć', project: 'P',
    seminar: 'S', language: 'J', lectorate: 'J', exam: 'E', pass: 'Z',
    remote: 'Z', cancelled: 'O', field: 'T', class: 'Z',
  };
  if (codes[typeClass]) return codes[typeClass];
  const label = cleanGradeText(typeLabel);
  return label ? label.slice(0, 1).toLocaleUpperCase('pl') : 'Z';
}

export function fmtDec(v: number, d: number): string {
  if (!Number.isFinite(v)) return '-';
  return v.toFixed(d).replace('.', ',');
}

export function initials(name: string): string {
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return 'S';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function planCacheKey(viewMode: ViewMode, date: string, studyId: string | null | undefined): string {
  return `v2_${viewMode}_${date}_${studyId ?? 'nostudy'}`;
}

export function sumUniqueEcts(items: Grade[]): number {
  if (!items.length) return 0;

  let sumFinal = 0;
  let hasFinal = false;

  for (const g of items) {
    if (!isFinalGradeType(g.type, g.subjectName)) continue;
    hasFinal = true;
    if (Number.isFinite(g.weight) && g.weight > 0) {
      sumFinal += g.weight;
    }
  }

  if (hasFinal) return sumFinal;

  let sumAll = 0;
  for (const g of items) {
    if (Number.isFinite(g.weight) && g.weight > 0) {
      sumAll += g.weight;
    }
  }
  return sumAll;
}
