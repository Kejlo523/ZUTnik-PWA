import type {
  CalendarEvent,
  CourseTest,
  CreditSummary,
  ElsCard,
  FinanceRecord,
  Grade,
  NewsItem,
  PlanResult,
  SessionData,
  SessionPeriod,
  Semester,
  StatsSnapshot,
  Study,
  StudyDetails,
  StudyHistoryItem,
  SurveyItem,
  UsosSessionData,
  ViewMode,
} from '../types';
import { getPlanEventFilterKey, getPlanEventFilterLabel } from '../planFilters';
import { loadOrCreateDeviceId } from './storage';

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? '/api' : `${import.meta.env.BASE_URL}api`);
const DEVICE_ID = loadOrCreateDeviceId();
const SESSION_EXPIRED_MESSAGE = 'Sesja wygasła, zaloguj się ponownie';
const USOS_LOGIN_SCOPES = 'studies|grades|payments|cards|photo|crstests|surveys_filling|offline_access';

interface UsosProfileUser {
  id?: string | number;
  firstName?: string;
  lastName?: string;
  name?: string;
  studentNumber?: string | number;
  studentStatus?: unknown;
}

interface UsosProfileProgramme {
  studentProgrammeId?: string | number;
  programmeId?: string | number;
  name?: string;
  facultyId?: string | number;
  facultyName?: string;
  mode?: string;
  level?: string;
  status?: string;
  statusLabel?: string;
  admissionDate?: string;
  isPrimary?: boolean;
}

interface UsosMeResponse {
  user?: UsosProfileUser;
  programmes?: UsosProfileProgramme[];
  scopes?: string[];
}

export class SessionExpiredError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export function isSessionExpiredError(error: unknown): error is SessionExpiredError {
  return error instanceof SessionExpiredError;
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function ensureArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  return [value as T];
}

function hasHttpAuthError(status: number, message: string): boolean {
  if (status === 401 || status === 403) return true;
  const normalized = message.toLowerCase();
  return normalized.includes('unauthorized')
    || normalized.includes('forbidden')
    || normalized.includes('oauth_problem=token_rejected')
    || normalized.includes('token rejected');
}

function decodeCommonHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanErrorText(value: string): string {
  return decodeCommonHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getFriendlyErrorMessage(error: unknown, fallback = 'Coś poszło nie tak. Spróbuj ponownie za chwilę.'): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : fallback;
  const rawNormalized = raw.toLowerCase();
  const cleaned = cleanErrorText(raw);
  const normalized = cleaned.toLowerCase();

  if (!cleaned) return fallback;
  if (
    normalized.includes('service unavailable')
    || normalized.includes('error 503')
    || normalized.includes('503')
    || normalized.includes('temporarily overloading')
    || normalized.includes('server is temporarily')
  ) {
    return 'USOS jest teraz chwilowo niedostępny. Spróbuj ponownie za chwilę.';
  }
  if (rawNormalized.includes('doctype html') || rawNormalized.includes('<!doctype') || rawNormalized.includes('<html')) {
    return 'Zewnętrzny serwer zwrócił nieczytelną odpowiedź. Spróbuj ponownie za chwilę.';
  }
  if (cleaned.length > 180) {
    return `${cleaned.slice(0, 177).trim()}...`;
  }

  return cleaned;
}

function createApiRequestInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers ?? {});
  headers.set('X-ZUTnik-Device-Id', DEVICE_ID);
  return { ...init, headers };
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, createApiRequestInit(init));
}

function fallbackStudy(session: SessionData): Study {
  void session;
  return {
    przynaleznoscId: 'usos-profile',
    label: 'Profil USOS',
  };
}

function mapUsosStudies(me: UsosMeResponse, session: SessionData): Study[] {
  const studies = ensureArray<UsosProfileProgramme>(me.programmes)
    .map((row) => {
      const id = firstNonEmpty(row.studentProgrammeId, row.programmeId);
      if (!id) return null;

      const label = firstNonEmpty(row.name, row.programmeId, id);
      const mode = firstNonEmpty(row.mode);
      return {
        przynaleznoscId: id,
        label: mode ? `${label} (${mode.toLocaleLowerCase('pl-PL')})` : label,
      };
    })
    .filter((study): study is Study => Boolean(study));

  return studies.length ? studies : [fallbackStudy(session)];
}

function normalizeStringArray(value: unknown): string[] {
  return ensureArray<unknown>(value)
    .map((item) => firstNonEmpty(item))
    .filter(Boolean);
}

function hasUsosScope(session: SessionData, scope: string): boolean {
  return Boolean(session.usos?.scopes?.includes(scope));
}

async function postUsosEndpoint<T>(usos: UsosSessionData, path: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await apiFetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: usos.accessToken,
      secret: usos.accessTokenSecret,
      scopes: usos.scopes ?? [],
      ...payload,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    const errorMessage = getFriendlyErrorMessage(body.error || `USOS API error: ${response.status}`);
    if (hasHttpAuthError(response.status, errorMessage)) {
      throw new SessionExpiredError();
    }
    throw new Error(errorMessage);
  }

  return body;
}

