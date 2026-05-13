import type {
  CalendarEvent,
  ElsCard,
  FinanceRecord,
  Grade,
  NewsItem,
  PlanResult,
  SessionData,
  SessionPeriod,
  Semester,
  Study,
  StudyDetails,
  StudyHistoryItem,
  UsosSessionData,
  ViewMode,
} from '../types';
import { getPlanEventFilterKey, getPlanEventFilterLabel } from '../planFilters';
import { loadOrCreateDeviceId } from './storage';

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? '/api' : `${import.meta.env.BASE_URL}api`);
const CARR = [...'23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'];
const CARR2 = [...'vwxyz23456789ABCDEFGHJKkmnopqrstuvwxyzabcdefghijWXYZLMNPQRSTUV'];
const DEVICE_ID = loadOrCreateDeviceId();

type UsosLocalizedValue = string | { pl?: string; en?: string };

interface UsosProgramme {
  id?: string | number;
  description?: UsosLocalizedValue;
  mode_of_studies?: string | number;
  level_of_studies?: UsosLocalizedValue;
}

interface UsosProgrammeRow {
  programme?: UsosProgramme | null;
  status?: string;
}

interface UsosCourseEdition {
  course_id?: string;
  course_name?: UsosLocalizedValue;
}

interface UsosCoursesUserResponse {
  course_editions?: Record<string, UsosCourseEdition[]>;
  terms?: Array<{ id?: string }>;
}

interface UsosTermDetails {
  id?: string;
  name?: UsosLocalizedValue;
  is_active?: boolean;
}

interface UsosGradeEntry {
  value_symbol?: string | number;
  date_modified?: string;
  date_acquisition?: string;
}

interface UsosCourseGrades {
  course_grades?: UsosGradeEntry[];
  course_units_grades?: Record<string, UsosGradeEntry[]>;
}

interface UsosFaculty {
  id?: string | number;
  name?: UsosLocalizedValue;
}

interface UsosCardRow {
  id?: string | number;
  expiration_date?: string;
  is_active?: boolean;
}

interface UsosCalendarEventRow {
  id?: string | number;
  name?: UsosLocalizedValue;
  start_date?: string;
  end_date?: string;
  type?: string;
  is_day_off?: boolean;
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

const SESSION_EXPIRED_MESSAGE = 'Sesja wygasła, zaloguj się ponownie';

export class SessionExpiredError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export function isSessionExpiredError(error: unknown): error is SessionExpiredError {
  return error instanceof SessionExpiredError;
}

function rethrowIfSessionExpired(error: unknown): void {
  if (isSessionExpiredError(error)) {
    throw error;
  }
}

function getMzutStatus(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const payload = value as Record<string, unknown>;
  return firstNonEmpty(payload.logInStatus, payload.loginInStatus).toUpperCase();
}

function hasMzutSessionExpired(value: unknown): boolean {
  const status = getMzutStatus(value);
  if (!status || status === 'OK') return false;
  return status.includes('TOKEN') || status.includes('UNAUTHORIZED') || status.includes('AUTH');
}

function hasHttpAuthError(status: number, message: string): boolean {
  if (status === 401 || status === 403) return true;
  const normalized = message.toLowerCase();
  return normalized.includes('unauthorized')
    || normalized.includes('forbidden')
    || normalized.includes('oauth_problem=token_rejected')
    || normalized.includes('token rejected');
}

function ensureArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  return [value as T];
}

function normalizeLoginIdentifier(rawLogin: string): string {
  const trimmed = rawLogin.trim();
  const at = trimmed.indexOf('@');
  return at >= 0 ? trimmed.slice(0, at).trim() : trimmed;
}

function fixImageUrls(html: string): string {
  return html.replace(/<img([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (_match, before, src, after) => {
    let fixedSrc = src;
    if (!fixedSrc.startsWith('http') && !fixedSrc.startsWith('data:')) {
      if (fixedSrc.startsWith('/')) {
        fixedSrc = `https://www.zut.edu.pl${fixedSrc}`;
      } else {
        fixedSrc = `https://www.zut.edu.pl/${fixedSrc}`;
      }
    }
    return `<img${before}src="${fixedSrc}"${after}>`;
  });
}

function randomString(length: number, alphabet: string[]): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

function createApiRequestInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers ?? {});
  headers.set('X-ZUTnik-Device-Id', DEVICE_ID);
  return { ...init, headers };
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, createApiRequestInit(init));
}

