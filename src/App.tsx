import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { PlanScreen } from './app/screens/PlanScreen';
import { useTimetable } from './hooks/useTimetable';
import { useScreenMotion } from './hooks/useScreenMotion';
import { usePwaInstall } from './hooks/usePwaInstall';
import { beginRefresh, finishRefresh, type ResourceModule } from './services/refreshPolicy';
import { removeResources, readResource, saveResource } from './services/offlineStore';
import { clearTimetableAccount } from './services/timetable';
import { filterTimetable } from './services/timetablePages';
import type {
  CalendarEvent,
  CreditSummary,
  ElsCard,
  FinanceSnapshot,
  Grade,
  NewsItem,
  PlanResult,
  ScreenKey,
  SessionData,
  StatsSnapshot,
  Study,
  StudyDetails,
  StudyHistoryItem,
  ViewMode,
} from './types';
import {
  fetchCombinedGrades,
  fetchCombinedStudies,
  fetchCreditSummary,
  fetchCurrentPlanSubjectFilters,
  fetchFinance,
  fetchInfo,
  fetchNews,
  fetchPlanSemesterExport,
  fetchPlanSuggestions,
  fetchStatsSnapshot,
  fetchStudentPhotoBlob,
  fetchUsosRequestToken,
  getFriendlyErrorMessage,
  isSessionExpiredError,
  loginWithUsos,
  validateSession,
} from './services/api';
import {
  clearLegacyPlanHiddenSubjects,
  cache,
  loadLegacyPlanHiddenSubjects,
  loadSession,
  loadSettings,
  saveSession,
  saveSettings,
  clearAccountCache,
  type AppSettings,
} from './services/storage';
import { sortUsefulLinks } from './constants/usefulLinks';
import { useAppNavigation, useExitAttemptToast, type BackInterceptResult } from './hooks/useAppNavigation';
import { useSwipeGestures } from './hooks/useSwipeBack';
import { createT } from './i18n';
import {
  getPlanEventFilterKey,
  getPlanEventFilterLabel,
  getPlanEventFilterTypeKey,
  getPlanEventSubjectLabel,
  normalizePlanFilterKey,
  normalizePlanFilterString,
} from './planFilters';
import { exportPlanToIcs } from './app/planExport';
import { SCREEN_I18N_KEY } from './app/constants';
import {
  collapseCorrectedGrades,
  extractGradeBaseSubject,
  fmtDec,
  gradeMatchesHiddenPlanFilter,
  getSessionSignature,
  isFinalGradeType,
  parseGradeNum,
  planSubjectFilterSubject,
  sumUniqueEcts,
  todayYmd,
} from './app/helpers';
import { Ic, LoadingIndicator } from './app/ui';
import { ScreenChunkFallback } from './app/screens/ScreenLoaders';
import type { DrawerScreenKey, NewsDetailParams, SelectedPlanEvent } from './app/viewTypes';
import { HomeScreen, LoginScreen } from './app/screens/AuthScreens';
import { PlanEventSheet, PlanFiltersSheet, PlanSearchSheet } from './app/screens/PlanOverlays';
import { AppNavigation } from './app/AppNavigation';
import { PwaUpdateNotice } from './app/components/PwaUpdateNotice';
import { PwaInstallSheet } from './app/components/PwaInstallSheet';
import { Sheet } from './app/components/Sheet';

const GradesScreen = lazy(() => import('./app/screens/StudyScreens').then((module) => ({ default: module.GradesScreen })));
const FinanceScreen = lazy(() => import('./app/screens/StudyScreens').then((module) => ({ default: module.FinanceScreen })));
const InfoScreen = lazy(() => import('./app/screens/StudyScreens').then((module) => ({ default: module.InfoScreen })));
const AboutScreen = lazy(() => import('./app/screens/ContentScreens').then((module) => ({ default: module.AboutScreen })));
const LinksScreen = lazy(() => import('./app/screens/ContentScreens').then((module) => ({ default: module.LinksScreen })));
const NewsDetailScreen = lazy(() => import('./app/screens/ContentScreens').then((module) => ({ default: module.NewsDetailScreen })));
const NewsScreen = lazy(() => import('./app/screens/ContentScreens').then((module) => ({ default: module.NewsScreen })));
const SettingsScreen = lazy(() => import('./app/screens/ContentScreens').then((module) => ({ default: module.SettingsScreen })));
const StatsScreen = lazy(() => import('./app/screens/ContentScreens').then((module) => ({ default: module.StatsScreen })));

const SESSION_VALIDATE_INTERVAL_MS = 30 * 24 * 60 * 60_000;
const EMPTY_FINANCE_SNAPSHOT: FinanceSnapshot = { records: [], fetchedAt: 0 };
const STATS_OWNER_ALBUM = '57796';
function formatDataUpdatedAt(timestamp: number, language: AppSettings['language']): string {
  if (!timestamp) return language === 'en' ? 'Saved locally' : 'Dane zapisane lokalnie';
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(new Date(timestamp));
  return language === 'en' ? `Updated ${date}` : `Odświeżono ${date}`;
}


function normalizePlanHiddenSubjectKeys(keys: string[]): string[] {
  return [...new Set(
    keys
      .filter((value): value is string => typeof value === 'string')
      .map((value) => normalizePlanFilterKey(value))
      .filter(Boolean),
  )];
}

function arePlanHiddenSubjectListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeStatsAlbum(value: unknown): string {
  const match = String(value || '').trim().match(/^s?(\d{4,6})$/i);
  return match?.[1] ?? '';
}

function formatCreditMetric(value: number | null | undefined, fallback: number): string {
  const source = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (!Number.isFinite(source)) return '0';
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: Math.abs(source - Math.round(source)) > 0.0001 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(Math.max(0, source));
}

function keepRealGrades(items: Grade[]): Grade[] {
  return items.filter((item) => item.grade?.trim() || !isFinalGradeType(item.type, item.subjectName));
}

function applyThemePreference(theme: AppSettings['theme']): void {
  const root = document.documentElement;
  const resolvedTheme = theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    : theme;
  root.dataset.theme = resolvedTheme;

  // Page metadata overrides the manifest's launch color in supported browsers.
  const chromeColor = getComputedStyle(root).getPropertyValue('--mz-bg').trim();
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor && chromeColor && themeColor.content !== chromeColor) {
    themeColor.content = chromeColor;
  }
  const colorScheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (colorScheme && colorScheme.content !== resolvedTheme) colorScheme.content = resolvedTheme;
}