async function fetchUsosMe(usos: UsosSessionData): Promise<UsosMeResponse> {
  return postUsosEndpoint<UsosMeResponse>(usos, '/usos/me');
}

function fixImageUrls(html: string): string {
  return html.replace(/<img([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (
    _match: string,
    before: string,
    src: string,
    after: string,
  ) => {
    let fixedSrc = src;
    if (fixedSrc && !fixedSrc.startsWith('http') && !fixedSrc.startsWith('data:')) {
      fixedSrc = fixedSrc.startsWith('/')
        ? `https://www.zut.edu.pl${fixedSrc}`
        : `https://www.zut.edu.pl/${fixedSrc}`;
    }
    return `<img${before}src="${fixedSrc}"${after}>`;
  });
}

async function proxyRssXml(): Promise<string> {
  const response = await apiFetch(`${API_BASE}/proxy/rss`);
  const body = (await response.json().catch(() => ({}))) as { xml?: string; error?: string };
  if (!response.ok) {
    throw new Error(getFriendlyErrorMessage(body.error || `RSS proxy HTTP ${response.status}`));
  }
  return body.xml || '';
}

function parseRssNews(xml: string): NewsItem[] {
  if (!xml.trim()) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const items = Array.from(doc.querySelectorAll('item'));

  return items.map((item, index) => {
    const title = firstNonEmpty(item.querySelector('title')?.textContent ?? '');
    const link = firstNonEmpty(item.querySelector('link')?.textContent ?? '');
    const pubDateRaw = firstNonEmpty(item.querySelector('pubDate')?.textContent ?? '');

    const descriptionHtml = fixImageUrls(firstNonEmpty(item.querySelector('description')?.textContent ?? ''));
    const contentNode = item.getElementsByTagName('content:encoded')[0] ?? item.getElementsByTagName('encoded')[0];
    const contentHtml = fixImageUrls(firstNonEmpty(contentNode?.textContent ?? ''));
    const htmlForText = descriptionHtml || contentHtml;

    const descriptionText = String(htmlForText)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    const snippet = descriptionText.length > 220 ? `${descriptionText.slice(0, 217)}...` : descriptionText;

    const imgMatch = (contentHtml || descriptionHtml).match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    const thumbUrl = imgMatch?.[1] ?? '';
    const parsedDate = new Date(pubDateRaw);
    const date = Number.isFinite(parsedDate.getTime())
      ? new Intl.DateTimeFormat('pl-PL', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(parsedDate)
      : pubDateRaw;

    return {
      id: index,
      title,
      date,
      pubDateRaw,
      snippet,
      link,
      descriptionHtml,
      descriptionText,
      contentHtml,
      thumbUrl,
    };
  });
}

async function proxyPlanStudent(query: Record<string, string>): Promise<Record<string, unknown>[]> {
  const url = new URL(`${API_BASE}/proxy/plan-student`, window.location.origin);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const response = await apiFetch(`${url.pathname}${url.search}`);
  const body = (await response.json().catch(() => ({}))) as { data?: Record<string, unknown>[]; error?: string };
  if (!response.ok) {
    throw new Error(getFriendlyErrorMessage(body.error || `Plan proxy HTTP ${response.status}`));
  }
  return Array.isArray(body.data) ? body.data : [];
}

function normalizePlanHiddenSubjectKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export async function fetchPlanHiddenSubjects(album: string): Promise<string[]> {
  const normalizedAlbum = firstNonEmpty(album);
  if (!normalizedAlbum) return [];

  const response = await apiFetch(`${API_BASE}/plan-hidden-subjects/${encodeURIComponent(normalizedAlbum)}`);
  const body = (await response.json().catch(() => ({}))) as { hiddenSubjectKeys?: unknown; error?: string };
  if (!response.ok) {
    throw new Error(getFriendlyErrorMessage(body.error || `Plan filters HTTP ${response.status}`));
  }

  return normalizePlanHiddenSubjectKeys(body.hiddenSubjectKeys);
}

export async function savePlanHiddenSubjects(album: string, hiddenSubjectKeys: string[]): Promise<string[]> {
  const normalizedAlbum = firstNonEmpty(album);
  if (!normalizedAlbum) return [];

  const response = await apiFetch(`${API_BASE}/plan-hidden-subjects/${encodeURIComponent(normalizedAlbum)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hiddenSubjectKeys: normalizePlanHiddenSubjectKeys(hiddenSubjectKeys) }),
  });
  const body = (await response.json().catch(() => ({}))) as { hiddenSubjectKeys?: unknown; error?: string };
  if (!response.ok) {
    throw new Error(getFriendlyErrorMessage(body.error || `Plan filters HTTP ${response.status}`));
  }

  return normalizePlanHiddenSubjectKeys(body.hiddenSubjectKeys);
}

export async function login(): Promise<SessionData> {
  throw new Error('Logowanie hasłem zostało wyłączone. Użyj logowania przez USOS.');
}

export async function fetchUsosRequestToken(callbackUrl: string): Promise<{ oauth_token: string; oauth_token_secret: string }> {
  const url = new URL(`${API_BASE}/usos/request-token`, window.location.origin);
  url.searchParams.set('callbackUrl', callbackUrl);
  url.searchParams.set('scopes', USOS_LOGIN_SCOPES);
  const response = await apiFetch(url.origin === window.location.origin ? `${url.pathname}${url.search}` : url.toString());
  const body = await response.json();
  if (!response.ok) throw new Error(getFriendlyErrorMessage(body.error || 'Błąd pobierania tokenu USOS.'));
  return body;
}

export async function loginWithUsos(verifier: string, token: string, secret: string): Promise<SessionData> {
  const response = await apiFetch(`${API_BASE}/usos/access-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      oauth_token: token,
      oauth_token_secret: secret,
      oauth_verifier: verifier,
    }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(getFriendlyErrorMessage(body.error || 'Błąd logowania USOS.'));

  const usos: UsosSessionData = {
    accessToken: body.oauth_token,
    accessTokenSecret: body.oauth_token_secret,
    scopes: normalizeStringArray(body.scopes),
    authorizedAt: Number.isFinite(Number(body.authorizedAt)) ? Number(body.authorizedAt) : Date.now(),
    expiresAt: Number.isFinite(Number(body.expiresAt)) ? Number(body.expiresAt) : undefined,
  };
  const me = await fetchUsosMe(usos);
  const user = me.user ?? {};
  const studies = mapUsosStudies(me, {
    userId: firstNonEmpty(user.studentNumber, user.id, 'usos_user'),
    username: '',
    authKey: '',
    imageUrl: '',
    activeStudyId: null,
    usos,
  });

  return {
    userId: firstNonEmpty(user.studentNumber, user.id, 'usos_user'),
    username: firstNonEmpty(user.name, `${firstNonEmpty(user.firstName)} ${firstNonEmpty(user.lastName)}`.trim(), firstNonEmpty(user.id), 'Użytkownik USOS'),
    authKey: '',
    imageUrl: '',
    activeStudyId: studies[0]?.przynaleznoscId ?? 'usos-profile',
    usos,
  };
}

export async function validateSession(session: SessionData): Promise<void> {
  if (!session.usos?.accessToken || !session.usos.accessTokenSecret) {
    throw new SessionExpiredError();
  }
  await fetchUsosMe(session.usos);
}

export async function fetchStudies(session: SessionData): Promise<Study[]> {
  return fetchCombinedStudies(session);
}

export async function fetchCombinedStudies(session: SessionData): Promise<Study[]> {
  if (!session.usos) return [];
  const me = await fetchUsosMe(session.usos);
  return mapUsosStudies(me, session);
}

export async function fetchSemesters(session: SessionData, studyId: string | null): Promise<Semester[]> {
  void studyId;
  if (!session.usos) return [];
  const body = await postUsosEndpoint<{ semesters?: Semester[] }>(session.usos, '/usos/semesters');
  return ensureArray<Semester>(body.semesters);
}

export async function fetchCombinedSemesters(session: SessionData, studyId: string | null): Promise<Semester[]> {
  return fetchSemesters(session, studyId);
}

export async function fetchGrades(session: SessionData): Promise<Grade[]> {
  if (!session.usos) return [];
  const body = await postUsosEndpoint<{ grades?: Grade[] }>(session.usos, '/usos/grades');
  return ensureArray<Grade>(body.grades);
}

export async function fetchCombinedGrades(session: SessionData): Promise<Grade[]> {
  return fetchGrades(session);
}

export async function fetchCourseTests(
  session: SessionData,
  semesterId: string,
): Promise<{ tests: CourseTest[]; missingScopes: string[] }> {
  if (!session.usos || !hasUsosScope(session, 'crstests')) {
    return { tests: [], missingScopes: ['crstests'] };
  }

  const body = await postUsosEndpoint<{ tests?: CourseTest[]; missingScopes?: string[] }>(
    session.usos,
    '/usos/course-tests',
    { termId: semesterId },
  );

  return {
    tests: ensureArray<CourseTest>(body.tests),
    missingScopes: normalizeStringArray(body.missingScopes),
  };
}

export async function fetchFinance(session: SessionData, studyId: string | null): Promise<FinanceRecord[]> {
  void studyId;
  if (!session.usos) return [];
  const body = await postUsosEndpoint<{ records?: FinanceRecord[] }>(session.usos, '/usos/finance');
  return ensureArray<FinanceRecord>(body.records);
}

export async function fetchInfo(
  session: SessionData,
  studyId: string | null,
): Promise<{ details: StudyDetails | null; history: StudyHistoryItem[]; els?: ElsCard | null; calendarEvents?: CalendarEvent[] }> {
  if (!session.usos) {
    return { details: null, history: [], els: null, calendarEvents: [] };
  }

  return postUsosEndpoint<{
    details: StudyDetails | null;
    history: StudyHistoryItem[];
    els?: ElsCard | null;
    calendarEvents?: CalendarEvent[];
  }>(session.usos, '/usos/info', { studyId });
}

export async function fetchCreditSummary(session: SessionData, studyId: string | null): Promise<CreditSummary | null> {
  if (!session.usos) return null;
  const body = await postUsosEndpoint<{ summary?: CreditSummary }>(session.usos, '/usos/credits', { studyId });
  return body.summary ?? null;
}

export async function fetchSurveysToFill(session: SessionData): Promise<{ items: SurveyItem[]; missingScopes: string[] }> {
  if (!session.usos || !hasUsosScope(session, 'surveys_filling')) {
    return { items: [], missingScopes: ['surveys_filling'] };
  }

  const body = await postUsosEndpoint<{ items?: SurveyItem[]; missingScopes?: string[] }>(session.usos, '/usos/surveys');
  return {
    items: ensureArray<SurveyItem>(body.items),
    missingScopes: normalizeStringArray(body.missingScopes),
  };
}

async function fetchUsosNews(): Promise<NewsItem[]> {
  const response = await apiFetch(`${API_BASE}/usos/news`);
  const body = (await response.json().catch(() => ({}))) as { items?: NewsItem[]; error?: string };
  if (!response.ok) throw new Error(getFriendlyErrorMessage(body.error || `USOS news HTTP ${response.status}`));
  return ensureArray<NewsItem>(body.items);
}

export async function fetchNews(): Promise<NewsItem[]> {
  try {
    const rssItems = parseRssNews(await proxyRssXml());
    if (rssItems.length > 0) return rssItems;
  } catch {
    // USOS news stays as a fallback; the public ZUT RSS is the primary feed.
  }

  return fetchUsosNews();
}

export async function requestStatsAccess(session: SessionData): Promise<string> {
  if (!session.usos?.accessToken || !session.usos.accessTokenSecret) {
    throw new SessionExpiredError();
  }

  const response = await apiFetch(`${API_BASE}/stats/access`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: session.usos.accessToken,
      secret: session.usos.accessTokenSecret,
      scopes: session.usos.scopes ?? [],
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };

  if (!response.ok) {
    const errorMessage = getFriendlyErrorMessage(body.error || `Stats access HTTP ${response.status}`);
    if (hasHttpAuthError(response.status, errorMessage)) {
      throw new SessionExpiredError();
    }
    throw new Error(errorMessage);
  }

  return firstNonEmpty(body.url, `${import.meta.env.BASE_URL}stats`);
}

export async function fetchStatsSnapshot(session: SessionData): Promise<StatsSnapshot> {
  if (!session.usos?.accessToken || !session.usos.accessTokenSecret) {
    throw new SessionExpiredError();
  }

  const response = await apiFetch(`${API_BASE}/stats/snapshot`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: session.usos.accessToken,
      secret: session.usos.accessTokenSecret,
      scopes: session.usos.scopes ?? [],
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { snapshot?: StatsSnapshot; error?: string };

  if (!response.ok) {
    const errorMessage = getFriendlyErrorMessage(body.error || `Stats snapshot HTTP ${response.status}`);
    if (hasHttpAuthError(response.status, errorMessage)) {
      throw new SessionExpiredError();
    }
    throw new Error(errorMessage);
  }

  if (!body.snapshot) {
    throw new Error('Brak danych statystyk.');
  }

  return body.snapshot;
}

export async function fetchStudentPhotoBlob(session: SessionData): Promise<Blob | null> {
  if (!session.usos) return null;

  const response = await apiFetch(`${API_BASE}/usos/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: session.usos.accessToken,
      secret: session.usos.accessTokenSecret,
      scopes: session.usos.scopes ?? [],
    }),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    const errorMessage = getFriendlyErrorMessage(body.error || `USOS photo HTTP ${response.status}`);
    if (hasHttpAuthError(response.status, errorMessage)) {
      throw new SessionExpiredError();
    }
    throw new Error(errorMessage);
  }

  const blob = await response.blob();
  return blob.size > 0 ? blob : null;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function parseYmdOrToday(value: string): Date {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? startOfDay(parsed) : startOfDay(new Date());
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toOffsetIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${sign}${oh}:${om}`;
}

function mapSearchCategory(category: string): string {
  const key = String(category || '').toLowerCase();
  if (key.includes('teacher') || key.includes('wyk')) return 'teacher';
  if (key.includes('room') || key.includes('sal')) return 'room';
  if (key.includes('group') || key.includes('grup')) return 'group';
  if (key.includes('subject') || key.includes('przedm')) return 'subject';
  return 'number';
}

function resolveSearchAlbum(category: string, query: string): string {
  return mapSearchCategory(category) === 'number' ? firstNonEmpty(query) : '';
}

function resolveViewRange(viewMode: ViewMode, currentDateText: string): { current: Date; rangeStart: Date; rangeEnd: Date; prev: Date; next: Date } {
  const current = parseYmdOrToday(currentDateText);
  if (viewMode === 'day') {
    return { current, rangeStart: current, rangeEnd: current, prev: addDays(current, -1), next: addDays(current, 1) };
  }
  if (viewMode === 'month') {
    return {
      current,
      rangeStart: new Date(current.getFullYear(), current.getMonth(), 1),
      rangeEnd: new Date(current.getFullYear(), current.getMonth() + 1, 0),
      prev: new Date(current.getFullYear(), current.getMonth() - 1, 1),
      next: new Date(current.getFullYear(), current.getMonth() + 1, 1),
    };
  }
  const day = current.getDay() || 7;
  const rangeStart = addDays(current, -(day - 1));
  const rangeEnd = addDays(rangeStart, 6);
  return { current, rangeStart, rangeEnd, prev: addDays(current, -7), next: addDays(current, 7) };
}

function formatHeaderLabel(viewMode: ViewMode, current: Date, rangeStart: Date, rangeEnd: Date): string {
  if (viewMode === 'day') {
    return new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short' }).format(current);
  }
  if (viewMode === 'month') {
    return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(current);
  }
  const left = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit' }).format(rangeStart);
  const right = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(rangeEnd);
  return `${left} - ${right}`;
}

function parsePlanEventRow(row: Record<string, unknown>): Record<string, string> | null {
  const start = firstNonEmpty(row.start);
  const end = firstNonEmpty(row.end);
  if (!start || !end) return null;
  return {
    title: firstNonEmpty(row.title),
    description: firstNonEmpty(row.description),
    start,
    end,
    workerTitle: firstNonEmpty(row.worker_title),
    worker: firstNonEmpty(row.worker),
    lessonForm: firstNonEmpty(row.lesson_form),
    lessonFormShort: firstNonEmpty(row.lesson_form_short),
    groupName: firstNonEmpty(row.group_name),
    tokName: firstNonEmpty(row.tok_name),
    room: firstNonEmpty(row.room),
    lessonStatus: firstNonEmpty(row.lesson_status),
    lessonStatusShort: firstNonEmpty(row.lesson_status_short),
    subject: firstNonEmpty(row.subject),
  };
}

function parseEventDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function minutesFromMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function formatHm(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function eventTypeClass(event: Record<string, string>): string {
  const status = event.lessonStatusShort.toLowerCase();
  const form = event.lessonForm.toLowerCase();
  const short = event.lessonFormShort.toLowerCase();
  const hay = `${form} ${(event.subject || event.title).toLowerCase()}`;

  if (status === 'e') return 'exam';
  if (status === 'o') return 'cancelled';
  if (status === 'zz') return 'remote';
  if (hay.includes('laboratorium') || short === 'l') return 'lab';
  if (hay.includes('audytoryjne') || short === 'a') return 'auditory';
  if (hay.includes('wyklad') || hay.includes('wykład') || short === 'w') return 'lecture';
  if (hay.includes('egzamin') || form.includes('exam')) return 'exam';
  if (hay.includes('zdalne') || form.includes('remote')) return 'remote';
  if (hay.includes('zaliczenie') || short.startsWith('zal')) return 'pass';
  if (hay.includes('projekt') || short === 'p') return 'project';
  if (hay.includes('seminarium') || short === 's') return 'seminar';
  if (hay.includes('dyplomowe')) return 'diploma';
  if (hay.includes('lektorat') || short === 'le') return 'lectorate';
  if (hay.includes('konwersatorium') || short === 'k') return 'conservatory';
  if (hay.includes('konsultacje')) return 'consultation';
  if (hay.includes('terenowe')) return 'field';
  return 'class';
}

function eventTypeLabel(typeClass: string, event: Record<string, string>): string {
  const labels: Record<string, string> = {
    lecture: 'Wykład',
    lab: 'Laboratorium',
    auditory: 'Ćwiczenia audytoryjne',
    exam: 'Egzamin',
    remote: 'Zdalne',
    cancelled: 'Odwołane',
    pass: 'Zaliczenie',
    project: 'Projekt',
    seminar: 'Seminarium',
    diploma: 'Dyplomowe',
    lectorate: 'Lektorat',
    conservatory: 'Konwersatorium',
    consultation: 'Konsultacje',
    field: 'Zajęcia terenowe',
    class: 'Zajęcia',
  };
  return labels[typeClass] || event.lessonForm || 'Zajęcia';
}

interface PlanLayoutEvent {
  startMin: number;
  endMin: number;
  leftPct: number;
  widthPct: number;
}

function layoutDayEvents<T extends PlanLayoutEvent>(events: T[]): T[] {
  if (events.length < 2) {
    return events.map((event) => ({ ...event, leftPct: 0, widthPct: 100 }));
  }

  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.startMin - b.event.startMin || a.event.endMin - b.event.endMin);
  const positioned = events.map((event) => ({ ...event, leftPct: 0, widthPct: 100 }));

  let cursor = 0;
  while (cursor < sorted.length) {
    const clusterStart = cursor;
    let clusterEndMin = sorted[cursor].event.endMin;
    cursor += 1;

    while (cursor < sorted.length && sorted[cursor].event.startMin < clusterEndMin) {
      clusterEndMin = Math.max(clusterEndMin, sorted[cursor].event.endMin);
      cursor += 1;
    }

    const cluster = sorted.slice(clusterStart, cursor);
    const columnEnds: number[] = [];
    const placement: Array<{ index: number; column: number }> = [];

    for (const item of cluster) {
      let column = -1;
      for (let i = 0; i < columnEnds.length; i += 1) {
        if (columnEnds[i] <= item.event.startMin) {
          column = i;
          break;
        }
      }

      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(item.event.endMin);
      } else {
        columnEnds[column] = item.event.endMin;
      }

      placement.push({ index: item.index, column });
    }

    const columns = Math.max(1, columnEnds.length);
    const widthPct = 100 / columns;

    for (const item of placement) {
      positioned[item.index].leftPct = item.column * widthPct;
      positioned[item.index].widthPct = widthPct;
    }
  }

  return positioned;
}

function groupPlanEventsByDay(events: Record<string, string>[]): Map<string, Record<string, string>[]> {
  const grouped = new Map<string, Record<string, string>[]>();

  for (const event of events) {
    const eventStart = parseEventDate(event.start);
    if (!eventStart) continue;
    const key = formatYmd(eventStart);
    const list = grouped.get(key) ?? [];
    list.push(event);
    grouped.set(key, list);
  }

  return grouped;
}

function buildPlanDayColumns(
  grouped: Map<string, Record<string, string>[]>,
  rangeStart: Date,
  rangeEnd: Date,
): Pick<PlanResult, 'dayColumns' | 'hasAnyEventsInRange'> {
  const dayColumns: PlanResult['dayColumns'] = [];
  let hasAnyEventsInRange = false;

  for (let day = new Date(rangeStart); day <= rangeEnd; day = addDays(day, 1)) {
    const key = formatYmd(day);
    const dayEventsBase = (grouped.get(key) ?? []).map((event) => {
      const start = parseEventDate(event.start) as Date;
      const end = parseEventDate(event.end) as Date;
      const startMin = minutesFromMidnight(start);
      const endMin = Math.max(startMin + 15, minutesFromMidnight(end));
      const typeClass = eventTypeClass(event);

      return {
        startMin,
        endMin,
        topPx: Math.max(0, (startMin - 360) * 0.8),
        heightPx: Math.max(36, (endMin - startMin) * 0.8),
        leftPct: 0,
        widthPct: 100,
        title: firstNonEmpty(event.subject, event.title),
        room: firstNonEmpty(event.room, '-'),
        group: firstNonEmpty(event.groupName, event.tokName),
        startStr: formatHm(start),
        endStr: formatHm(end),
        tooltip: firstNonEmpty(event.description, event.subject, event.title),
        typeClass,
        typeLabel: eventTypeLabel(typeClass, event),
        subjectKey: firstNonEmpty(event.subject, event.title),
        teacher: firstNonEmpty(event.workerTitle, event.worker),
      };
    }).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.title.localeCompare(b.title, 'pl'));

    const dayEvents = layoutDayEvents(dayEventsBase);

    if (dayEvents.length > 0) hasAnyEventsInRange = true;
    dayColumns.push({ date: key, events: dayEvents });
  }

  return { dayColumns, hasAnyEventsInRange };
}

function buildPlanSubjectFilters(dayColumns: PlanResult['dayColumns']): PlanResult['subjectFilters'] {
  const subjectFilterMap = new Map<string, { key: string; label: string; count: number }>();

  for (const column of dayColumns) {
    for (const event of column.events) {
      const key = getPlanEventFilterKey(event);
      if (!key) continue;
      const label = getPlanEventFilterLabel(event);
      const existing = subjectFilterMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        subjectFilterMap.set(key, { key, label, count: 1 });
      }
    }
  }

  return [...subjectFilterMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'pl'));
}

function resolvePlanAlbum(session: SessionData): string {
  const directAlbum = firstNonEmpty(session.userId);
  if (/^(s?\d{4,6})$/i.test(directAlbum)) {
    return directAlbum;
  }
  throw new Error('Brak numeru albumu w danych USOS.');
}

function findPeriodByYear(
  periods: SessionPeriod[],
  key: string,
  year: number,
  field: 'start' | 'end' = 'start',
): SessionPeriod | null {
  const matches = periods
    .filter((period) => period.key === key && Number(period[field].slice(0, 4)) === year)
    .sort((a, b) => a.start.localeCompare(b.start));
  return matches[0] ?? null;
}

function resolveSemesterRange(currentDateText: string, sessionPeriods: SessionPeriod[]): { current: Date; rangeStart: Date; rangeEnd: Date } {
  const current = parseYmdOrToday(currentDateText);
  const month = current.getMonth();
  const isWinterSemester = month >= 8 || month <= 1;
  const academicYearStart = month >= 8 ? current.getFullYear() : current.getFullYear() - 1;
  const summerYear = academicYearStart + 1;

  const winterDefaults = {
    start: new Date(academicYearStart, 9, 1),
    end: new Date(summerYear, 2, 0),
  };
  const summerDefaults = {
    start: new Date(summerYear, 1, 15),
    end: new Date(summerYear, 6, 15),
  };

  let rangeStart = isWinterSemester ? winterDefaults.start : summerDefaults.start;
  let rangeEnd = isWinterSemester ? winterDefaults.end : summerDefaults.end;

  if (isWinterSemester) {
    const summerBreak = findPeriodByYear(sessionPeriods, 'wakacje_letnie', academicYearStart, 'end');
    if (summerBreak) {
      rangeStart = addDays(parseYmdOrToday(summerBreak.end), 1);
    }

    const winterSession = findPeriodByYear(sessionPeriods, 'sesja_zimowa', summerYear);
    if (winterSession) {
      rangeEnd = addDays(parseYmdOrToday(winterSession.start), -1);
    }
  } else {
    const winterBreak = findPeriodByYear(sessionPeriods, 'wakacje_zimowe', summerYear, 'end');
    if (winterBreak) {
      rangeStart = addDays(parseYmdOrToday(winterBreak.end), 1);
    } else {
      const winterSession = findPeriodByYear(sessionPeriods, 'sesja_zimowa', summerYear, 'end');
      if (winterSession) {
        rangeStart = addDays(parseYmdOrToday(winterSession.end), 1);
      }
    }

    const summerSession = findPeriodByYear(sessionPeriods, 'sesja_letnia', summerYear);
    if (summerSession) {
      rangeEnd = addDays(parseYmdOrToday(summerSession.start), -1);
    }
  }

  if (rangeEnd < rangeStart) {
    rangeStart = isWinterSemester ? winterDefaults.start : summerDefaults.start;
    rangeEnd = isWinterSemester ? winterDefaults.end : summerDefaults.end;
  }

  return {
    current,
    rangeStart: startOfDay(rangeStart),
    rangeEnd: startOfDay(rangeEnd),
  };
}

export async function fetchSessionPeriods(): Promise<SessionPeriod[]> {
  try {
    const response = await apiFetch(`${API_BASE}/proxy/calendar`);
    if (!response.ok) return [];
    const body = (await response.json()) as { periods?: SessionPeriod[] };
    return Array.isArray(body.periods) ? body.periods : [];
  } catch {
    return [];
  }
}

export interface PlanWindowData {
  rangeStart: string;
  rangeEnd: string;
  album: string;
  events: Record<string, string>[];
  sessionPeriods: SessionPeriod[];
  entriesTotal: number;
  daysWithData: string[];
}

export function buildPlanResultFromWindow(
  planWindow: PlanWindowData,
  payload: { viewMode: ViewMode; currentDate: string },
): PlanResult {
  const { current, rangeStart, rangeEnd, prev, next } = resolveViewRange(payload.viewMode, payload.currentDate);
  const grouped = groupPlanEventsByDay(planWindow.events);
  const { dayColumns, hasAnyEventsInRange } = buildPlanDayColumns(grouped, rangeStart, rangeEnd);

  const monthGrid: PlanResult['monthGrid'] = [];
  if (payload.viewMode === 'month') {
    const first = new Date(current.getFullYear(), current.getMonth(), 1);
    const dow = first.getDay() || 7;
    const gridStart = addDays(first, -(dow - 1));

    for (let row = 0; row < 6; row += 1) {
      const week = [];
      for (let col = 0; col < 7; col += 1) {
        const date = addDays(gridStart, row * 7 + col);
        const ymd = formatYmd(date);
        week.push({
          date: ymd,
          hasPlan: grouped.has(ymd),
          inCurrentMonth: date.getMonth() === current.getMonth(),
        });
      }
      monthGrid.push(week);
    }
  }

  return {
    viewMode: payload.viewMode,
    currentDate: formatYmd(current),
    rangeStart: formatYmd(rangeStart),
    rangeEnd: formatYmd(rangeEnd),
    dayColumns,
    hasAnyEventsInRange,
    monthGrid,
    subjectFilters: buildPlanSubjectFilters(dayColumns),
    prevDate: formatYmd(prev),
    nextDate: formatYmd(next),
    todayDate: formatYmd(startOfDay(new Date())),
    headerLabel: formatHeaderLabel(payload.viewMode, current, rangeStart, rangeEnd),
    sessionPeriods: planWindow.sessionPeriods,
    debug: {
      album: planWindow.album,
      entriesTotal: planWindow.entriesTotal,
      daysWithData: planWindow.daysWithData,
    },
  };
}

export async function fetchPlanWindow(
  session: SessionData,
  payload: {
    viewMode: ViewMode;
    currentDate: string;
    studyId: string | null;
    search: { category: string; query: string };
    prefetchDaysBefore?: number;
    prefetchDaysAfter?: number;
  },
): Promise<PlanWindowData> {
  const { rangeStart, rangeEnd } = resolveViewRange(payload.viewMode, payload.currentDate);
  const fetchStart = addDays(rangeStart, -(Math.max(0, payload.prefetchDaysBefore ?? 0)));
  const fetchEnd = addDays(rangeEnd, Math.max(0, payload.prefetchDaysAfter ?? 0));

  let urlParams: Record<string, string>;
  let album = '';

  if (firstNonEmpty(payload.search.query)) {
    album = resolveSearchAlbum(payload.search.category, payload.search.query);
    urlParams = {
      [mapSearchCategory(payload.search.category || 'number')]: firstNonEmpty(payload.search.query),
      start: toOffsetIso(new Date(fetchStart.getFullYear(), fetchStart.getMonth(), fetchStart.getDate(), 0, 0, 0)),
      end: toOffsetIso(new Date(fetchEnd.getFullYear(), fetchEnd.getMonth(), fetchEnd.getDate(), 23, 59, 59)),
    };
  } else {
    album = resolvePlanAlbum(session);
    urlParams = {
      number: album,
      start: toOffsetIso(new Date(fetchStart.getFullYear(), fetchStart.getMonth(), fetchStart.getDate(), 0, 0, 0)),
      end: toOffsetIso(new Date(fetchEnd.getFullYear(), fetchEnd.getMonth(), fetchEnd.getDate(), 23, 59, 59)),
    };
  }

  const [rawEvents, sessionPeriods] = await Promise.all([
    proxyPlanStudent(urlParams),
    fetchSessionPeriods(),
  ]);
  const events = rawEvents.map(parsePlanEventRow).filter((event): event is Record<string, string> => Boolean(event));
  const grouped = groupPlanEventsByDay(events);

  return {
    rangeStart: formatYmd(fetchStart),
    rangeEnd: formatYmd(fetchEnd),
    album,
    events,
    sessionPeriods,
    entriesTotal: events.length,
    daysWithData: [...grouped.keys()].sort(),
  };
}

export async function fetchPlan(
  session: SessionData,
  payload: { viewMode: ViewMode; currentDate: string; studyId: string | null; search: { category: string; query: string } },
): Promise<PlanResult> {
  const planWindow = await fetchPlanWindow(session, payload);
  return buildPlanResultFromWindow(planWindow, {
    viewMode: payload.viewMode,
    currentDate: payload.currentDate,
  });
}

export async function fetchPlanSemesterExport(
  session: SessionData,
  payload: { currentDate: string; studyId: string | null; search: { category: string; query: string } },
): Promise<PlanResult> {
  const sessionPeriods = await fetchSessionPeriods();
  const { current, rangeStart, rangeEnd } = resolveSemesterRange(payload.currentDate, sessionPeriods);

  let album = '';
  let urlParams: Record<string, string>;

  if (firstNonEmpty(payload.search.query)) {
    album = resolveSearchAlbum(payload.search.category, payload.search.query);
    urlParams = {
      [mapSearchCategory(payload.search.category || 'number')]: firstNonEmpty(payload.search.query),
      start: toOffsetIso(new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate(), 0, 0, 0)),
      end: toOffsetIso(new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59)),
    };
  } else {
    album = resolvePlanAlbum(session);
    urlParams = {
      number: album,
      start: toOffsetIso(new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate(), 0, 0, 0)),
      end: toOffsetIso(new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59)),
    };
  }

  const rawEvents = await proxyPlanStudent(urlParams);
  const events = rawEvents.map(parsePlanEventRow).filter((event): event is Record<string, string> => Boolean(event));
  const grouped = groupPlanEventsByDay(events);
  const { dayColumns, hasAnyEventsInRange } = buildPlanDayColumns(grouped, rangeStart, rangeEnd);

  return {
    viewMode: 'month',
    currentDate: formatYmd(current),
    rangeStart: formatYmd(rangeStart),
    rangeEnd: formatYmd(rangeEnd),
    dayColumns,
    hasAnyEventsInRange,
    monthGrid: [],
    subjectFilters: buildPlanSubjectFilters(dayColumns),
    prevDate: formatYmd(addDays(current, -1)),
    nextDate: formatYmd(addDays(current, 1)),
    todayDate: formatYmd(startOfDay(new Date())),
    headerLabel: 'Semestr',
    sessionPeriods,
    debug: {
      album,
      entriesTotal: events.length,
      daysWithData: [...grouped.keys()].sort(),
    },
  };
}

export async function fetchPlanSuggestions(kind: string, query: string): Promise<string[]> {
  const response = await apiFetch(`${API_BASE}/proxy/plan-suggest?kind=${encodeURIComponent(kind)}&query=${encodeURIComponent(query)}`);
  const body = (await response.json().catch(() => ({}))) as { data?: Array<{ item: string }> };
  const rows = ensureArray<{ item: string }>(body.data);
  return rows.map((row) => firstNonEmpty(row.item)).filter(Boolean);
}