function generateToken(login: string, password: string): string {
  const base = randomString(32, CARR);
  if (!password) return base;

  const now = new Date();
  const dayOfMonth = now.getDate();
  const dayOfWeek = now.getDay() + 1;
  const dayOfWeekInMonth = Math.floor((dayOfMonth - 1) / 7) + 1;
  const len = `${login}${password}`.length;

  let indexes = [len - 1, len - 5, len - 8, dayOfMonth, dayOfWeek, dayOfWeekInMonth];
  let alphabet = CARR;

  if (indexes.reduce((acc, n) => acc + n, 0) % 2 === 0) {
    indexes = [dayOfMonth, len + 3, len + 9, dayOfWeek, len, dayOfWeekInMonth];
    alphabet = CARR2;
  }

  return [...base]
    .map((ch, index) => {
      if (indexes.includes(index) && index >= 0 && index <= 32 && index < alphabet.length) {
        return alphabet[index];
      }
      return ch;
    })
    .join('');
}

async function proxyMzut<T = Record<string, unknown>>(fn: string, params: Record<string, string>): Promise<T> {
  const response = await apiFetch(`${API_BASE}/proxy/mzut`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn, params }),
  });

  const body = (await response.json().catch(() => ({}))) as { data: T; error: string };
  const errorMessage = body.error || `ZUT proxy HTTP ${response.status}`;
  if (!response.ok) {
    if (hasHttpAuthError(response.status, errorMessage)) {
      throw new SessionExpiredError();
    }
    throw new Error(errorMessage);
  }
  if (hasMzutSessionExpired(body.data)) {
    throw new SessionExpiredError();
  }
  return body.data ?? ({} as T);
}

async function proxyPlanStudent(query: Record<string, string>): Promise<Record<string, unknown>[]> {
  const url = new URL(`${API_BASE}/proxy/plan-student`, window.location.origin);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const response = await apiFetch(`${url.pathname}${url.search}`);
  const body = (await response.json().catch(() => ({}))) as { data: Record<string, unknown>[]; error: string };
  if (!response.ok) {
    throw new Error(body.error || `Plan proxy HTTP ${response.status}`);
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
    throw new Error(body.error || `Plan filters HTTP ${response.status}`);
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
    throw new Error(body.error || `Plan filters HTTP ${response.status}`);
  }

  return normalizePlanHiddenSubjectKeys(body.hiddenSubjectKeys);
}

async function proxyRssXml(): Promise<string> {
  const response = await apiFetch(`${API_BASE}/proxy/rss`);
  const body = (await response.json().catch(() => ({}))) as { xml: string; error: string };
  if (!response.ok) {
    throw new Error(body.error || `RSS proxy HTTP ${response.status}`);
  }
  return body.xml || '';
}