function App() {
  const [session, setSession] = useState<SessionData | null>(() => loadSession());
  const [settings, setSettings] = useState<AppSettings>(() => {
    const loaded = loadSettings();
    applyThemePreference(loaded.theme);
    return loaded;
  });
  const [studies, setStudies] = useState<Study[]>([]);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [globalLoading, setGlobalLoad] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [toast, setToast] = useState('');
  const sessionKey = getSessionSignature(session);
  const sessionExpiryHandledRef = useRef(false);
  const sessionCheckInFlightRef = useRef<Promise<boolean> | null>(null);
  const lastSessionCheckRef = useRef<{ key: string; ts: number }>({ key: '', ts: 0 });
  const activeSessionKeyRef = useRef(sessionKey);
  const overlayBackAttemptRef = useRef<(() => BackInterceptResult) | null>(null);
  const newsGalleryBackRef = useRef<(() => BackInterceptResult) | null>(null);
  const rootBackAttemptRef = useRef<(() => boolean) | null>(null);

  const nav = useAppNavigation<ScreenKey>(session ? 'home' : 'login', {
    onBackAttemptRef: overlayBackAttemptRef,
    onRootBackAttemptRef: rootBackAttemptRef,
  });
  const screen = nav.current.key;
  const mainRef = useRef<HTMLElement>(null);
  useScreenMotion(mainRef, screen);
  const statsDeepLinkHandledRef = useRef(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [planSearchSeed, setPlanSearchSeed] = useState<{ category: string; query: string } | undefined>();
  const suggestionSequence = useRef(0);

  const pwaInstall = usePwaInstall();
  const { guideOpen: installGuideOpen, closeGuide: closeInstallGuide } = pwaInstall;

  // Plan
  const [planViewMode, setPlanViewMode] = useState<ViewMode>('week');
  const [planDate, setPlanDate] = useState(todayYmd);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planUpdatedAt, setPlanUpdatedAt] = useState(0);
  const [gradesUpdatedAt, setGradesUpdatedAt] = useState(0);
  const [planSearchOpen, setPlanSearchOpen] = useState(false);
  const [planFiltersOpen, setPlanFiltersOpen] = useState(false);
  const [planMoreMenuOpen, setPlanMoreMenuOpen] = useState(false);
  const [planSearchCat, setPlanSearchCat] = useState('album');
  const [planSearchQ, setPlanSearchQ] = useState('');
  const [planSearchSuggestions, setPlanSearchSuggestions] = useState<string[]>([]);
  const [planSearchLoading, setPlanSearchLoading] = useState(false);
  const [selectedPlanEvent, setSelectedPlanEvent] = useState<SelectedPlanEvent | null>(null);
  const [planHiddenSubjectKeysByAlbum, setPlanHiddenSubjectKeysByAlbum] = useState<Record<string, string[]>>({});
  const planHiddenSubjectKeysByAlbumRef = useRef<Record<string, string[]>>({});
  const planSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planMoreMenuRef = useRef<HTMLDivElement | null>(null);

  // Grades
  const [grades, setGrades] = useState<Grade[]>([]);
  const [gradesLoading, setGradesLoad] = useState(false);
  const [gradesPlanAlbum, setGradesPlanAlbum] = useState('');
  const [gradesPlanSubjectFilters, setGradesPlanSubjectFilters] = useState<PlanResult['subjectFilters']>([]);
  const [expandedGradeSubjects, setExpandedGradeSubjects] = useState<Record<string, boolean>>({});
  const gradesRef = useRef<Grade[]>([]);
  const creditsRef = useRef<CreditSummary | null>(null);
  const gradesPlanFilterRequestIdRef = useRef<string>('');
  const gradesPlanFilterCacheRef = useRef<Record<string, { album: string; filters: PlanResult['subjectFilters'] }>>({});

  // Finance
  const [financeSnapshot, setFinanceSnapshot] = useState<FinanceSnapshot>(EMPTY_FINANCE_SNAPSHOT);
  const [financeLoading, setFinanceLoading] = useState(false);

  // Info
  const [details, setDetails] = useState<StudyDetails | null>(null);
  const [history, setHistory] = useState<StudyHistoryItem[]>([]);
  const [els, setEls] = useState<ElsCard | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [credits, setCredits] = useState<CreditSummary | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [studentPhotoError, setStudentPhotoError] = useState(false);

  // News
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);

  // Stats
  const [statsSnapshot, setStatsSnapshot] = useState<StatsSnapshot | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');

  const activeStudyId = session?.activeStudyId ?? studies[0]?.przynaleznoscId ?? null;
  const canOpenStats = useMemo(() => normalizeStatsAlbum(session?.userId) === STATS_OWNER_ALBUM, [session?.userId]);
  const currentPlanAlbum = useMemo(() => (planResult?.debug.album || '').trim(), [planResult?.debug.album]);
  const hiddenPlanSubjectKeys = useMemo(() => (
    currentPlanAlbum ? (planHiddenSubjectKeysByAlbum[currentPlanAlbum] ?? []) : []
  ), [currentPlanAlbum, planHiddenSubjectKeysByAlbum]);
  const gradesPlanFilterAlbum = useMemo(() => (gradesPlanAlbum || currentPlanAlbum || '').trim(), [currentPlanAlbum, gradesPlanAlbum]);
  const hiddenGradesPlanSubjectKeys = useMemo(() => (
    gradesPlanFilterAlbum ? (planHiddenSubjectKeysByAlbum[gradesPlanFilterAlbum] ?? []) : []
  ), [gradesPlanFilterAlbum, planHiddenSubjectKeysByAlbum]);

  useEffect(() => {
    planHiddenSubjectKeysByAlbumRef.current = planHiddenSubjectKeysByAlbum;
  }, [planHiddenSubjectKeysByAlbum]);

  useEffect(() => {
    gradesRef.current = grades;
  }, [grades]);

  useEffect(() => {
    creditsRef.current = credits;
  }, [credits]);

  // ── Online/offline tracking ──────────────────────────────────────────────
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ── Toast auto-clear ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ── Student photo loading via fetch (avoids CORS / cache issues) ────────
  const [studentPhotoBlobUrl, setStudentPhotoBlobUrl] = useState<string | null>(null);
  const studentPhotoBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (studentPhotoBlobUrlRef.current) {
      URL.revokeObjectURL(studentPhotoBlobUrlRef.current);
      studentPhotoBlobUrlRef.current = null;
    }
    setStudentPhotoError(false);
    setStudentPhotoBlobUrl(null);
  }, [sessionKey]);

  useEffect(() => {
    if (screen !== 'info' || !session?.usos || studentPhotoBlobUrl || studentPhotoError) return;

    let cancelled = false;
    (async () => {
      try {
        const key = `photo:${session.userId}`;
        const saved = await readResource<Blob>(key);
        let blob = saved?.data ?? null;
        if (navigator.onLine && (!saved || Date.now() - saved.ts > 7 * 86_400_000)) {
          try {
            const fresh = await fetchStudentPhotoBlob(session);
            if (fresh?.size) { blob = fresh; await saveResource(key, fresh); }
          } catch { /* Keep the saved photograph when the server is unavailable. */ }
        }
        if (cancelled) return;
        if (!blob || blob.size === 0) { setStudentPhotoError(true); return; }
        const blobUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        studentPhotoBlobUrlRef.current = blobUrl;
        setStudentPhotoBlobUrl(blobUrl);
      } catch {
        if (!cancelled) setStudentPhotoError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, session, sessionKey, studentPhotoBlobUrl, studentPhotoError]);

  useEffect(() => () => {
    if (studentPhotoBlobUrlRef.current) {
      URL.revokeObjectURL(studentPhotoBlobUrlRef.current);
    }
  }, []);

  const showToast = useCallback((msg: string) => setToast(msg), []);
  const showGlobalError = useCallback((error: unknown, fallback?: string) => {
    setGlobalError(getFriendlyErrorMessage(error, fallback));
  }, []);

  const setPlanHiddenSubjectsForAlbum = useCallback((album: string, keys: string[]) => {
    const normalizedAlbum = album.trim();
    if (!normalizedAlbum) return;

    const normalizedKeys = normalizePlanHiddenSubjectKeys(keys);
    setPlanHiddenSubjectKeysByAlbum((prev) => {
      const currentKeys = prev[normalizedAlbum] ?? [];
      if (arePlanHiddenSubjectListsEqual(currentKeys, normalizedKeys)) {
        return prev;
      }

      return {
        ...prev,
        [normalizedAlbum]: normalizedKeys,
      };
    });
  }, []);

  const loadPersistedPlanHiddenSubjects = useCallback(async (album: string): Promise<string[]> => {
    try {
      const key = `zutnik_filters:${album.trim()}`;
      const saved = localStorage.getItem(key);
      const values = saved ? JSON.parse(saved) : loadLegacyPlanHiddenSubjects();
      const keys = normalizePlanHiddenSubjectKeys(Array.isArray(values) ? values : []);
      localStorage.setItem(key, JSON.stringify(keys));
      clearLegacyPlanHiddenSubjects();
      return keys;
    } catch { return planHiddenSubjectKeysByAlbumRef.current[album] ?? []; }
  }, []);

  const persistPlanHiddenSubjects = useCallback(async (album: string, keys: string[]) => {
    setPlanHiddenSubjectsForAlbum(album, keys);
    try { localStorage.setItem(`zutnik_filters:${album.trim()}`, JSON.stringify(keys)); }
    catch { showToast('Brak miejsca na zapisanie filtrów.'); }
  }, [setPlanHiddenSubjectsForAlbum, showToast]);

  useEffect(() => {
    const reload = () => {
      if (!session) return;
      void loadPersistedPlanHiddenSubjects(session.userId).then((keys) => setPlanHiddenSubjectsForAlbum(session.userId, keys));
    };
    window.addEventListener('zutnik-settings-imported', reload);
    return () => window.removeEventListener('zutnik-settings-imported', reload);
  }, [session, loadPersistedPlanHiddenSubjects, setPlanHiddenSubjectsForAlbum]);

  // ── Keyboard drawer close ─────────────────────────────────────────────────
  useEffect(() => {
    if (!drawerOpen) return;
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [drawerOpen]);

  useEffect(() => {
    if (!selectedPlanEvent) return;
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedPlanEvent(null); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [selectedPlanEvent]);

  // ── Sync settings ─────────────────────────────────────────────────────────
  useEffect(() => {
    applyThemePreference(settings.theme);
    saveSettings(settings);
  }, [settings]);

  // ── Session → navigation sync ─────────────────────────────────────────────
  useEffect(() => {
    saveSession(session);
    if (!session && screen !== 'login') nav.reset('login', undefined);
    if (session && screen === 'login') nav.reset('home', undefined);
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (screen === 'stats' && !canOpenStats) {
      nav.reset('home', undefined);
    }
  }, [canOpenStats, nav, screen]);

  useEffect(() => {
    if (screen !== 'news-detail') return;
    const params = (nav.current.params ?? {}) as NewsDetailParams;
    if (!params?.item) {
      nav.reset('news', undefined);
    }
  }, [nav, screen]);

  useEffect(() => {
    overlayBackAttemptRef.current = () => {
      if (installGuideOpen) {
        closeInstallGuide();
        return true;
      }
      const galleryResult = newsGalleryBackRef.current?.();
      if (galleryResult === true) return true;
      if (galleryResult === 'consume') return 'consume';

      if (selectedPlanEvent) {
        setSelectedPlanEvent(null);
        return true;
      }
      if (planFiltersOpen) {
        setPlanFiltersOpen(false);
        return true;
      }
      if (planSearchOpen) {
        setPlanSearchOpen(false);
        return true;
      }
      return false;
    };

    return () => {
      overlayBackAttemptRef.current = null;
    };
  }, [installGuideOpen, closeInstallGuide, planFiltersOpen, planSearchOpen, selectedPlanEvent]);

  useEffect(() => {
    if (statsDeepLinkHandledRef.current || !session) return;
    const params = new URLSearchParams(window.location.search);
    const destination = params.get('screen');
    if (!['stats', 'plan', 'grades'].includes(destination || '')) return;

    statsDeepLinkHandledRef.current = true;
    params.delete('screen');
    const nextSearch = params.toString();
    window.history.replaceState(
      { zutnik: true, ts: Date.now() },
      '',
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
    );

    if (destination === 'plan' || destination === 'grades') nav.reset(destination, undefined);
    else if (canOpenStats) nav.reset('stats', undefined);
  }, [canOpenStats, nav, session]);

  useEffect(() => {
    activeSessionKeyRef.current = sessionKey;
    sessionExpiryHandledRef.current = false;
    setStatsSnapshot(null);
    setStatsError('');

    if (!sessionKey) {
      sessionCheckInFlightRef.current = null;
      lastSessionCheckRef.current = { key: '', ts: 0 };
      return;
    }

    if (lastSessionCheckRef.current.key !== sessionKey) {
      sessionCheckInFlightRef.current = null;
      lastSessionCheckRef.current = { key: sessionKey, ts: session?.persistedAt ?? 0 };
    }
  }, [sessionKey, session?.persistedAt]);

  // ── Close drawer on screen change ────────────────────────────────────────
  useEffect(() => {
    setDrawerOpen(false);
    if (screen !== 'plan') {
      setPlanFiltersOpen(false);
      setPlanMoreMenuOpen(false);
      setPlanSearchOpen(false);
      setSelectedPlanEvent(null);
    }
  }, [screen]);

  useEffect(() => {
    if (!planMoreMenuOpen) return;
    const items = () => Array.from(planMoreMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus({ preventScroll: true });

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!planMoreMenuRef.current || !(target instanceof Node)) return;
      if (!planMoreMenuRef.current.contains(target)) {
        setPlanMoreMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlanMoreMenuOpen(false);
        planMoreMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const buttons = items();
        const index = buttons.findIndex((button) => button === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [planMoreMenuOpen]);

  // ── i18n ───────────────────────────────────────────────────────────────────
  const t = useMemo(() => createT(settings.language), [settings.language]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => { if (settings.theme === 'system') applyThemePreference('system'); };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [settings.theme]);

  // ── Exit toast ────────────────────────────────────────────────────────────
  useExitAttemptToast(() => showToast(t('general.pressAgainToExit')));

  // ── Swipe gestures ────────────────────────────────────────────────────────
  const swipe = useSwipeGestures({
    canGoBack: screen === 'plan' && (planSearchOpen || !!planSearchQ.trim()),
    onBack: () => {
      if (screen === 'plan' && (planSearchOpen || !!planSearchQ.trim())) {
        resetPlanSearch();
      }
    },
    canOpenDrawer: !drawerOpen && screen !== 'login' && screen !== 'plan' && !selectedPlanEvent && !planFiltersOpen && !planSearchOpen,
    onOpenDrawer: () => setDrawerOpen(true),
    canCloseDrawer: drawerOpen,
    onCloseDrawer: () => setDrawerOpen(false),
  });

  // ── Session management ────────────────────────────────────────────────────
  const applySession = useCallback((s: SessionData | null) => {
    const nextSession = s ? { ...s, persistedAt: Date.now() } : null;
    setSession(nextSession);
    if (nextSession && !saveSession(nextSession)) showToast('Przeglądarka nie pozwala zapisać sesji. Po zamknięciu trzeba będzie zalogować się ponownie.');
    if (!nextSession) {
      setPlanHiddenSubjectKeysByAlbum({});
      setPlanFiltersOpen(false);
      setPlanMoreMenuOpen(false);
      setPlanSearchOpen(false);

      const previous = loadSession();
      if (previous) {
        clearAccountCache(previous.userId);
        void clearTimetableAccount(previous.userId);
        void removeResources(`suggest:${previous.userId}:`);
        void removeResources(`photo:${previous.userId}`, true);
      }
      saveSession(null);
      sessionStorage.removeItem('usos_request_token_secret');
      setGrades([]); setPlanResult(null); setDetails(null); setHistory([]);
      setEls(null); setCredits(null); setFinanceSnapshot(EMPTY_FINANCE_SNAPSHOT);
    }
  }, [showToast]);

  const handleExpiredSession = useCallback(() => {
    if (!activeSessionKeyRef.current || sessionExpiryHandledRef.current) return;
    sessionExpiryHandledRef.current = true;
    const message = t('general.sessionExpired');
    setGlobalError(message);
    showToast(message);
  }, [showToast, t]);

  const handleSessionError = useCallback((error: unknown): boolean => {
    if (!isSessionExpiredError(error)) return false;
    handleExpiredSession();
    return true;
  }, [handleExpiredSession]);

  const ensureSessionStillValid = useCallback(async (sess: SessionData, force = false): Promise<boolean> => {
    if (!navigator.onLine) return true;
    if (sessionExpiryHandledRef.current) return false;

    const key = getSessionSignature(sess);
    const recentCheck = lastSessionCheckRef.current;
    if (!force && recentCheck.key === key && Date.now() - recentCheck.ts < SESSION_VALIDATE_INTERVAL_MS) {
      return true;
    }

    if (sessionCheckInFlightRef.current) {
      return sessionCheckInFlightRef.current;
    }

    const checkPromise = (async () => {
      try {
        await validateSession(sess);
        if (activeSessionKeyRef.current === key) {
          lastSessionCheckRef.current = { key, ts: Date.now() };
          saveSession({ ...sess, persistedAt: Date.now() });
        }
        return true;
      } catch (error) {
        if (activeSessionKeyRef.current === key && isSessionExpiredError(error)) {
          handleExpiredSession();
          return false;
        }
        return true;
      }
    })();

    sessionCheckInFlightRef.current = checkPromise;
    checkPromise.finally(() => {
      if (sessionCheckInFlightRef.current === checkPromise) {
        sessionCheckInFlightRef.current = null;
      }
    });
    return checkPromise;
  }, [handleExpiredSession]);

  useEffect(() => {
    if (!session) return;
    void ensureSessionStillValid(session);

    const revalidate = () => {
      void ensureSessionStillValid(session);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        revalidate();
      }
    };

    window.addEventListener('focus', revalidate);
    window.addEventListener('online', revalidate);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('online', revalidate);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [session, ensureSessionStillValid]);

  // ── USOS OAuth Callback Handling ──────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifier = params.get('oauth_verifier');
    const token = params.get('oauth_token');

    if (verifier && token) {
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);

      const secret = sessionStorage.getItem('usos_request_token_secret');
      if (!secret) {
        setGlobalError('Brak sekretu tokenu USOS. Spróbuj ponownie.');
        return;
      }

      setGlobalLoad(true);
      loginWithUsos(verifier, token, secret)
        .then(s => {
          applySession(s);
          showToast('Zalogowano przez USOS');
          sessionStorage.removeItem('usos_request_token_secret');
        })
        .catch(e => showGlobalError(e, 'Błąd logowania USOS.'))
        .finally(() => setGlobalLoad(false));
    }
  }, [applySession, showGlobalError, showToast]);

  const updateActiveStudy = useCallback((id: string | null) => {
    setSession(prev => (prev ? { ...prev, activeStudyId: id } : prev));
  }, []);

  // ── Data loading with cache-first strategy ────────────────────────────────

  const allowNetwork = useCallback(async (sess: SessionData | null, module: ResourceModule, manual: boolean, fresh: boolean, hasCache: boolean) => {
    const scope = sess ? `${sess.userId}:${sess.activeStudyId || ''}` : 'public';
    const decision = beginRefresh(scope, module, manual, fresh, hasCache);
    if (!decision.allow) {
      if (manual) showToast(decision.reason === 'offline' ? 'Tryb offline. Pokazuję zapisane dane.'
        : decision.reason === 'inflight' ? 'Odświeżanie już trwa.'
        : 'Dane są zapisane. Kolejne odświeżenie będzie dostępne za kilka minut.');
      return false;
    }
    if (sess && !(await ensureSessionStillValid(sess))) { finishRefresh(scope, module, false); return false; }
    return true;
  }, [ensureSessionStillValid, showToast]);

  const loadStudiesData = useCallback(async (sess: SessionData) => {
    const cached = cache.loadStudiesForce();
    if (cached) {
      setStudies(cached);
      if (!sess.activeStudyId && cached[0]?.przynaleznoscId) updateActiveStudy(cached[0].przynaleznoscId);
    }
    if (!(await allowNetwork(sess, 'studies', false, !!cache.loadStudies(), cached !== null))) return;
    const scope = `${sess.userId}:${sess.activeStudyId || ''}`;
    if (!cached) setGlobalLoad(true);
    try {
      const fresh = await fetchCombinedStudies(sess);
      cache.saveStudies(fresh); setStudies(fresh);
      if (!sess.activeStudyId && fresh[0]?.przynaleznoscId) updateActiveStudy(fresh[0].przynaleznoscId);
      finishRefresh(scope, 'studies', true);
    } catch (error) {
      finishRefresh(scope, 'studies', false);
      if (!handleSessionError(error) && !cached && navigator.onLine) showGlobalError(error, 'Nie można pobrać kierunków.');
    } finally { setGlobalLoad(false); }
  }, [allowNetwork, handleSessionError, showGlobalError, updateActiveStudy]);

  useEffect(() => {
    if (!session) { setStudies([]); return; }
    void loadStudiesData(session);
  }, [session, loadStudiesData]);

  const { load: loadPlanData, window: planWindow } = useTimetable({
    session, mode: planViewMode, date: planDate, search: { category: planSearchCat, query: planSearchQ },
    onResult: setPlanResult, onLoading: setPlanLoading, onUpdated: setPlanUpdatedAt,
    ensureValid: ensureSessionStillValid, onError: showGlobalError, onToast: showToast,
  });

  useEffect(() => {
    if (!currentPlanAlbum) return;
    let cancelled = false;
    void loadPersistedPlanHiddenSubjects(currentPlanAlbum).then((keys) => {
      if (!cancelled) setPlanHiddenSubjectsForAlbum(currentPlanAlbum, keys);
    });
    return () => { cancelled = true; };
  }, [currentPlanAlbum, loadPersistedPlanHiddenSubjects, setPlanHiddenSubjectsForAlbum]);

  // Ignore out-of-order autocomplete responses.
  const fetchPlanSearchSuggestions = useCallback(async (category: string, query: string) => {
    const request = ++suggestionSequence.current;
    if (!query.trim()) {
      setPlanSearchSuggestions([]);
      setPlanSearchLoading(false);
      return;
    }

    setPlanSearchLoading(true);
    try {
      if (!session) return;
      const suggestions = await fetchPlanSuggestions(session, category, query);
      if (request === suggestionSequence.current) setPlanSearchSuggestions(suggestions);
    } catch {
      if (request === suggestionSequence.current) setPlanSearchSuggestions([]);
    } finally {
      if (request === suggestionSequence.current) setPlanSearchLoading(false);
    }
  }, [session]);

  const loadGradesPlanFilters = useCallback(async (forceRefresh = false) => {
    if (!session) {
      setGradesPlanAlbum('');
      setGradesPlanSubjectFilters([]);
      return;
    }

    const cacheKey = `${session.userId || 'usos'}_${activeStudyId ?? 'nostudy'}_${todayYmd()}_android_plan_filters_v2`;
    const cachedFiltersEntry = gradesPlanFilterCacheRef.current[cacheKey];
    if (!forceRefresh && cachedFiltersEntry) {
      setGradesPlanAlbum(cachedFiltersEntry.album);
      setGradesPlanSubjectFilters(cachedFiltersEntry.filters);
      if (cachedFiltersEntry.album) {
        const hiddenKeys = await loadPersistedPlanHiddenSubjects(cachedFiltersEntry.album);
        setPlanHiddenSubjectsForAlbum(cachedFiltersEntry.album, hiddenKeys);
      }
      return;
    }

    const requestId = Math.random().toString(36).slice(2, 11);
    gradesPlanFilterRequestIdRef.current = requestId;

    try {
      const result = await fetchCurrentPlanSubjectFilters(session, {
        currentDate: todayYmd(),
        studyId: activeStudyId,
      });

      if (gradesPlanFilterRequestIdRef.current !== requestId) return;

      const album = (result.album || '').trim();
      const filters = result.subjectFilters ?? [];
      gradesPlanFilterCacheRef.current[cacheKey] = { album, filters };
      setGradesPlanAlbum(album);
      setGradesPlanSubjectFilters(filters);

      if (album) {
        const hiddenKeys = await loadPersistedPlanHiddenSubjects(album);
        if (gradesPlanFilterRequestIdRef.current !== requestId) return;
        setPlanHiddenSubjectsForAlbum(album, hiddenKeys);
      }
    } catch (error) {
      console.warn('Failed to load plan filters for grades', error);
    }
  }, [
    session,
    activeStudyId,
    loadPersistedPlanHiddenSubjects,
    setPlanHiddenSubjectsForAlbum,
  ]);

  const applyPlanSearch = useCallback((category: string, query: string) => {
    const value = query.trim(); if (!session || !value) return;
    setSelectedPlanEvent(null); setPlanMoreMenuOpen(false); setPlanFiltersOpen(false);
    if (!/\\[[^\\[\\]]+\\]$/.test(value) && category !== 'album') {
      setPlanSearchSeed({ category, query: value });
      setPlanSearchOpen(true);
      void fetchPlanSearchSuggestions(category, value);
      return;
    }
    setPlanSearchSeed(undefined); setPlanSearchCat(category); setPlanSearchQ(value);
    setPlanSearchOpen(false); setPlanSearchSuggestions([]);
    void loadPlanData({ category, query: value });
  }, [session, fetchPlanSearchSuggestions, loadPlanData]);

  const resetPlanSearch = useCallback(() => {
    const shouldReloadPlan = planSearchOpen || !!planSearchQ.trim();

    if (planSearchDebounceRef.current) {
      clearTimeout(planSearchDebounceRef.current);
      planSearchDebounceRef.current = null;
    }

    setPlanSearchQ('');
    setPlanSearchSuggestions([]);
    setPlanSearchLoading(false);
    setPlanSearchOpen(false);

    if (shouldReloadPlan) {
      void loadPlanData({ category: planSearchCat, query: '' });
    }
  }, [loadPlanData, planSearchOpen, planSearchQ, planSearchCat]);

  useEffect(() => {
    rootBackAttemptRef.current = () => {
      if (screen !== 'plan') return false;
      if (!planSearchOpen && !planSearchQ.trim()) return false;

      resetPlanSearch();
      return true;
    };

    return () => {
      rootBackAttemptRef.current = null;
    };
  }, [screen, planSearchOpen, planSearchQ, resetPlanSearch]);

  const loadGradesData = useCallback(async (forceRefresh = false) => {
    if (!session) return;
    const scope = `${session.userId}:${activeStudyId || ''}`;
    const key = `${session.userId}_active_terms_v4`;
    const cached = cache.loadGradesForce(key);
    const info = activeStudyId ? cache.loadInfoForce(activeStudyId) : null;
    const savedCredits = cache.loadCreditsForce(activeStudyId || '') ?? info?.credits;
    if (savedCredits) setCredits(savedCredits);
    if (cached) { setGrades(keepRealGrades(cached)); setGradesUpdatedAt(cache.loadGradesTimestamp(key)); }
    if (!(await allowNetwork(session, 'grades', forceRefresh, cache.loadGrades(key) !== null, cached !== null))) return;
    setGradesLoad(true); setGlobalError('');
    try {
      const [result, summary] = await Promise.allSettled([
        fetchCombinedGrades(session),
        forceRefresh || !savedCredits ? fetchCreditSummary(session, activeStudyId) : Promise.resolve(savedCredits),
      ]);
      if (result.status === 'rejected') throw result.reason;
      if (summary.status === 'fulfilled' && summary.value) {
        setCredits(summary.value); cache.saveCredits(activeStudyId || '', summary.value);
      }
      const fresh = keepRealGrades(result.value);
      cache.saveGrades(key, fresh); setGrades(fresh); setGradesUpdatedAt(Date.now());
      finishRefresh(scope, 'grades', true);
    } catch (error) {
      finishRefresh(scope, 'grades', false);
      if (!handleSessionError(error) && !cached && !gradesRef.current.length && navigator.onLine) showGlobalError(error, 'Nie można pobrać ocen.');
      else if (forceRefresh && navigator.onLine) showToast('Pokazuję zapisane oceny. USOS jest chwilowo niedostępny.');
    } finally { setGradesLoad(false); }
  }, [session, activeStudyId, allowNetwork, handleSessionError, showGlobalError, showToast]);

  const loadFinanceData = useCallback(async (forceRefresh = false) => {
    if (!session || !activeStudyId) return;
    const scope = `${session.userId}:${activeStudyId}`;
    const saved = cache.loadFinanceForce(activeStudyId);
    if (saved) setFinanceSnapshot(saved);
    if (!(await allowNetwork(session, 'finance', forceRefresh, !!cache.loadFinance(activeStudyId), saved !== null))) return;
    setFinanceLoading(true); setGlobalError('');
    try {
      const records = await fetchFinance(session, activeStudyId);
      const snapshot: FinanceSnapshot = { records, fetchedAt: Date.now() };
      cache.saveFinance(activeStudyId, snapshot); setFinanceSnapshot(snapshot);
      finishRefresh(scope, 'finance', true);
    } catch (error) {
      finishRefresh(scope, 'finance', false);
      if (!handleSessionError(error) && !saved && navigator.onLine) showGlobalError(error, 'Nie można pobrać finansów.');
    } finally { setFinanceLoading(false); }
  }, [session, activeStudyId, allowNetwork, handleSessionError, showGlobalError]);

  const loadInfoData = useCallback(async (forceRefresh = false) => {
    if (!session || !activeStudyId) return;
    const scope = `${session.userId}:${activeStudyId}`;
    const saved = cache.loadInfoForce(activeStudyId);
    if (saved) {
      setDetails(saved.details); setHistory(saved.history); setEls(saved.els ?? null);
      setCalendarEvents(saved.calendarEvents ?? []);
      setCredits(cache.loadCreditsForce(activeStudyId) ?? saved.credits ?? null);
    }
    if (!(await allowNetwork(session, 'info', forceRefresh, !!cache.loadInfo(activeStudyId), saved !== null))) return;
    setInfoLoading(true); setGlobalError('');
    try {
      const [info, summary] = await Promise.allSettled([fetchInfo(session, activeStudyId), fetchCreditSummary(session, activeStudyId)]);
      if (info.status === 'rejected') throw info.reason;
      const payload = { ...info.value, credits: summary.status === 'fulfilled' ? summary.value : saved?.credits ?? null };
      cache.saveInfo(activeStudyId, payload);
      if (payload.credits) cache.saveCredits(activeStudyId, payload.credits);
      setDetails(payload.details); setHistory(payload.history); setEls(payload.els ?? null);
      setCalendarEvents(payload.calendarEvents ?? []); setCredits(payload.credits);
      finishRefresh(scope, 'info', true);
    } catch (error) {
      finishRefresh(scope, 'info', false);
      if (!handleSessionError(error) && !saved && navigator.onLine) showGlobalError(error, 'Nie można pobrać danych.');
    } finally { setInfoLoading(false); }
  }, [session, activeStudyId, allowNetwork, handleSessionError, showGlobalError]);

  const loadNewsData = useCallback(async (forceRefresh = false) => {
    const saved = cache.loadNewsForce();
    if (saved) setNews(saved);
    if (!(await allowNetwork(null, 'news', forceRefresh, !!cache.loadNews(), saved !== null))) return;
    setNewsLoading(true); setGlobalError('');
    try {
      const items = await fetchNews(); cache.saveNews(items); setNews(items);
      finishRefresh('public', 'news', true);
    } catch (error) {
      finishRefresh('public', 'news', false);
      if (!saved && navigator.onLine) showGlobalError(error, 'Nie można pobrać aktualności.');
    } finally { setNewsLoading(false); }
  }, [allowNetwork, showGlobalError]);

  const loadStatsData = useCallback(async (forceRefresh = false) => {
    if (!session || !canOpenStats) return;
    if (statsSnapshot && !forceRefresh) return;

    setStatsLoading(true);
    setStatsError('');
    try {
      const snapshot = await fetchStatsSnapshot(session);
      setStatsSnapshot(snapshot);
    } catch (e) {
      if (handleSessionError(e)) return;
      const message = getFriendlyErrorMessage(e, 'Nie można pobrać statystyk.');
      setStatsError(message);
      if (!statsSnapshot) setGlobalError(message);
    } finally {
      setStatsLoading(false);
    }
  }, [canOpenStats, handleSessionError, session, statsSnapshot]);

  // ── Load on screen enter ──────────────────────────────────────────────────
  const prevScreen = useRef<ScreenKey | null>(null);
  useEffect(() => {
    if (!session || screen === prevScreen.current) return;
    prevScreen.current = screen;
    if (screen === 'plan') void loadPlanData();
    if (screen === 'grades') {
      void loadGradesData();
    }
    if (screen === 'finance') void loadFinanceData();
    if (screen === 'info') void loadInfoData();
    if (screen === 'news') void loadNewsData();
    if (screen === 'stats') void loadStatsData();
  }, [screen, session]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!session || screen !== 'grades') return;
    const timer = window.setTimeout(() => {
      void loadGradesPlanFilters();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [screen, session, loadGradesPlanFilters]);

  const prevStudyId = useRef<string | null>(null);
  useEffect(() => {
    if (!session) {
      prevStudyId.current = null;
      return;
    }
    if (prevStudyId.current === null) {
      prevStudyId.current = activeStudyId;
      return;
    }
    if (prevStudyId.current === activeStudyId) return;

    prevStudyId.current = activeStudyId;
    setGrades([]);
    setGradesPlanAlbum('');
    setGradesPlanSubjectFilters([]);
    setFinanceSnapshot({ ...EMPTY_FINANCE_SNAPSHOT });
    setDetails(null);
    setHistory([]);
    setEls(null);
    setCalendarEvents([]);
    setCredits(null);
    setPlanResult(null);
    setPlanUpdatedAt(0);
    setGradesUpdatedAt(0);
    setSelectedPlanEvent(null);

    if (screen === 'plan') void loadPlanData();
    if (screen === 'grades') {
      void loadGradesData();
      window.setTimeout(() => void loadGradesPlanFilters(true), 650);
    }
    if (screen === 'finance') void loadFinanceData();
    if (screen === 'info') void loadInfoData();
  }, [session, activeStudyId, screen, loadPlanData, loadGradesData, loadGradesPlanFilters, loadFinanceData, loadInfoData]);

  // ── Refresh when plan date/view changes ──────────────────────────────────
  useEffect(() => {
    if (screen === 'plan' && session) void loadPlanData();
  }, [planViewMode, planDate, activeStudyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computed values ───────────────────────────────────────────────────────

  const hiddenGradePlanFilterItems = useMemo(() => {
    if (!hiddenGradesPlanSubjectKeys.length || !gradesPlanSubjectFilters.length) return [];
    const hiddenKeys = new Set(hiddenGradesPlanSubjectKeys);
    return gradesPlanSubjectFilters.filter((item) => hiddenKeys.has(item.key));
  }, [gradesPlanSubjectFilters, hiddenGradesPlanSubjectKeys]);

  const visibleGrades = useMemo(() => {
    if (!grades.length) return [];

    return grades.filter((grade) => {
      if (!grade.grade.trim() && isFinalGradeType(grade.type, grade.subjectName)) {
        return false;
      }

      return !hiddenGradePlanFilterItems.some((item) => gradeMatchesHiddenPlanFilter(grade, item));
    });
  }, [grades, hiddenGradePlanFilterItems]);

  const effectiveVisibleGrades = useMemo(
    () => collapseCorrectedGrades(visibleGrades),
    [visibleGrades],
  );

  const groupedGrades = useMemo(() => {
    const grouped = new Map<string, { subject: string; finalGradeItem: Grade | null; others: Grade[]; emptyFromPlanFilter: boolean }>();

    for (const g of effectiveVisibleGrades) {
      const subject = extractGradeBaseSubject(g.subjectName);
      if (!subject) continue;

      let group = grouped.get(subject);
      if (!group) {
        group = { subject, finalGradeItem: null, others: [], emptyFromPlanFilter: false };
        grouped.set(subject, group);
      }

      if (isFinalGradeType(g.type, g.subjectName)) {
        if (!group.finalGradeItem) {
          group.finalGradeItem = g;
        } else {
          group.others.push(g);
        }
      } else {
        group.others.push(g);
      }
    }

    const existingSubjects = new Set(
      [...grouped.keys()]
        .map((subject) => normalizePlanFilterString(subject))
        .filter(Boolean),
    );
    const hiddenKeys = new Set(hiddenGradesPlanSubjectKeys);

    for (const item of gradesPlanSubjectFilters) {
      if (!item.key || hiddenKeys.has(item.key)) continue;

      const subject = planSubjectFilterSubject(item);
      const normalizedSubject = normalizePlanFilterString(subject);
      if (!normalizedSubject || existingSubjects.has(normalizedSubject)) continue;

      grouped.set(subject, {
        subject,
        finalGradeItem: null,
        others: [],
        emptyFromPlanFilter: true,
      });
      existingSubjects.add(normalizedSubject);
    }

    return [...grouped.values()]
      .map((group) => {
        const items = [...group.others].sort((a, b) => {
          const aOrder = isFinalGradeType(a.type, a.subjectName) ? 0 : 1;
          const bOrder = isFinalGradeType(b.type, b.subjectName) ? 0 : 1;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return (a.type || '').localeCompare(b.type || '', 'pl');
        });

        const finalGrade = group.finalGradeItem?.grade?.trim() ? group.finalGradeItem.grade : '';
        const allItems = group.finalGradeItem ? [group.finalGradeItem, ...items] : items;
        const ects = allItems.reduce((max, item) => (item.weight > max ? item.weight : max), 0);
        return {
          subject: group.subject,
          items,
          finalGrade,
          ects,
          emptyFromPlanFilter: group.emptyFromPlanFilter,
        };
      })
      .filter((group) => group.items.length > 0 || group.finalGrade.trim() || group.emptyFromPlanFilter)
      .sort((a, b) => a.subject.localeCompare(b.subject, 'pl'));
  }, [effectiveVisibleGrades, gradesPlanSubjectFilters, hiddenGradesPlanSubjectKeys]);

  useEffect(() => {
    setExpandedGradeSubjects(prev => {
      const visibleSubjects = new Set(groupedGrades.map(group => group.subject));
      const next: Record<string, boolean> = {};
      let changed = false;

      for (const [subject, isOpen] of Object.entries(prev)) {
        if (isOpen && visibleSubjects.has(subject)) {
          next[subject] = true;
        } else {
          changed = true;
        }
      }

      if (!changed && Object.keys(next).length === Object.keys(prev).length) {
        return prev;
      }
      return next;
    });
  }, [groupedGrades]);

  const gradesSummary = useMemo(() => {
    let sumWeighted = 0;
    let sumWeights = 0;
    let usedFinal = false;

    for (const g of effectiveVisibleGrades) {
      if (!isFinalGradeType(g.type, g.subjectName)) continue;
      const v = parseGradeNum(g.grade);
      if (v === null) continue;

      usedFinal = true;
      const ects = g.weight > 0 ? g.weight : 0;
      if (ects <= 0) {
        sumWeighted += v;
        sumWeights += 1;
      } else {
        sumWeighted += v * ects;
        sumWeights += ects;
      }
    }

    if (!usedFinal) {
      sumWeighted = 0;
      sumWeights = 0;
      for (const g of effectiveVisibleGrades) {
        const v = parseGradeNum(g.grade);
        if (v === null) continue;

        const ects = g.weight > 0 ? g.weight : 0;
        if (ects <= 0) {
          sumWeighted += v;
          sumWeights += 1;
        } else {
          sumWeighted += v * ects;
          sumWeights += ects;
        }
      }
    }

    const avg = sumWeights > 0 ? fmtDec(sumWeighted / sumWeights, 2) : '-';
    const fallbackEcts = Math.max(0, sumUniqueEcts(effectiveVisibleGrades));
    return {
      avg,
      ectsSem: formatCreditMetric(credits?.programmeUsed, fallbackEcts),
      ectsTotal: formatCreditMetric(credits?.overallUsed, fallbackEcts),
    };
  }, [credits, effectiveVisibleGrades]);

  const links = useMemo(() => sortUsefulLinks(studies), [studies]);

  const planSubjectFilters = useMemo(() => {
    if (planResult?.subjectFilters?.length) {
      return planResult.subjectFilters;
    }

    const filterMap = new Map<string, PlanResult['subjectFilters'][number]>();
    for (const col of planResult?.dayColumns ?? []) {
      for (const ev of col.events) {
        const typeKey = getPlanEventFilterTypeKey(ev);
        if (!typeKey) continue;

        const key = getPlanEventFilterKey(ev);
        if (!key) continue;
        const subjectLabel = getPlanEventSubjectLabel(ev);
        const typeLabel = ev.typeLabel || '';
        const existing = filterMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          filterMap.set(key, {
            key,
            label: getPlanEventFilterLabel(ev),
            subjectLabel,
            typeKey,
            typeLabel,
            count: 1,
          });
        }
      }
    }
    return [...filterMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'pl'));
  }, [planResult]);

  const visiblePlanResult = useMemo(() => {
    if (!planResult) return null;
    return filterTimetable(planResult, hiddenPlanSubjectKeys);
  }, [planResult, hiddenPlanSubjectKeys]);

  const openScreen = useCallback((s: Exclude<ScreenKey, 'login' | 'news-detail'>) => {
    if (s === screen) {
      setDrawerOpen(false);
      return;
    }
    if (s === 'home') {
      nav.reset('home', undefined);
    } else {
      nav.navigateTo(s, 'home', undefined);
    }
    setDrawerOpen(false);
  }, [nav, screen]);

  const togglePlanSubjectFilter = useCallback((key: string) => {
    if (!currentPlanAlbum) return;

    const nextKeys = normalizePlanHiddenSubjectKeys(
      hiddenPlanSubjectKeys.includes(key)
        ? hiddenPlanSubjectKeys.filter((item) => item !== key)
        : [...hiddenPlanSubjectKeys, key],
    );

    setPlanHiddenSubjectsForAlbum(currentPlanAlbum, nextKeys);
    void persistPlanHiddenSubjects(currentPlanAlbum, nextKeys);
  }, [currentPlanAlbum, hiddenPlanSubjectKeys, persistPlanHiddenSubjects, setPlanHiddenSubjectsForAlbum]);

  const resetPlanSubjectFilters = useCallback(() => {
    if (!currentPlanAlbum) return;
    setPlanHiddenSubjectsForAlbum(currentPlanAlbum, []);
    void persistPlanHiddenSubjects(currentPlanAlbum, []);
  }, [currentPlanAlbum, persistPlanHiddenSubjects, setPlanHiddenSubjectsForAlbum]);

  const handlePlanExport = useCallback(() => {
    if (!session) return;

    const run = async () => {
      setPlanMoreMenuOpen(false);
      setGlobalError('');
      setGlobalLoad(true);

      try {
        const semesterPlan = await fetchPlanSemesterExport(session, {
          currentDate: planDate,
          studyId: activeStudyId,
          search: { category: planSearchCat, query: planSearchQ.trim() },
        });

        const exportPlan = hiddenPlanSubjectKeys.length
          ? {
            ...semesterPlan,
            dayColumns: semesterPlan.dayColumns.map((column) => ({
              ...column,
              events: column.events.filter((event) => !hiddenPlanSubjectKeys.includes(getPlanEventFilterKey(event))),
            })),
            hasAnyEventsInRange: semesterPlan.dayColumns.some((column) => (
              column.events.some((event) => !hiddenPlanSubjectKeys.includes(getPlanEventFilterKey(event)))
            )),
          }
          : semesterPlan;

        if (!exportPlanToIcs(exportPlan)) {
          setGlobalError('Brak zajęć do eksportu w całym semestrze.');
          return;
        }

        showToast('Wyeksportowano cały semestr do pliku ICS');
      } catch (error) {
        if (!handleSessionError(error)) {
          showGlobalError(error, 'Nie udało się wyeksportować planu.');
        }
      } finally {
        setGlobalLoad(false);
      }
    };

    void run();
  }, [
    activeStudyId,
    handleSessionError,
    hiddenPlanSubjectKeys,
    planDate,
    planSearchCat,
    planSearchQ,
    session,
    showGlobalError,
    showToast,
  ]);

  // ── AppBar logic ──────────────────────────────────────────────────────────
  const onNavIcon = () => setDrawerOpen(true);

  // ── Drawer items ──────────────────────────────────────────────────────────
  const drawerItems: Array<{ key: DrawerScreenKey; label: string; icon: string }> = [
    { key: 'home', label: t('drawer.home'), icon: 'home' },
    { key: 'plan', label: t('drawer.plan'), icon: 'calendar' },
    { key: 'grades', label: t('drawer.grades'), icon: 'grade' },
    { key: 'finance', label: t('drawer.finance'), icon: 'wallet' },
    { key: 'info', label: t('drawer.info'), icon: 'user' },
    { key: 'news', label: t('drawer.news'), icon: 'news' },
    ...(canOpenStats ? [{ key: 'stats' as const, label: t('drawer.stats'), icon: 'stats' }] : []),
    { key: 'links', label: t('drawer.links'), icon: 'link' },
    { key: 'settings', label: t('drawer.settings'), icon: 'settings' },
    { key: 'about', label: t('drawer.about'), icon: 'about' },
  ];
  const moreDrawerItems = drawerItems.filter((item) => !['home', 'plan', 'info', 'grades'].includes(item.key));

  // ─────────────────────────────────────────────────────── render screens ──

  function renderLogin() {
    return (
      <LoginScreen
        t={t}
        loginLoading={globalLoading}
        onUsosLogin={async () => {
          setGlobalLoad(true);
          try {
            const callbackUrl = window.location.origin + window.location.pathname;
            const { oauth_token, oauth_token_secret } = await fetchUsosRequestToken(callbackUrl);
            sessionStorage.setItem('usos_request_token_secret', oauth_token_secret);
            window.location.href = `https://usosapi.zut.edu.pl/services/oauth/authorize?oauth_token=${oauth_token}`;
          } catch (e) {
            showGlobalError(e, 'Błąd inicjacji USOS.');
            setGlobalLoad(false);
          }
        }}
      />
    );
  }

  function renderHome() {
    const activeStudyLabel = studies.find((study) => study.przynaleznoscId === activeStudyId)?.label
      ?? studies[0]?.label
      ?? '';
    return <HomeScreen key={session?.userId} session={session} studyLabel={activeStudyLabel} t={t} openScreen={openScreen}
      onSearch={(query) => { openScreen('plan'); applyPlanSearch('teacher', query); }} />;
  }

  const navigatePlan = (date: string) => setPlanDate(date);

  function renderPlan() {
    return <PlanScreen result={visiblePlanResult} viewMode={planViewMode} date={planDate}
      window={planWindow} hiddenSubjectKeys={hiddenPlanSubjectKeys}
      loading={planLoading} compact={settings.compactPlan} language={settings.language} t={t}
      onMode={setPlanViewMode} onNavigate={navigatePlan} onSelect={setSelectedPlanEvent}
      onExport={handlePlanExport} />;
  }

  function renderGrades() {
    return (
      <GradesScreen
        t={t}
        gradesSummary={gradesSummary}
        gradesLoading={gradesLoading}
        grades={effectiveVisibleGrades}
        settings={settings}
        groupedGrades={groupedGrades}
        expandedGradeSubjects={expandedGradeSubjects}
        setExpandedGradeSubjects={setExpandedGradeSubjects}
      />
    );
  }

  function renderFinance() {
    return (
      <FinanceScreen
        t={t}
        language={settings.language}
        studies={studies}
        activeStudyId={activeStudyId}
        updateActiveStudy={updateActiveStudy}
        financeRecords={financeSnapshot.records}
        financeLoading={financeLoading}
        financeFetchedAt={financeSnapshot.fetchedAt}
        onRefresh={() => void loadFinanceData(true)}
        onToast={showToast}
      />
    );
  }

  function renderInfo() {
    return (
      <InfoScreen
        session={session}
        studies={studies}
        activeStudyId={activeStudyId}
        updateActiveStudy={updateActiveStudy}
        studentPhotoBlobUrl={studentPhotoBlobUrl}
        studentPhotoError={studentPhotoError}
        t={t}
        infoLoading={infoLoading}
        details={details}
        history={history}
        els={els}
        calendarEvents={calendarEvents}
        credits={credits}
        onRefresh={() => void loadInfoData(true)}
      />
    );
  }
  function renderNews() {
    return (
      <NewsScreen
        newsLoading={newsLoading}
        news={news}
        t={t}
        onOpenDetail={(item) => nav.navigateTo('news-detail', 'news', { item } as unknown as NewsDetailParams)}
      />
    );
  }

  function renderNewsDetail() {
    const p = (nav.current.params ?? {}) as NewsDetailParams;
    return <NewsDetailScreen key={p.item?.id ?? 'empty-news'} item={p.item} t={t} galleryBackRef={newsGalleryBackRef} />;
  }

  function renderLinks() {
    return <LinksScreen links={links} t={t} />;
  }

  function renderStats() {
    return (
      <StatsScreen
        snapshot={statsSnapshot}
        statsLoading={statsLoading}
        statsError={statsError}
        language={settings.language}
        t={t}
        onRefresh={() => loadStatsData(true)}
      />
    );
  }

  function renderSettings() {
    return <SettingsScreen settings={settings} setSettings={setSettings} t={t} />;
  }

  function renderAbout() {
    return <AboutScreen canOfferInstall={pwaInstall.canOfferInstall} handleInstallPwa={pwaInstall.install} installBusy={pwaInstall.busy} installDescription={t(`install.target.${pwaInstall.platform.kind}`)} t={t} />;
  }

  function renderPlanEventSheet() {
    if (screen !== 'plan') return null;
    return (
      <PlanEventSheet
        selectedPlanEvent={selectedPlanEvent}
        onClose={() => setSelectedPlanEvent(null)}
        language={settings.language}
        onQuickSearch={applyPlanSearch}
      />
    );
  }

  function renderPlanSearchSheet() {
    if (screen !== 'plan' || !planSearchOpen) return null;
    return (
      <PlanSearchSheet
        planSearchOpen={planSearchOpen}
        initialSearch={planSearchSeed}
        planSearchCat={planSearchCat}
        setPlanSearchCat={setPlanSearchCat}
        planSearchQ={planSearchQ}
        setPlanSearchQ={setPlanSearchQ}
        planSearchSuggestions={planSearchSuggestions}
        setPlanSearchSuggestions={setPlanSearchSuggestions}
        planSearchLoading={planSearchLoading}
        planSearchDebounceRef={planSearchDebounceRef}
        fetchPlanSearchSuggestions={fetchPlanSearchSuggestions}
        loadPlanData={loadPlanData}
        setPlanSearchOpen={setPlanSearchOpen}
        t={t}
      />
    );
  }

  function renderPlanFiltersSheet() {
    if (screen !== 'plan') return null;
    return (
      <PlanFiltersSheet
        open={planFiltersOpen}
        options={planSubjectFilters}
        hiddenKeys={hiddenPlanSubjectKeys}
        onToggle={togglePlanSubjectFilter}
        onReset={resetPlanSubjectFilters}
        onClose={() => setPlanFiltersOpen(false)}
      />
    );
  }

  function renderScreen() {
    switch (screen) {
      case 'login': return renderLogin();
      case 'home': return renderHome();
      case 'plan': return renderPlan();
      case 'grades': return renderGrades();
      case 'finance': return renderFinance();
      case 'info': return renderInfo();
      case 'news': return renderNews();
      case 'news-detail': return renderNewsDetail();
      case 'stats': return renderStats();
      case 'links': return renderLinks();
      case 'settings': return renderSettings();
      case 'about': return renderAbout();
      default: return null;
    }
  }

  // ── AppBar action buttons ─────────────────────────────────────────────────
  function renderAppBarActions() {
    if (screen === 'login') return null;
    const actions: Array<{ key: string; icon: string; label: string; onClick: () => void; active: boolean; disabled?: boolean }> = [];
    const planMenuActions: Array<{ key: string; icon: string; label: string; note: string; onClick: () => void; active: boolean }> = [];

    if (screen === 'plan') {
      const isTodayActive = planDate === todayYmd() && !planSearchQ?.trim();
      const hasExcludedSubjects = hiddenPlanSubjectKeys.length > 0;
      const activeSearchQuery = planSearchQ.trim();

      actions.push({
        key: 'search',
        icon: 'search',
        label: t('plan.search'),
        onClick: () => {
          setPlanMoreMenuOpen(false);
          setPlanFiltersOpen(false);
          setPlanSearchSeed(undefined);
          setPlanSearchOpen((p) => !p);
        },
        active: planSearchOpen,
      });
      actions.push({
        key: 'refresh',
        icon: 'refresh',
        label: t('plan.refresh'),
        onClick: () => {
          setPlanMoreMenuOpen(false);
          void loadPlanData(
            activeSearchQuery ? { category: planSearchCat, query: activeSearchQuery } : undefined,
            true,
          );
        },
        active: false,
      });

      planMenuActions.push({
        key: 'today',
        icon: 'calendar',
        label: t('plan.today'),
        note: planSearchQ.trim()
          ? 'Wraca do bieżącej daty i czyści wyszukiwanie'
          : isTodayActive
            ? 'Jesteś już na dzisiejszym planie'
            : 'Skok do bieżącego dnia',
        onClick: () => {
          const td = todayYmd();
          setPlanSearchOpen(false);
          if (activeSearchQuery) {
            setPlanSearchQ('');
            setPlanSearchCat('album');
            if (planDate !== td) {
              setPlanDate(td);
            } else {
              void loadPlanData({ category: 'album', query: '' });
            }
            return;
          }

          if (planDate !== td) {
            setPlanDate(td);
          }
        },
        active: isTodayActive,
      });
      planMenuActions.push({
        key: 'filters',
        icon: 'layers',
        label: 'Wyklucz przedmioty',
        note: hasExcludedSubjects
          ? `Wykluczono: ${hiddenPlanSubjectKeys.length}`
          : 'Ukryj wybrane pozycje z widoku planu',
        onClick: () => {
          setPlanSearchOpen(false);
          setPlanFiltersOpen((p) => !p);
        },
        active: planFiltersOpen || hasExcludedSubjects,
      });
      planMenuActions.push({
        key: 'export',
        icon: 'download',
        label: 'Eksport semestru',
        note: 'Pobiera cały semestr do pliku ICS',
        onClick: () => {
          handlePlanExport();
        },
        active: false,
      });
    } else if (screen === 'home') {
      if (pwaInstall.canOfferInstall) actions.push({ key: 'install', icon: 'install', label: t('install.action'), onClick: () => void pwaInstall.install(), active: false, disabled: pwaInstall.busy });
    } else if (screen === 'grades') {
      actions.push({
        key: 'refresh',
        icon: 'refresh',
        label: t('grades.refreshLabel'),
        onClick: () => {
          void loadGradesData(true).then(() => loadGradesPlanFilters(true));
        },
        active: false,
      });
    } else if (screen === 'news') {
      actions.push({ key: 'refresh', icon: 'refresh', label: t('plan.refresh'), onClick: () => void loadNewsData(true), active: false });
    } else if (screen === 'stats') {
      actions.push({ key: 'refresh', icon: 'refresh', label: t('stats.refresh'), onClick: () => void loadStatsData(true), active: statsLoading });
    }

    const hasSearchFilter = screen === 'plan' && !!planSearchQ.trim();
    const hasExcludedFilter = screen === 'plan' && hiddenPlanSubjectKeys.length > 0;
    const activeFilterCount = (hasSearchFilter ? 1 : 0) + hiddenPlanSubjectKeys.length;

    const handleClearAllFilters = () => {
      if (hasSearchFilter) {
        setPlanSearchQ('');
        setPlanSearchSuggestions([]);
        setPlanSearchLoading(false);
        setPlanSearchOpen(false);
      }
      if (hasExcludedFilter) {
        resetPlanSubjectFilters();
      }
      if (hasSearchFilter) {
        void loadPlanData({ category: planSearchCat, query: '' });
      }
    };

    return (
      <div className={`appbar-actions${screen === 'plan' ? ' plan-appbar-actions' : ''}`}>
        {screen === 'grades' && (
          <div className="grades-grouping-toggle">
            <button
              type="button"
              className={`grades-toggle-compact ${settings.gradesGrouping ? 'active' : ''}`}
              onClick={() => setSettings(prev => ({ ...prev, gradesGrouping: !prev.gradesGrouping }))}
              title={settings.gradesGrouping ? t('grades.disableGrouping') : t('grades.enableGrouping')}
              aria-label={t('grades.groupToggle')}
            >
              <Ic n="group" />
            </button>
          </div>
        )}
        
        {screen === 'plan' && activeFilterCount > 0 && (
          <div className="appbar-filter-chip-wrapper">
            <button
              type="button"
              className="plan-filter-chip appbar-filter-chip"
              onClick={handleClearAllFilters}
              title="Wyczyść wszystkie filtry"
            >
              <span className="plan-filter-chip-icon"><Ic n="filter" /></span>
              {hasSearchFilter && (
                <span className="plan-filter-chip-label">{planSearchQ.trim()}</span>
              )}
              <span className="plan-filter-chip-badge">{activeFilterCount}</span>
              <span className="plan-filter-chip-clear"><Ic n="x" /></span>
            </button>
          </div>
        )}

        {actions.map(a => (
          <button key={a.key} type="button" className={`icon-btn ${a.active ? 'active' : ''}`} onClick={a.onClick} disabled={a.disabled} aria-label={a.label} title={a.label}>
            <Ic n={a.icon} />
          </button>
        ))}
        {screen === 'plan' && (
          <div className="plan-menu-anchor" ref={planMoreMenuRef}>
            <button
              type="button"
              className={`icon-btn ${planMoreMenuOpen || hiddenPlanSubjectKeys.length > 0 ? 'active' : ''}`}
              onClick={() => setPlanMoreMenuOpen((prev) => !prev)}
              aria-label="Więcej opcji planu"
              title="Więcej opcji planu"
              aria-haspopup="menu"
              aria-expanded={planMoreMenuOpen}
            >
              <Ic n="more" />
            </button>
            {planMoreMenuOpen && (
              <div className="plan-overflow-menu" role="menu" aria-label="Więcej opcji planu">
                {planMenuActions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    className={`plan-overflow-item${action.active ? ' active' : ''}`}
                    onClick={() => {
                      setPlanMoreMenuOpen(false);
                      action.onClick();
                    }}
                    role="menuitem"
                  >
                    <span className="plan-overflow-icon" aria-hidden>
                      <Ic n={action.icon} />
                    </span>
                    <span className="plan-overflow-copy">
                      <span className="plan-overflow-label">{action.label}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────── render ──────────────────

  return (
    <div
      className={`app-shell${screen === 'login' ? ' is-login' : ''}${screen === 'plan' ? ' is-plan' : ''}${drawerOpen ? ' has-more-open' : ''}`}
      onTouchStart={swipe.onTouchStart}
      onTouchMove={swipe.onTouchMove}
      onTouchEnd={swipe.onTouchEnd}
      onTouchCancel={swipe.onTouchCancel}
    >
      {/* AppBar */}
      {screen !== 'login' && (
        screen === 'plan' ? (
          <header className="android-appbar plan-appbar">
            <div className="appbar-heading plan-appbar-heading">
              <h1>{t(SCREEN_I18N_KEY[screen])}</h1>
              <span>{planLoading && <LoadingIndicator className="sync-indicator" />}{planLoading ? (settings.language === 'en' ? 'Syncing timetable…' : 'Synchronizacja planu…') : formatDataUpdatedAt(planUpdatedAt, settings.language)}</span>
            </div>
            <div className="plan-appbar-range" aria-live="polite" aria-atomic="true">{visiblePlanResult?.headerLabel || planDate}</div>
            {renderAppBarActions()}
          </header>
        ) : (
          <header className="android-appbar">
            <button type="button" className={`icon-btn appbar-nav-btn${screen === 'news-detail' ? ' is-back' : ''}`} onClick={screen === 'news-detail' ? () => nav.goBack() : onNavIcon} aria-label={screen === 'news-detail' ? t('general.back') : t('general.openMenu')}>
              <Ic n={screen === 'news-detail' ? 'back' : 'menu'} />
            </button>
            {screen === 'grades' ? (
              <div className="appbar-heading">
                <h1>{t(SCREEN_I18N_KEY[screen])}</h1>
                <span>{gradesLoading && <LoadingIndicator className="sync-indicator" />}{formatDataUpdatedAt(gradesUpdatedAt, settings.language)}</span>
              </div>
            ) : (
              <h1>{t(SCREEN_I18N_KEY[screen])}</h1>
            )}
            {renderAppBarActions()}
          </header>
        )
      )}

      {/* Global loading / error banners */}
      {(globalLoading || globalError) && (
        <div className={`notification-rail${screen === 'login' ? ' is-login' : ''}`} aria-live="polite" aria-atomic="true">
          <div className="notification-stack">
            {globalLoading && (
              <div className="banner banner-loading" role="status">
                <LoadingIndicator />
                <div className="banner-copy">
                  <span className="banner-title">{t('banner.loading')}</span>
                </div>
              </div>
            )}
            {globalError && (
              <div className="banner error" role="alert">
                <span className="banner-icon" aria-hidden="true">!</span>
                <div className="banner-copy">
                  <span className="banner-kicker">Nie udało się pobrać danych</span>
                  <span className="banner-title">{globalError}</span>
                </div>
                {sessionExpiryHandledRef.current && <button type="button" className="banner-retry" onClick={() => { saveSession(null); setSession(null); setGlobalError(''); }}>Zaloguj</button>}
              <button type="button" className="banner-retry" onClick={() => setGlobalError('')}>Zamknij</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <main ref={mainRef} data-screen={screen}>
        <Suspense fallback={<ScreenChunkFallback screen={screen} gradesSummary={gradesSummary} t={t} />}>
          {renderScreen()}
        </Suspense>
      </main>

      {screen !== 'login' && screen !== 'news-detail' && (
        <AppNavigation
          screen={screen}
          t={t}
          openScreen={openScreen}
          moreOpen={drawerOpen}
          onMore={() => setDrawerOpen((open) => !open)}
        />
      )}

      {!isOnline && screen !== 'login' && <div className="offline-indicator" role="status"><Ic n="wifi-off" />{settings.language === 'en' ? 'Offline · saved data' : 'Offline · zapisane dane'}</div>}
      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
      <PwaUpdateNotice />
      {installGuideOpen && <PwaInstallSheet platform={pwaInstall.platform} onClose={closeInstallGuide} t={t} />}

      {renderPlanEventSheet()}
      {renderPlanSearchSheet()}
      {renderPlanFiltersSheet()}

      {screen !== 'login' && drawerOpen && <Sheet title={t('nav.more')} onClose={() => setDrawerOpen(false)} className="more-sheet" bottomSlide headingAside={<span className="more-sheet-version">PWA</span>}>
        <nav className="drawer-list" aria-label={t('nav.more')}>
          {moreDrawerItems.filter((item) => item.key !== 'settings').map((item) => <button key={item.key} type="button" className={`drawer-item ${screen === item.key ? 'active' : ''}`} onClick={() => openScreen(item.key)}><span className="drawer-item-icon"><Ic n={item.icon} /></span><span className="drawer-item-label">{item.label}</span><Ic n="chevR" /></button>)}
        </nav>
        <div className="drawer-footer">
          <button type="button" className={`drawer-item ${screen === 'settings' ? 'active' : ''}`} onClick={() => openScreen('settings')}><span className="drawer-item-icon"><Ic n="settings" /></span><span className="drawer-item-label">{t('drawer.settings')}</span><Ic n="chevR" /></button>
          <button type="button" className="drawer-item drawer-logout" onClick={() => { if (window.confirm(t('logout.confirm'))) { applySession(null); setDrawerOpen(false); } }}><span className="drawer-item-icon"><Ic n="logout" /></span><span className="drawer-item-label">{t('logout.button')}</span></button>
        </div>
      </Sheet>}

    </div>
  );
}

export default App;
