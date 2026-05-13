import type {
  CalendarEvent,
  ElsCard,
  FinanceSnapshot,
  Grade,
  NewsItem,
  PlanResult,
  Semester,
  SessionData,
  Study,
  StudyDetails,
  StudyHistoryItem,
} from '../types';

const SESSION_KEY = 'zutnik_pwa_session';
const SETTINGS_KEY = 'zutnik_pwa_settings';
const PLAN_FILTERS_KEY = 'zutnik_pwa_plan_hidden_subjects';
const DEVICE_ID_KEY = 'zutnik_pwa_device_id';

const LEGACY_SESSION_KEY = 'mzutv2_pwa_session';
const LEGACY_SETTINGS_KEY = 'mzutv2_pwa_settings';
const LEGACY_PLAN_FILTERS_KEY = 'mzutv2_pwa_plan_hidden_subjects';
const LEGACY_DEVICE_ID_KEY = 'mzutv2_pwa_device_id';

export interface AppSettings {
  language: 'pl' | 'en';
  notificationsEnabled: boolean;
  refreshMinutes: 30 | 60 | 120;
  compactPlan: boolean;
  gradesGrouping: boolean;
}

const defaultSettings: AppSettings = {
  language: 'pl',
  notificationsEnabled: true,
  refreshMinutes: 30,
  compactPlan: false,
  gradesGrouping: true,
};

export function loadSession(): SessionData | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY) ?? window.localStorage.getItem(LEGACY_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionData;
    if (!parsed.userId || (!parsed.authKey && !parsed.usos?.accessToken)) return null;

    // Migrate: extract tokenJpg from old imageUrl if not stored separately
    if (!parsed.tokenJpg && parsed.imageUrl) {
      try {
        const imgUrl = parsed.imageUrl.startsWith('http')
          ? new URL(parsed.imageUrl)
          : new URL(parsed.imageUrl, 'http://localhost');
        const tj = imgUrl.searchParams.get('tokenJpg') || '';
        if (tj) parsed.tokenJpg = tj;
      } catch { /* ignore */ }
    }

    // Always reconstruct imageUrl to use proxy
    if (parsed.userId && parsed.tokenJpg) {
      parsed.imageUrl = `/api/proxy/image?userId=${encodeURIComponent(parsed.userId)}&tokenJpg=${encodeURIComponent(parsed.tokenJpg)}`;
    }

    parsed.persistedAt = Date.now();

    window.localStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: SessionData | null): void {
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({
    ...session,
    persistedAt: session.persistedAt ?? Date.now(),
  }));
}

export function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY) ?? window.localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const settings: AppSettings = {
      language: parsed.language === 'en' ? 'en' : 'pl',
      notificationsEnabled: typeof parsed.notificationsEnabled === 'boolean' ? parsed.notificationsEnabled : true,
      refreshMinutes: [30, 60, 120].includes(parsed.refreshMinutes ?? 30) ? (parsed.refreshMinutes as 30 | 60 | 120) : 30,
      compactPlan: Boolean(parsed.compactPlan),
      gradesGrouping: typeof parsed.gradesGrouping === 'boolean' ? parsed.gradesGrouping : true,
    };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    window.localStorage.removeItem(LEGACY_SETTINGS_KEY);
    return settings;
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: AppSettings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadLegacyPlanHiddenSubjects(): string[] {
  try {
    const raw = window.localStorage.getItem(PLAN_FILTERS_KEY) ?? window.localStorage.getItem(LEGACY_PLAN_FILTERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function clearLegacyPlanHiddenSubjects(): void {
  window.localStorage.removeItem(LEGACY_PLAN_FILTERS_KEY);
  window.localStorage.removeItem(PLAN_FILTERS_KEY);
}

export function loadOrCreateDeviceId(): string {
  try {
    const existing = (window.localStorage.getItem(DEVICE_ID_KEY) ?? window.localStorage.getItem(LEGACY_DEVICE_ID_KEY))?.trim();
    if (existing) {
      window.localStorage.setItem(DEVICE_ID_KEY, existing);
      window.localStorage.removeItem(LEGACY_DEVICE_ID_KEY);
      return existing;
    }

    const next = typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `zutnik-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    window.localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return `zutnik-volatile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ── API cache with TTL ────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const TTL_MS = {
  studies: 15 * 60_000,
  semesters: 15 * 60_000,
  grades: 10 * 60_000,
  finance: 4 * 60 * 60_000,
  info: 15 * 60_000,
  plan: 5 * 60_000,
  news: 30 * 60_000,
};

function ck(name: string, suffix = ''): string {
  return `zutnik_c_${name}${suffix ? `_${suffix}` : ''}`;
}

function saveC<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, ts: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch { /* quota exceeded – ignore */ }
}

function loadC<T>(key: string, maxAge: number): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.ts > maxAge) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function loadCForce<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return entry.data;
  } catch {
    return null;
  }
}

export const cache = {
  // Studies
  saveStudies: (data: Study[]) => saveC(ck('studies'), data),
  loadStudies: (): Study[] | null => loadC(ck('studies'), TTL_MS.studies),
  loadStudiesForce: (): Study[] | null => loadCForce(ck('studies')),

  // Semesters per study
  saveSemesters: (studyId: string, data: Semester[]) => saveC(ck('sem', studyId), data),
  loadSemesters: (studyId: string): Semester[] | null => loadC(ck('sem', studyId), TTL_MS.semesters),
  loadSemestersForce: (studyId: string): Semester[] | null => loadCForce(ck('sem', studyId)),

  // Grades per semester
  saveGrades: (semId: string, data: Grade[]) => saveC(ck('grades', semId), data),
  loadGrades: (semId: string): Grade[] | null => loadC(ck('grades', semId), TTL_MS.grades),
  loadGradesForce: (semId: string): Grade[] | null => loadCForce(ck('grades', semId)),

  // Finance per study
  saveFinance: (studyId: string, data: FinanceSnapshot) => saveC(ck('finance', studyId), data),
  loadFinance: (studyId: string): FinanceSnapshot | null => loadC(ck('finance', studyId), TTL_MS.finance),
  loadFinanceForce: (studyId: string): FinanceSnapshot | null => loadCForce(ck('finance', studyId)),

  // Info per study
  saveInfo: (studyId: string, data: { details: StudyDetails | null; history: StudyHistoryItem[]; els?: ElsCard | null; calendarEvents?: CalendarEvent[] }) =>
    saveC(ck('info', studyId), data),
  loadInfo: (studyId: string): { details: StudyDetails | null; history: StudyHistoryItem[]; els?: ElsCard | null; calendarEvents?: CalendarEvent[] } | null =>
    loadC(ck('info', studyId), TTL_MS.info),
  loadInfoForce: (studyId: string): { details: StudyDetails | null; history: StudyHistoryItem[]; els?: ElsCard | null; calendarEvents?: CalendarEvent[] } | null =>
    loadCForce(ck('info', studyId)),

  // Plan (keyed by viewMode+date+studyId)
  savePlan: (key: string, data: PlanResult) => saveC(ck('plan', key), data),
  loadPlan: (key: string): PlanResult | null => loadC(ck('plan', key), TTL_MS.plan),
  loadPlanForce: (key: string): PlanResult | null => loadCForce(ck('plan', key)),

  // News
  saveNews: (data: NewsItem[]) => saveC(ck('news'), data),
  loadNews: (): NewsItem[] | null => loadC(ck('news'), TTL_MS.news),
  loadNewsForce: (): NewsItem[] | null => loadCForce(ck('news')),
};