async function proxyUsos<T = unknown>(
  session: SessionData,
  endpoint: string,
  params: Record<string, string> = {},
): Promise<T> {
  if (!session.usos) throw new Error('Brak aktywnej sesji USOS.');

  const response = await apiFetch(`${API_BASE}/usos/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint,
      token: session.usos.accessToken,
      secret: session.usos.accessTokenSecret,
      params,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as { error: string } & T;
  if (!response.ok) {
    const errorMessage = body.error || `USOS API error: ${response.status}`;
    if (hasHttpAuthError(response.status, errorMessage)) {
      throw new SessionExpiredError();
    }
    throw new Error(errorMessage);
  }
  return body as T;
}

function extractLocalized<T extends object>(obj: T | null | undefined, key: string): string {
  if (!obj || typeof obj !== 'object') return '';
  const source = obj as Record<string, unknown>;
  const val = source[key];
  if (val && typeof val === 'object') {
    return firstNonEmpty(
      (val as Record<string, unknown>).pl,
      (val as Record<string, unknown>).en,
    );
  }
  return String(val ?? '');
}

function normalizeStudyId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseFlexibleDouble(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseEcts(row: Record<string, unknown>): number {
  const direct = parseFlexibleDouble(row.ects);
  if (direct > 0) return direct;
  for (const key of ['ectsO', 'ECTS', 'punktyEcts', 'punkty_ects', 'punktyEctsO']) {
    const value = parseFlexibleDouble(row[key]);
    if (value > 0) return value;
  }
  return 0;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  const normalized = firstNonEmpty(value);
  return normalized || null;
}

function normalizeLegacyFinanceTitle(value: unknown): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return '';
  const lowered = normalized.toLocaleLowerCase('pl-PL');
  return lowered ? `${lowered.charAt(0).toLocaleUpperCase('pl-PL')}${lowered.slice(1)}` : '';
}

function extractLocalizedOrString(obj: Record<string, unknown>, key: string): string {
  const localized = obj[key];
  if (localized && typeof localized === 'object') {
    return firstNonEmpty(
      (localized as Record<string, unknown>).pl,
      (localized as Record<string, unknown>).en,
    );
  }
  return firstNonEmpty(obj[key]);
}

function formatOutstandingBalance(amountText: string | null): string | null {
  if (!amountText) return null;
  return amountText.startsWith('-') ? amountText : `-${amountText}`;
}

function isUsosPaymentPaid(row: Record<string, unknown>): boolean {
  const statusValue = row.status;
  const statusSymbol = statusValue && typeof statusValue === 'object'
    ? firstNonEmpty((statusValue as Record<string, unknown>).symbol)
    : firstNonEmpty(statusValue);

  return statusSymbol.toLowerCase() === 'paid'
    || statusSymbol === '1'
    || row.is_paid === true;
}

export async function login(loginValue: string, password: string): Promise<SessionData> {
  const login = normalizeLoginIdentifier(loginValue);
  const cleanPassword = password.trim();
  if (!login || !cleanPassword) {
    throw new Error('Wpisz login i hasło.');
  }

  const token = generateToken(login, cleanPassword);
  const tokenJpg = generateToken(login, '');

  const payload = await proxyMzut<Record<string, unknown>>('getAuthorization', {
    login,
    password: cleanPassword,
    token,
    tokenJpg,
  });

  const status = firstNonEmpty(payload.logInStatus, payload.loginInStatus).toUpperCase();
  if (status !== 'OK') {
    if (status === 'SYSTEM ERROR') throw new Error('Błąd systemu ZUT.');
    throw new Error('Niepoprawny login lub hasło.');
  }

  const userId = firstNonEmpty(payload.login, login);
  const username = firstNonEmpty(`${firstNonEmpty(payload.pierwszeImie)} ${firstNonEmpty(payload.nazwisko)}`.trim(), userId);
  const authKey = firstNonEmpty(payload.token, token);
  const tokenJpgFromApi = firstNonEmpty(payload.tokenJpg, tokenJpg);

  return {
    userId,
    username,
    authKey,
    imageUrl: `${API_BASE}/proxy/image?userId=${encodeURIComponent(userId)}&tokenJpg=${encodeURIComponent(tokenJpgFromApi)}`,
    tokenJpg: tokenJpgFromApi,
    activeStudyId: null,
  };
}

export async function fetchUsosRequestToken(callbackUrl: string): Promise<{ oauth_token: string; oauth_token_secret: string }> {
  const scopes = 'studies|grades|personal|photo|email|mobile_numbers|payments|cards';
  const response = await apiFetch(`${API_BASE}/usos/request-token?callbackUrl=${encodeURIComponent(callbackUrl)}&scopes=${scopes}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Błąd pobierania tokenu USOS.');
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
  if (!response.ok) throw new Error(body.error || 'Błąd logowania USOS.');

  const usos: UsosSessionData = {
    accessToken: body.oauth_token,
    accessTokenSecret: body.oauth_token_secret,
  };

  // Once logged into USOS, we still need the legacy ZUT session to fetch the plan (which uses album number).
  // Strategy: Try to find student in USOS, get their details.
  const sessionStub: SessionData = {
    userId: 'usos_user',
    username: 'Użytkownik USOS',
    authKey: '',
    imageUrl: '',
    activeStudyId: null,
    usos,
  };

  const user = await proxyUsos<{ first_name: string; last_name: string; id: string; student_number?: string; photo_urls?: Record<string, string> }>(sessionStub, 'services/users/user', {
    fields: 'id|first_name|last_name|student_number|photo_urls',
  });

  const rawPhoto = user.photo_urls?.['100x100'] || user.photo_urls?.['50x50'] || '';

  return {
    ...sessionStub,
    userId: user.student_number || user.id || 'usos_user',
    username: `${user.first_name} ${user.last_name}`.trim(),
    imageUrl: rawPhoto ? `${API_BASE}/usos/image?url=${encodeURIComponent(rawPhoto)}` : '',
  };
}

export async function validateSession(session: SessionData): Promise<void> {
  const checks: Promise<unknown>[] = [];

  if (session.usos) {
    checks.push(proxyUsos<{ id?: string }>(session, 'services/users/user', {
      fields: 'id',
    }));
  }

  if (!checks.length) {
    if (!session.authKey) {
      throw new SessionExpiredError();
    }
    return;
  }

  await Promise.all(checks);
}

export async function fetchStudies(session: SessionData): Promise<Study[]> {
  const payload = await proxyMzut<Record<string, unknown>>('getMenuStudent', {
    login: session.userId,
    token: session.authKey,
  });

  return ensureArray<Record<string, unknown>>(payload.Menu)
    .map((row) => {
      const przynaleznoscId = normalizeStudyId(row.przynaleznoscId);
      const nazwa = firstNonEmpty(row.nazwa);
      const poziom = firstNonEmpty(row.poziom);
      const label = poziom ? `${nazwa} (${poziom})` : nazwa;
      return {
        przynaleznoscId: przynaleznoscId ?? '',
        label: label || przynaleznoscId || 'Kierunek',
      };
    })
    .filter((study) => study.przynaleznoscId);
}

export async function fetchSemesters(session: SessionData, studyId: string | null): Promise<Semester[]> {
  const resolvedStudyId = studyId || session.activeStudyId;
  if (!resolvedStudyId) return [];

  const payload = await proxyMzut<Record<string, unknown>>('getStudies', {
    login: session.userId,
    token: session.authKey,
    przynaleznoscId: resolvedStudyId,
    oceny: 'true',
  });

  return ensureArray<Record<string, unknown>>(payload.Przebieg)
    .map((row) => ({
      listaSemestrowId: firstNonEmpty(row.listaSemestrowId),
      nrSemestru: firstNonEmpty(row.nrSemestru),
      pora: firstNonEmpty(row.pora),
      rokAkademicki: firstNonEmpty(row.rokAkademicki),
      status: firstNonEmpty(row.status, row.statusO),
    }))
    .filter((semester) => semester.listaSemestrowId);
}

export async function fetchGrades(session: SessionData, semesterId: string): Promise<Grade[]> {
  if (!semesterId) return [];
  const payload = await proxyMzut<Record<string, unknown>>('getGrade', {
    login: session.userId,
    token: session.authKey,
    listaSemestrowId: semesterId,
  });

  return ensureArray<Record<string, unknown>>(payload.Ocena).map((row) => {
    const subject = firstNonEmpty(row.przedmiot, row.przedmiotO);
    const form = firstNonEmpty(row.formaZajec, row.formaZajecO);
    const term = firstNonEmpty(row.termin, row.terminO);
    const date = firstNonEmpty(row.data);

    return {
      subjectName: subject,
      grade: firstNonEmpty(row.ocena),
      weight: parseEcts(row),
      type: form,
      teacher: firstNonEmpty(row.pracownik),
      date: firstNonEmpty(`${term} ${date}`.trim(), date, term),
    };
  });
}

export async function fetchFinance(session: SessionData, studyId: string | null): Promise<FinanceRecord[]> {
  const resolvedStudyId = studyId || session.activeStudyId;
  const preferPolishLabels = typeof navigator === 'undefined'
    ? true
    : navigator.language.toLowerCase().startsWith('pl');

  if (session.usos) {
    const payload = await proxyUsos<Array<Record<string, unknown>>>(session, 'services/payments/user_payments');

    return ensureArray<Record<string, unknown>>(payload).map((row) => {
      const title = firstNonEmpty(
        extractLocalizedOrString(row, 'name'),
        extractLocalizedOrString(row, 'title'),
        row.id,
      );
      const amountText = normalizeOptionalText(row.amount);
      const amountValue = parseFlexibleDouble(amountText);
      const paid = isUsosPaymentPaid(row);

      return {
        title,
        amountText,
        paidText: paid ? amountText : '0',
        dueDateText: normalizeOptionalText(row.due_date),
        paidDateText: null,
        balanceText: paid ? '0' : formatOutstandingBalance(amountText),
        accountText: null,
        amountValue,
        paidValue: paid ? amountValue : 0,
        balanceValue: paid ? 0 : -amountValue,
      };
    });
  }

  if (!resolvedStudyId) return [];

  const payload = await proxyMzut<Record<string, unknown>>('getPayment', {
    login: session.userId,
    token: session.authKey,
    przynaleznoscId: resolvedStudyId,
  });

  return ensureArray<Record<string, unknown>>(payload.Oplata).map((row) => {
    const amountText = normalizeOptionalText(row.naleznosc);
    const paidText = normalizeOptionalText(row.wplata);
    const balanceText = normalizeOptionalText(row.saldo);
    const titleSource = preferPolishLabels
      ? firstNonEmpty(row.nazwa, row.nazwaO)
      : firstNonEmpty(row.nazwaO, row.nazwa);

    return {
      title: normalizeLegacyFinanceTitle(titleSource),
      amountText,
      paidText,
      dueDateText: normalizeOptionalText(row.dataPlatnosci),
      paidDateText: normalizeOptionalText(row.dataWplaty),
      balanceText,
      accountText: normalizeOptionalText(row.konto),
      amountValue: parseFlexibleDouble(amountText),
      paidValue: parseFlexibleDouble(paidText),
      balanceValue: parseFlexibleDouble(balanceText),
    };
  });
}

export async function fetchCombinedStudies(session: SessionData): Promise<Study[]> {
  if (session.usos) {
    const payload = await proxyUsos<UsosProgrammeRow[]>(session, 'services/progs/student', {
      fields: 'programme[id|description|mode_of_studies|level_of_studies]|status',
      active_only: 'false',
    });

    return payload
      .map((row) => {
        const prog = row.programme;
        if (!prog) return null;
        const id = String(prog.id || '');
        let label = extractLocalized(prog, 'description') || id;
        const mode = Number(prog.mode_of_studies);
        if (mode > 0) label += ` (${mode === 1 ? 'stacj.' : 'niestacj.'})`;
        return { przynaleznoscId: id, label };
      })
      .filter((s): s is Study => Boolean(s?.przynaleznoscId));
  }
  return fetchStudies(session);
}

export async function fetchCombinedSemesters(session: SessionData, studyId: string | null): Promise<Semester[]> {
  if (session.usos) {
    const ceResp = await proxyUsos<UsosCoursesUserResponse>(session, 'services/courses/user', {
      active_terms_only: 'false',
      fields: 'course_editions',
    });

    const termIds = Object.keys(ceResp.course_editions || {}).sort();
    if (termIds.length === 0) return [];

    const tDetails = await proxyUsos<Record<string, UsosTermDetails>>(session, 'services/terms/terms', {
      term_ids: termIds.join('|'),
      fields: 'id|name|is_active',
    });

    return termIds.map((tid) => {
      const tObj = tDetails[tid];
      return {
        listaSemestrowId: tid,
        nrSemestru: tid,
        pora: tid.endsWith('Z') ? 'Zimowy' : tid.endsWith('L') ? 'Letni' : '',
        rokAkademicki: tObj ? extractLocalized(tObj, 'name') : tid,
        status: tObj?.is_active ? 'Aktywny' : 'Zakończony',
      };
    });
  }
  return fetchSemesters(session, studyId);
}

export async function fetchCombinedGrades(session: SessionData, semesterId: string): Promise<Grade[]> {
  if (session.usos) {
    const [courseNamesResp, courseEctsResp, gradesResp] = await Promise.all([
      proxyUsos<UsosCoursesUserResponse>(session, 'services/courses/user', { active_terms_only: 'false' }),
      proxyUsos<Record<string, Record<string, unknown>>>(session, 'services/courses/user_ects_points'),
      proxyUsos<Record<string, Record<string, UsosCourseGrades>>>(session, 'services/grades/terms2', {
        term_ids: semesterId,
        fields: 'value_symbol|passes|value_description|counts_into_average|date_modified|date_acquisition|comment',
      }),
    ]);

    const namesMap: Record<string, string> = {};
    const editions = courseNamesResp.course_editions?.[semesterId] || [];
    for (const c of editions) {
      if (c.course_id) namesMap[c.course_id] = extractLocalized(c, 'course_name');
    }

    const ectsMap = courseEctsResp[semesterId] || {};
    const termData = gradesResp[semesterId] || {};
    const results: Grade[] = [];

    for (const [courseId, courseData] of Object.entries(termData)) {
      const name = namesMap[courseId] || courseId;
      const ects = parseFlexibleDouble(ectsMap[courseId]);
      let hasAny = false;

      const addUsosGrade = (gObj: UsosGradeEntry | null | undefined, type: string) => {
        if (!gObj) return;
        const dateRaw = gObj.date_acquisition || gObj.date_modified || '';
        results.push({
          subjectName: name,
          grade: String(gObj.value_symbol || ''),
          weight: ects,
          type,
          teacher: '',
          date: dateRaw.split(' ')[0],
        });
        hasAny = true;
      };

      for (const g of courseData.course_grades ?? []) addUsosGrade(g, 'Ocena końcowa');
      for (const list of Object.values(courseData.course_units_grades ?? {})) {
        for (const g of list) addUsosGrade(g, 'Zaliczenie');
      }

      if (!hasAny) {
        results.push({ subjectName: name, grade: '', weight: ects, type: '', teacher: '', date: '' });
      }
    }
    return results;
  }
  return fetchGrades(session, semesterId);
}

export async function fetchInfo(
  session: SessionData,
  studyId: string | null,
): Promise<{ details: StudyDetails | null; history: StudyHistoryItem[]; els?: ElsCard | null; calendarEvents?: CalendarEvent[] }> {
  const resolvedStudyId = studyId || session.activeStudyId;
  if (!resolvedStudyId) {
    return { details: null, history: [], els: null, calendarEvents: [] };
  }

  if (session.usos) {
    try {
      const details: StudyDetails = {
        album: session.userId || '',
        wydzial: '',
        kierunek: '',
        forma: '',
        poziom: '',
        specjalnosc: '',
        specjalizacja: '',
        status: '',
        rokAkademicki: '',
        semestrLabel: '',
      };

      const progs = await proxyUsos<UsosProgrammeRow[]>(session, 'services/progs/student', {
        fields: 'programme[id|description|mode_of_studies|level_of_studies]|status',
        active_only: 'false',
      });

      let targetProg = progs.find(p => String(p.programme?.id) === resolvedStudyId);
      if (!targetProg && progs.length > 0) targetProg = progs[progs.length - 1];

      let facultyIdStr = '';
      if (targetProg && targetProg.programme) {
        const prog = targetProg.programme;
        const pid = String(prog.id || '');

        details.kierunek = extractLocalized(prog, 'description') || pid;

        try {
          const facultyObj = await proxyUsos<{ faculty?: UsosFaculty }>(session, 'services/progs/programme', {
            programme_id: pid,
            fields: 'faculty[id|name]',
          });
          if (facultyObj?.faculty) {
            details.wydzial = extractLocalized(facultyObj.faculty, 'name');
            facultyIdStr = String(facultyObj.faculty.id || '');
          }
        } catch (e) {
          rethrowIfSessionExpired(e);
          // Ignore faculty fetch errors
        }

        const mode = Number(prog.mode_of_studies);
        details.forma = mode === 1 ? 'Stacjonarne' : 'Niestacjonarne';
        details.poziom = extractLocalized(prog, 'level_of_studies');

        const statusRaw = targetProg.status || '';
        switch (statusRaw) {
          case "active": details.status = "Aktywny"; break;
          case "cancelled": details.status = "Anulowany"; break;
          case "graduated_diploma": details.status = "Absolwent"; break;
          case "graduated_end_of_study":
          case "graduated_before_diploma": details.status = "Absolwent (ukończone)"; break;
          default: details.status = statusRaw;
        }
      }

      // Fetch active term for rok/semestr
      try {
        const ceResp = await proxyUsos<{ course_editions: Record<string, unknown> }>(session, 'services/courses/user', {
          active_terms_only: 'true',
          fields: 'course_editions',
        });
        const editions = Object.keys(ceResp.course_editions || {});
        if (editions.length > 0) {
          const tid = editions[0];
          details.semestrLabel = tid.endsWith('Z') ? 'zimowy' : (tid.endsWith('L') ? 'letni' : '');
          if (tid.length >= 7) {
            details.rokAkademicki = `${tid.substring(0, 4)}/20${tid.substring(5, 7)}`;
          } else {
            details.rokAkademicki = tid.replace(/[ZL]$/, '');
          }
        }
      } catch (e) {
        rethrowIfSessionExpired(e);
      }

      // Fetch history terms
      const historyItems: StudyHistoryItem[] = [];
      try {
        const termsResp = await proxyUsos<{ terms: Array<{ id?: string }> }>(session, 'services/courses/user', {
          fields: 'terms',
        });
        if (termsResp.terms) {
          for (const term of termsResp.terms) {
            if (term.id) {
              const pora = term.id.endsWith('Z') ? 'Zimowy' : (term.id.endsWith('L') ? 'Letni' : '');
              historyItems.push({
                label: `${term.id} ${pora}`.trim(),
                status: 'Zaliczone/Aktywne',
              });
            }
          }
          historyItems.sort((a, b) => b.label.localeCompare(a.label));
        }
      } catch (e) {
        rethrowIfSessionExpired(e);
      }
      // Fetch ELS cards
      let els: ElsCard | null = null;
      try {
        const cards = await proxyUsos<UsosCardRow[]>(session, 'services/cards/user', {
          fields: 'id|expiration_date|is_active',
        });
        if (Array.isArray(cards) && cards.length > 0) {
          const card = cards[0];
          els = {
            id: String(card.id),
            expirationDate: String(card.expiration_date || ''),
            isActive: !!card.is_active,
          };
        }
      } catch (e) {
        rethrowIfSessionExpired(e);
        console.warn("Failed to fetch cards:", e);
      }

      // Fetch upcoming calendar events (next 30 days)
      let calendarEvents: CalendarEvent[] = [];
      try {
        const today = new Date();
        const nextMonth = new Date(today);
        nextMonth.setMonth(today.getMonth() + 1);
        const formatD = (d: Date) => d.toISOString().split('T')[0];

        const calParams: Record<string, string> = {
          start_date: formatD(today),
          end_date: formatD(nextMonth),
          fields: 'id|name|start_date|end_date|type|is_day_off',
        };
        if (facultyIdStr) calParams.faculty_id = facultyIdStr;

        const cals = await proxyUsos<UsosCalendarEventRow[]>(session, 'services/calendar/search', calParams);

        if (Array.isArray(cals)) {
          calendarEvents = cals.map(c => ({
            id: String(c.id),
            name: extractLocalized(c, 'name'),
            startDate: String(c.start_date || ''),
            endDate: String(c.end_date || ''),
            type: String(c.type || ''),
            isDayOff: !!c.is_day_off,
          }));
        }
      } catch (e) {
        rethrowIfSessionExpired(e);
        console.warn("Failed to fetch calendar:", e);
      }

      return { details, history: historyItems, els, calendarEvents };
    } catch (e) {
      rethrowIfSessionExpired(e);
      console.warn("Failed to fetch info from USOS", e);
      return { details: null, history: [], els: null, calendarEvents: [] };
    }
  }

  const [study, studies] = await Promise.all([
    proxyMzut<Record<string, unknown>>('getStudy', {
      login: session.userId,
      token: session.authKey,
      przynaleznoscId: resolvedStudyId,
    }),
    proxyMzut<Record<string, unknown>>('getStudies', {
      login: session.userId,
      token: session.authKey,
      przynaleznoscId: resolvedStudyId,
      oceny: 'true',
    }),
  ]);

  const details: StudyDetails = {
    album: firstNonEmpty(study.album),
    wydzial: firstNonEmpty(study.wydzial, study.wydzialAng),
    kierunek: firstNonEmpty(study.kierunek, study.kierunekAng),
    forma: firstNonEmpty(study.forma, study.formaAng),
    poziom: firstNonEmpty(study.poziom, study.poziomAng),
    specjalnosc: firstNonEmpty(study.specjalnosc, study.specjalnoscO),
    specjalizacja: firstNonEmpty(study.specjalizacja, study.specjalizacjaO),
    status: firstNonEmpty(study.status, study.statusAng),
    rokAkademicki: firstNonEmpty(study.rokAkademicki),
    semestrLabel: firstNonEmpty(`${firstNonEmpty(study.nrSemestru)} ${firstNonEmpty(study.pora)}`.trim()),
  };

  const history = ensureArray<Record<string, unknown>>(studies.Przebieg).map((row) => ({
    label: `${firstNonEmpty(row.nrSemestru)} ${firstNonEmpty(row.pora)} - ${firstNonEmpty(row.rokAkademicki)}`.trim(),
    status: firstNonEmpty(row.status, row.statusO),
  }));

  return { details, history, els: null, calendarEvents: [] };
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

async function resolvePlanAlbum(session: SessionData, resolvedStudyId: string): Promise<string> {
  const directAlbum = firstNonEmpty(session.userId);
  if (/^(s?\d{4,6})$/i.test(directAlbum)) {
    return directAlbum;
  }

  let album = '';
  if (session.authKey) {
    try {
      const study = await proxyMzut<Record<string, unknown>>('getStudy', {
        login: session.userId,
        token: session.authKey,
        przynaleznoscId: resolvedStudyId,
      });
      album = firstNonEmpty(study.album);
    } catch (error) {
      rethrowIfSessionExpired(error);
      console.warn('Failed to fetch album from getStudy', error);
    }
  }

  if (!album) throw new Error('Brak numeru albumu.');
  return album;
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
    const resolvedStudyId = payload.studyId || session.activeStudyId;
    if (!resolvedStudyId) {
      return {
        rangeStart: formatYmd(fetchStart),
        rangeEnd: formatYmd(fetchEnd),
        album: '',
        events: [],
        sessionPeriods: [],
        entriesTotal: 0,
        daysWithData: [],
      };
    }

    album = await resolvePlanAlbum(session, resolvedStudyId);

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
    const resolvedStudyId = payload.studyId || session.activeStudyId;
    if (!resolvedStudyId) {
      throw new Error('Brak aktywnego toku studiów.');
    }

    album = await resolvePlanAlbum(session, resolvedStudyId);
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
  const body = (await response.json().catch(() => ({}))) as { data: Array<{ item: string }> };
  const rows = ensureArray<{ item: string }>(body.data);
  return rows.map((row) => firstNonEmpty(row.item)).filter(Boolean);
}

export async function fetchNews(): Promise<NewsItem[]> {
  const xml = await proxyRssXml();
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

    const descriptionText = String(descriptionHtml)
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

    const imgMatch = contentHtml.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    let thumbRaw = imgMatch?.[1] ?? '';

    // Convert relative URLs to absolute for thumbnail
    if (thumbRaw && !thumbRaw.startsWith('http') && !thumbRaw.startsWith('data:')) {
      if (thumbRaw.startsWith('/')) {
        thumbRaw = `https://www.zut.edu.pl${thumbRaw}`;
      } else {
        thumbRaw = `https://www.zut.edu.pl/${thumbRaw}`;
      }
    }

    const thumbUrl = thumbRaw;

    const parsedDate = new Date(pubDateRaw);
    const date = Number.isFinite(parsedDate.getTime())
      ? new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsedDate)
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
