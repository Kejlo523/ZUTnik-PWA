import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
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
  SessionPeriod,
  StatsSnapshot,
  Study,
  StudyDetails,
  StudyHistoryItem,
  SurveyItem,
  ViewMode,
} from './types';
import {
  buildPlanResultFromWindow,
  fetchCombinedGrades,
  fetchCombinedStudies,
  fetchCreditSummary,
  fetchCurrentPlanSubjectFilters,
  fetchFinance,
  fetchInfo,
  fetchNews,
  fetchPlanHiddenSubjects,
  fetchPlanSemesterExport,
  fetchPlanSuggestions,
  fetchPlanWindow,
  fetchStatsSnapshot,
  fetchStudentPhotoBlob,
  fetchSurveysToFill,
  fetchUsosRequestToken,
  getFriendlyErrorMessage,
  isSessionExpiredError,
  loginWithUsos,
  savePlanHiddenSubjects as savePlanHiddenSubjectsByAlbum,
  type PlanWindowData,
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
  type AppSettings,
} from './services/storage';
import { sortUsefulLinks } from './constants/usefulLinks';
import { useAppNavigation, useExitAttemptToast } from './hooks/useAppNavigation';
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
import { relayoutDayEvents } from './app/planLayout';
import { LOGO_SRC, MONTH_WEEKDAY_KEYS, SCREEN_I18N_KEY } from './app/constants';
import {
  addDaysYmd,
  extractGradeBaseSubject,
  fmtDateLabel,
  fmtDayMonth,
  fmtDec,
  fmtHour,
  gradeMatchesHiddenPlanFilter,
  fmtWeekdayShort,
  getSessionSignature,
  isFinalGradeType,
  isWeekendDate,
  parseGradeNum,
  planSubjectFilterSubject,
  planCacheKey,
  sumUniqueEcts,
  todayYmd,
} from './app/helpers';
import { Ic, Skeleton } from './app/ui';
import type { DrawerScreenKey, NewsDetailParams, SelectedPlanEvent } from './app/viewTypes';
import { HomeScreen, LoginScreen } from './app/screens/AuthScreens';
import { AboutScreen, LinksScreen, NewsDetailScreen, NewsScreen, SettingsScreen, StatsScreen } from './app/screens/ContentScreens';
import { PlanEventSheet, PlanFiltersSheet, PlanSearchSheet } from './app/screens/PlanOverlays';
import { FinanceScreen, GradesScreen, InfoScreen } from './app/screens/StudyScreens';

const SESSION_VALIDATE_INTERVAL_MS = 30 * 24 * 60 * 60_000;
const EMPTY_FINANCE_SNAPSHOT: FinanceSnapshot = { records: [], fetchedAt: 0 };
const PLAN_PREFETCH_DAYS_BACK = 7;
const PLAN_PREFETCH_DAYS_FORWARD = 21;
const STATS_OWNER_ALBUM = '57796';
const PHONE_VIEWPORT_MAX_SIDE = 700;
const PHONE_VIEWPORT_SCALE_FIX_RATIO = 1.35;
const PHONE_VIEWPORT_MAX_SCALE_FIX = 3;

interface PhoneViewportState {
  isPhone: boolean;
  needsScaleFix: boolean;
  scale: number;
  width: number;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

interface BeforeInstallPromptChoiceResult {
  outcome: 'accepted' | 'dismissed';
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void> | void;
  userChoice: Promise<BeforeInstallPromptChoiceResult>;
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

function parsePlanDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function addPlanDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatPlanDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

function getPositiveViewportNumbers(values: Array<number | undefined>): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function getSmallestViewportSide(): number {
  const deviceValues = getPositiveViewportNumbers([
    window.screen?.width,
    window.screen?.height,
    window.screen?.availWidth,
    window.screen?.availHeight,
  ]);
  if (deviceValues.length) {
    return Math.min(...deviceValues);
  }

  const viewportValues = getPositiveViewportNumbers([
    window.visualViewport?.width,
    window.visualViewport?.height,
    window.innerWidth,
    window.innerHeight,
    document.documentElement.clientWidth,
    document.documentElement.clientHeight,
  ]);

  return viewportValues.length ? Math.min(...viewportValues) : window.innerWidth;
}

function getPhoneViewportState(): PhoneViewportState {
  const hasTouch = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
  const isPhone = hasTouch && getSmallestViewportSide() <= PHONE_VIEWPORT_MAX_SIDE;
  const screenWidths = getPositiveViewportNumbers([
    window.screen?.width,
    window.screen?.availWidth,
  ]);
  const layoutWidths = getPositiveViewportNumbers([
    document.documentElement.clientWidth,
    window.innerWidth,
    window.visualViewport?.width,
  ]);
  const viewportScale = window.visualViewport?.scale;
  const hasViewportScale = typeof viewportScale === 'number' && Number.isFinite(viewportScale) && viewportScale > 0;
  const screenWidth = Math.max(1, Math.round(screenWidths.length ? Math.min(...screenWidths) : window.innerWidth));
  const layoutWidth = layoutWidths.length ? Math.max(...layoutWidths) : screenWidth;
  const rawScale = screenWidth > 0 ? layoutWidth / screenWidth : 1;
  const isZoomedOutLayout = hasViewportScale ? viewportScale < 0.95 : layoutWidth >= 900;
  const needsScaleFix = isPhone && rawScale >= PHONE_VIEWPORT_SCALE_FIX_RATIO && isZoomedOutLayout;
  const scaleSource = hasViewportScale ? 1 / viewportScale : rawScale;
  const scale = needsScaleFix ? Math.min(PHONE_VIEWPORT_MAX_SCALE_FIX, Math.round(scaleSource * 100) / 100) : 1;
  const width = Math.max(1, Math.round(needsScaleFix ? layoutWidth / scale : screenWidth));

  return { isPhone, needsScaleFix, scale, width };
}

function arePhoneViewportStatesEqual(left: PhoneViewportState, right: PhoneViewportState): boolean {
  return left.isPhone === right.isPhone
    && left.needsScaleFix === right.needsScaleFix
    && left.scale === right.scale
    && left.width === right.width;
}

function applyPhoneViewportCss(state: PhoneViewportState): void {
  const root = document.documentElement;
  root.classList.toggle('phone-scale-fix', state.needsScaleFix);
  if (state.needsScaleFix) {
    root.style.setProperty('--phone-viewport-scale', String(state.scale));
    root.style.setProperty('--phone-viewport-width', `${state.width}px`);
    return;
  }

  root.style.removeProperty('--phone-viewport-scale');
  root.style.removeProperty('--phone-viewport-width');
}

function applyThemePreference(theme: AppSettings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
    return;
  }
  root.dataset.theme = theme;
}

function resolvePlanVisibleRange(viewMode: ViewMode, currentDateText: string): { rangeStart: string; rangeEnd: string } {
  const current = parsePlanDate(currentDateText);

  if (viewMode === 'day') {
    const ymd = formatPlanDate(current);
    return { rangeStart: ymd, rangeEnd: ymd };
  }

  if (viewMode === 'month') {
    return {
      rangeStart: formatPlanDate(new Date(current.getFullYear(), current.getMonth(), 1)),
      rangeEnd: formatPlanDate(new Date(current.getFullYear(), current.getMonth() + 1, 0)),
    };
  }

  const dayOfWeek = current.getDay() || 7;
  const rangeStart = addPlanDays(current, -(dayOfWeek - 1));
  return {
    rangeStart: formatPlanDate(rangeStart),
    rangeEnd: formatPlanDate(addPlanDays(rangeStart, 6)),
  };
}

function doesPlanWindowCoverView(planWindow: PlanWindowData, viewMode: ViewMode, currentDateText: string): boolean {
  const { rangeStart, rangeEnd } = resolvePlanVisibleRange(viewMode, currentDateText);
  return planWindow.rangeStart <= rangeStart && planWindow.rangeEnd >= rangeEnd;
}

function buildPlanWindowCacheKey(studyId: string | null, search: { category: string; query: string }): string {
  const query = search.query.trim();
  if (query) {
    const category = (search.category || 'album').trim().toLowerCase() || 'album';
    return `search:${category}:${query.toLowerCase()}`;
  }
  return `study:${studyId ?? 'nostudy'}`;
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
  const [phoneViewport, setPhoneViewport] = useState<PhoneViewportState>(() => getPhoneViewportState());
  const sessionKey = getSessionSignature(session);
  const sessionExpiryHandledRef = useRef(false);
  const sessionCheckInFlightRef = useRef<Promise<boolean> | null>(null);
  const lastSessionCheckRef = useRef<{ key: string; ts: number }>({ key: '', ts: 0 });
  const activeSessionKeyRef = useRef(sessionKey);
  const overlayBackAttemptRef = useRef<(() => boolean) | null>(null);
  const rootBackAttemptRef = useRef<(() => boolean) | null>(null);
  const phoneViewportRafRef = useRef<number | null>(null);
  const phoneViewportTimerRefs = useRef<number[]>([]);

  const nav = useAppNavigation<ScreenKey>(session ? 'home' : 'login', {
    onBackAttemptRef: overlayBackAttemptRef,
    onRootBackAttemptRef: rootBackAttemptRef,
  });
  const screen = nav.current.key;
  const statsDeepLinkHandledRef = useRef(false);

  const [drawerOpen, setDrawerOpen] = useState(false);

  // PWA install prompt
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstallPwa, setCanInstallPwa] = useState(false);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as NavigatorWithStandalone).standalone === true;
  // iOS Safari detection — beforeinstallprompt never fires on iOS
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIosSafari = isIos
    && /safari/i.test(navigator.userAgent)
    && !/crios|fxios|chrome|chromium/i.test(navigator.userAgent);
  // On iOS Safari user installs manually via Share sheet — we can offer instructions
  const canOfferInstall = !isStandalone && (canInstallPwa || isIosSafari);

  const INSTALL_TIP_KEY = 'zutnik_install_tip_v1';
  const [showInstallTip, setShowInstallTip] = useState(false);
  const [installTipFading, setInstallTipFading] = useState(false);
  const [showIosInstructions, setShowIosInstructions] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setCanInstallPwa(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setCanInstallPwa(false); deferredPromptRef.current = null; });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPwa = async () => {
    if (isIosSafari) {
      setShowIosInstructions(true);
      return;
    }
    const prompt = deferredPromptRef.current;
    if (!prompt?.prompt) return;
    await prompt.prompt();
    const result = await prompt.userChoice;
    if (result?.outcome === 'accepted') {
      setCanInstallPwa(false);
      deferredPromptRef.current = null;
    }
  };

  // Plan
  const [planViewMode, setPlanViewMode] = useState<ViewMode>('week');
  const [planDate, setPlanDate] = useState(todayYmd);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
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

  // Plan carousel swipe (direct DOM animation — no React state per frame)
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const planDragRef = useRef<{ startX: number; startY: number; startTime: number; locked: boolean } | null>(null);

  // Now line — current time indicator
  const [nowMinute, setNowMinute] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  // Grades
  const [grades, setGrades] = useState<Grade[]>([]);
  const [gradesLoading, setGradesLoad] = useState(false);
  const [gradesPlanAlbum, setGradesPlanAlbum] = useState('');
  const [gradesPlanSubjectFilters, setGradesPlanSubjectFilters] = useState<PlanResult['subjectFilters']>([]);
  const [expandedGradeSubjects, setExpandedGradeSubjects] = useState<Record<string, boolean>>({});
  const gradesRef = useRef<Grade[]>([]);
  const creditsRef = useRef<CreditSummary | null>(null);
  const planRequestIdRef = useRef<string>('');
  const planWindowCacheRef = useRef<Record<string, PlanWindowData>>({});
  const planWindowRequestsRef = useRef<Record<string, Promise<PlanWindowData>>>({});
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
  const [surveys, setSurveys] = useState<SurveyItem[]>([]);
  const [surveysMissingScopes, setSurveysMissingScopes] = useState<string[]>([]);
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
  const sessionScopes = useMemo(() => session?.usos?.scopes ?? [], [session?.usos?.scopes]);
  const effectiveSurveysMissingScopes = useMemo(() => {
    const missing = new Set(surveysMissingScopes);
    if (session && !sessionScopes.includes('surveys_filling')) missing.add('surveys_filling');
    return [...missing];
  }, [surveysMissingScopes, session, sessionScopes]);
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

  // ── Now line timer (update every minute) ───────────────────────────────
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setNowMinute(n.getHours() * 60 + n.getMinutes());
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Session inactivity timeout (30 days, without overflowing setTimeout) ─
  useEffect(() => {
    if (!session) return;
    const SESSION_TIMEOUT = 30 * 24 * 60 * 60 * 1000; // 30 days
    const CHECK_INTERVAL = 60_000; // 1 minute
    let lastActivityTs = Date.now();

    const touchActivity = () => {
      lastActivityTs = Date.now();
    };

    const checkInactivity = () => {
      if (Date.now() - lastActivityTs >= SESSION_TIMEOUT) {
        setSession(null);
        setToast('Sesja wygasła, zaloguj się ponownie');
      }
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(event => window.addEventListener(event, touchActivity));

    const intervalId = window.setInterval(checkInactivity, CHECK_INTERVAL);
    touchActivity();

    return () => {
      window.clearInterval(intervalId);
      events.forEach(event => window.removeEventListener(event, touchActivity));
    };
  }, [session]);

  // ── Student photo loading via fetch (avoids CORS / cache issues) ────────
  const [studentPhotoBlobUrl, setStudentPhotoBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    setStudentPhotoError(false);
    setStudentPhotoBlobUrl(null);

    if (!session?.usos) return;

    let cancelled = false;
    let createdBlobUrl: string | null = null;
    (async () => {
      try {
        const blob = await fetchStudentPhotoBlob(session);
        if (cancelled) return;
        if (!blob || blob.size === 0) { setStudentPhotoError(true); return; }
        const blobUrl = URL.createObjectURL(blob);
        createdBlobUrl = blobUrl;
        setStudentPhotoBlobUrl(blobUrl);
      } catch {
        if (!cancelled) setStudentPhotoError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
  }, [session, sessionKey]);

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
    const normalizedAlbum = album.trim();
    if (!normalizedAlbum) return [];

    try {
      const legacyKeys = loadLegacyPlanHiddenSubjects();
      let keys = await fetchPlanHiddenSubjects(normalizedAlbum);
      if (!keys.length && legacyKeys.length) {
        keys = await savePlanHiddenSubjectsByAlbum(normalizedAlbum, legacyKeys);
      }
      if (legacyKeys.length) {
        clearLegacyPlanHiddenSubjects();
      }
      return normalizePlanHiddenSubjectKeys(keys);
    } catch (error) {
      console.warn(`Failed to load plan hidden subjects for album ${normalizedAlbum}`, error);
      const existingKeys = planHiddenSubjectKeysByAlbumRef.current[normalizedAlbum];
      if (existingKeys?.length) {
        return existingKeys;
      }
      return normalizePlanHiddenSubjectKeys(loadLegacyPlanHiddenSubjects());
    }
  }, []);

  const persistPlanHiddenSubjects = useCallback(async (album: string, keys: string[]) => {
    const normalizedAlbum = album.trim();
    if (!normalizedAlbum) return;

    try {
      const savedKeys = await savePlanHiddenSubjectsByAlbum(normalizedAlbum, keys);
      setPlanHiddenSubjectsForAlbum(normalizedAlbum, savedKeys);
    } catch (error) {
      console.warn(`Failed to save plan hidden subjects for album ${normalizedAlbum}`, error);
      showToast('Nie udało się zapisać wykluczeń przedmiotów');
    }
  }, [setPlanHiddenSubjectsForAlbum, showToast]);

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
    if (statsDeepLinkHandledRef.current || !session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('screen') !== 'stats') return;

    statsDeepLinkHandledRef.current = true;
    params.delete('screen');
    const nextSearch = params.toString();
    window.history.replaceState(
      { zutnik: true, ts: Date.now() },
      '',
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
    );

    if (canOpenStats) {
      nav.reset('stats', undefined);
    }
  }, [canOpenStats, nav, session]);

  useEffect(() => {
    activeSessionKeyRef.current = sessionKey;
    sessionExpiryHandledRef.current = false;
    planWindowCacheRef.current = {};
    planWindowRequestsRef.current = {};
    planRequestIdRef.current = '';
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

  const refreshPhoneViewport = useCallback(() => {
    const next = getPhoneViewportState();
    applyPhoneViewportCss(next);
    setPhoneViewport((current) => (arePhoneViewportStatesEqual(current, next) ? current : next));
  }, []);

  const schedulePhoneViewportRefresh = useCallback(() => {
    if (phoneViewportRafRef.current !== null) {
      window.cancelAnimationFrame(phoneViewportRafRef.current);
    }
    for (const timer of phoneViewportTimerRefs.current) {
      window.clearTimeout(timer);
    }

    phoneViewportRafRef.current = window.requestAnimationFrame(() => {
      phoneViewportRafRef.current = null;
      refreshPhoneViewport();
    });
    phoneViewportTimerRefs.current = [80, 240, 600].map((delay) => window.setTimeout(refreshPhoneViewport, delay));
  }, [refreshPhoneViewport]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const refresh = () => schedulePhoneViewportRefresh();
    schedulePhoneViewportRefresh();

    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    visualViewport?.addEventListener('resize', refresh);
    visualViewport?.addEventListener('scroll', refresh);

    return () => {
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
      visualViewport?.removeEventListener('resize', refresh);
      visualViewport?.removeEventListener('scroll', refresh);
      if (phoneViewportRafRef.current !== null) {
        window.cancelAnimationFrame(phoneViewportRafRef.current);
      }
      for (const timer of phoneViewportTimerRefs.current) {
        window.clearTimeout(timer);
      }
      phoneViewportTimerRefs.current = [];
      document.documentElement.classList.remove('phone-scale-fix');
      document.documentElement.style.removeProperty('--phone-viewport-scale');
      document.documentElement.style.removeProperty('--phone-viewport-width');
    };
  }, [schedulePhoneViewportRefresh]);

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
    canOpenDrawer: !drawerOpen && screen !== 'login' && screen !== 'plan',
    onOpenDrawer: () => setDrawerOpen(true),
    canCloseDrawer: drawerOpen,
    onCloseDrawer: () => setDrawerOpen(false),
  });

  // ── Session management ────────────────────────────────────────────────────
  const applySession = useCallback((s: SessionData | null) => {
    const nextSession = s ? { ...s, persistedAt: Date.now() } : null;
    setSession(nextSession);
    if (!nextSession) {
      setPlanHiddenSubjectKeysByAlbum({});
      setPlanFiltersOpen(false);
      setPlanMoreMenuOpen(false);
      setPlanSearchOpen(false);

      // Clear storage
      localStorage.clear();
      sessionStorage.clear();

      // Clear Cache API (service worker caches)
      if ('caches' in window) {
        caches.keys().then(names => {
          for (const name of names) {
            caches.delete(name);
          }
        });
      }

      // Unregister Service Workers
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
          for (const registration of registrations) {
            registration.unregister();
          }
        });
      }
    }
  }, []);

  const handleExpiredSession = useCallback(() => {
    if (!activeSessionKeyRef.current || sessionExpiryHandledRef.current) return;
    sessionExpiryHandledRef.current = true;
    const message = t('general.sessionExpired');
    setGlobalError(message);
    showToast(message);
    applySession(null);
  }, [applySession, showToast, t]);

  const handleSessionError = useCallback((error: unknown): boolean => {
    if (!isSessionExpiredError(error)) return false;
    handleExpiredSession();
    return true;
  }, [handleExpiredSession]);

  const ensureSessionStillValid = useCallback(async (sess: SessionData, force = false): Promise<boolean> => {
    if (!navigator.onLine) return true;

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
          schedulePhoneViewportRefresh();
          showToast('Zalogowano przez USOS');
          sessionStorage.removeItem('usos_request_token_secret');
        })
        .catch(e => showGlobalError(e, 'Błąd logowania USOS.'))
        .finally(() => setGlobalLoad(false));
    }
  }, [applySession, schedulePhoneViewportRefresh, showGlobalError, showToast]);

  const updateActiveStudy = useCallback((id: string | null) => {
    setSession(prev => (prev ? { ...prev, activeStudyId: id } : prev));
  }, []);

  // ── Data loading with cache-first strategy ────────────────────────────────

  const loadStudiesData = useCallback(async (sess: SessionData) => {
    if (!(await ensureSessionStillValid(sess))) return;

    // Show cached first
    const cached = cache.loadStudiesForce() ?? [];
    const cachedIsOnlyFallback = cached.length === 1
      && (cached[0].przynaleznoscId === 'usos-profile' || /^Student\s+\S+/i.test(cached[0].label));
    if (cached.length && !cachedIsOnlyFallback) {
      setStudies(cached);
      if (!sess.activeStudyId && cached[0].przynaleznoscId) {
        updateActiveStudy(cached[0].przynaleznoscId);
      }
    }
    // Fresh if TTL expired or no cache
    if (!cache.loadStudies() || cachedIsOnlyFallback) {
      setGlobalLoad(true);
      setGlobalError('');
      try {
        const fresh = await fetchCombinedStudies(sess);
        cache.saveStudies(fresh);
        setStudies(fresh);
        if (!sess.activeStudyId && fresh[0].przynaleznoscId) {
          updateActiveStudy(fresh[0].przynaleznoscId);
        }
      } catch (e) {
        if (handleSessionError(e)) return;
        if (cached.length && cachedIsOnlyFallback) setStudies(cached);
        if (!cached.length || cachedIsOnlyFallback) showGlobalError(e, 'Nie można pobrać kierunków.');
      } finally {
        setGlobalLoad(false);
      }
    }
  }, [ensureSessionStillValid, handleSessionError, showGlobalError, updateActiveStudy]);

  useEffect(() => {
    if (!session) { setStudies([]); return; }
    void loadStudiesData(session);
  }, [session, loadStudiesData]);

  const resolveActivePlanSearch = useCallback((search?: { category: string; query: string }) => {
    const query = (search?.query ?? planSearchQ).trim();
    if (!query) {
      return { category: 'album', query: '' };
    }

    return {
      category: (search?.category ?? planSearchCat).trim() || 'album',
      query,
    };
  }, [planSearchCat, planSearchQ]);

  const loadPlanWindowData = useCallback(async (
    windowCacheKey: string,
    windowRequestKey: string,
    dateToUse: string,
    searchParam: { category: string; query: string },
    forceRefresh: boolean,
  ) => {
    const existingPromise = !forceRefresh ? planWindowRequestsRef.current[windowRequestKey] : undefined;
    if (existingPromise) {
      return existingPromise;
    }

    const requestPromise = fetchPlanWindow(session as SessionData, {
      viewMode: planViewMode,
      currentDate: dateToUse,
      studyId: activeStudyId,
      search: searchParam,
      prefetchDaysBefore: PLAN_PREFETCH_DAYS_BACK,
      prefetchDaysAfter: PLAN_PREFETCH_DAYS_FORWARD,
    }).then((planWindow) => {
      planWindowCacheRef.current[windowCacheKey] = planWindow;
      return planWindow;
    });

    const trackedPromise = requestPromise.finally(() => {
      if (planWindowRequestsRef.current[windowRequestKey] === trackedPromise) {
        delete planWindowRequestsRef.current[windowRequestKey];
      }
    });

    planWindowRequestsRef.current[windowRequestKey] = trackedPromise;
    return trackedPromise;
  }, [activeStudyId, planViewMode, session]);

  const loadPlanData = useCallback(async (search?: { category: string; query: string }, forceRefresh = false, newDate?: string) => {
    if (!session) return;
    const dateToUse = newDate || planDate;
    const cacheKey = planCacheKey(planViewMode, dateToUse, activeStudyId);
    const searchParam = resolveActivePlanSearch(search);
    const isSearch = !!searchParam.query;
    const windowCacheKey = buildPlanWindowCacheKey(activeStudyId, searchParam);
    const windowRequestKey = `${windowCacheKey}:${planViewMode}:${dateToUse}`;
    const cachedPlanWindow = !forceRefresh ? planWindowCacheRef.current[windowCacheKey] : null;
    const hasCoveringPlanWindow = !!(cachedPlanWindow && doesPlanWindowCoverView(cachedPlanWindow, planViewMode, dateToUse));

    // Create unique request ID to cancel old requests
    const requestId = Math.random().toString(36).substr(2, 9);
    planRequestIdRef.current = requestId;

    if (!(await ensureSessionStillValid(session))) {
      if (planRequestIdRef.current === requestId) {
        setPlanLoading(false);
      }
      return;
    }

    // Show cached immediately without spinner (but not if forcing refresh)
    let hasCached = false;
    if (hasCoveringPlanWindow && cachedPlanWindow) {
      hasCached = true;
      const bufferedResult = buildPlanResultFromWindow(cachedPlanWindow, {
        viewMode: planViewMode,
        currentDate: dateToUse,
      });
      const bufferedHiddenSubjectKeys = await loadPersistedPlanHiddenSubjects(bufferedResult.debug.album || '');
      if (planRequestIdRef.current !== requestId) {
        return;
      }
      setPlanHiddenSubjectsForAlbum(bufferedResult.debug.album || '', bufferedHiddenSubjectKeys);
      if (!isSearch) cache.savePlan(cacheKey, bufferedResult);
      setPlanResult(bufferedResult);
    } else if (!isSearch && !forceRefresh) {
      const cached = cache.loadPlanForce(cacheKey);
      if (cached) {
        hasCached = true;
        const cachedHiddenSubjectKeys = await loadPersistedPlanHiddenSubjects(cached.debug.album || '');
        if (planRequestIdRef.current !== requestId) {
          return;
        }
        setPlanHiddenSubjectsForAlbum(cached.debug.album || '', cachedHiddenSubjectKeys);
        setPlanResult(cached);
      }
      // Task 7: Reuse week cache for day view
      if (!cached && planViewMode === 'day' && planResult && planResult.dayColumns) {
        const dayCol = planResult.dayColumns.find(c => c.date === dateToUse);
        if (dayCol) {
          const syntheticResult: PlanResult = {
            ...planResult,
            dayColumns: [dayCol],
            currentDate: dateToUse,
            headerLabel: dateToUse,
            prevDate: addDaysYmd(dateToUse, -1),
            nextDate: addDaysYmd(dateToUse, 1),
          };
          hasCached = true;
          const syntheticHiddenSubjectKeys = await loadPersistedPlanHiddenSubjects(syntheticResult.debug.album || '');
          if (planRequestIdRef.current !== requestId) {
            return;
          }
          setPlanHiddenSubjectsForAlbum(syntheticResult.debug.album || '', syntheticHiddenSubjectKeys);
          setPlanResult(syntheticResult);
        }
      }
    }

    // Only show spinner if no cache or searching
    if (!hasCached) {
      setPlanLoading(true);
    }
    setGlobalError('');

    if (hasCoveringPlanWindow && !forceRefresh) {
      if (planRequestIdRef.current === requestId) {
        setPlanLoading(false);
      }
      return;
    }

    try {
      const planWindow = await loadPlanWindowData(
        windowCacheKey,
        windowRequestKey,
        dateToUse,
        searchParam,
        forceRefresh,
      );

      // Check if this request is still current (not cancelled by newer request)
      if (planRequestIdRef.current !== requestId) {
        return; // Newer request is in progress, discard this result
      }

      const result = buildPlanResultFromWindow(planWindow, {
        viewMode: planViewMode,
        currentDate: dateToUse,
      });
      const resultHiddenSubjectKeys = await loadPersistedPlanHiddenSubjects(result.debug.album || '');
      if (planRequestIdRef.current !== requestId) {
        return;
      }

      setPlanHiddenSubjectsForAlbum(result.debug.album || '', resultHiddenSubjectKeys);
      if (!isSearch) cache.savePlan(cacheKey, result);
      setPlanResult(result);
      if (!isSearch && result.currentDate && !newDate) setPlanDate(result.currentDate);
    } catch (e) {
      if (planRequestIdRef.current === requestId) {
        if (handleSessionError(e)) return;
        if (!planResult) {
          showGlobalError(e, 'Nie można pobrać planu.');
        }
      }
    } finally {
      if (planRequestIdRef.current === requestId) {
        setPlanLoading(false);
      }
    }
  }, [
    session,
    planViewMode,
    planDate,
    activeStudyId,
    planResult,
    resolveActivePlanSearch,
    loadPlanWindowData,
    showGlobalError,
    ensureSessionStillValid,
    handleSessionError,
    loadPersistedPlanHiddenSubjects,
    setPlanHiddenSubjectsForAlbum,
  ]);

  // Fetch plan search suggestions with debouncing (300ms)
  const fetchPlanSearchSuggestions = useCallback(async (category: string, query: string) => {
    if (!query.trim()) {
      setPlanSearchSuggestions([]);
      setPlanSearchLoading(false);
      return;
    }

    setPlanSearchLoading(true);
    try {
      const suggestions = await fetchPlanSuggestions(category, query);
      setPlanSearchSuggestions(suggestions);
    } catch {
      setPlanSearchSuggestions([]);
    } finally {
      setPlanSearchLoading(false);
    }
  }, []);

  const loadGradesPlanFilters = useCallback(async (forceRefresh = false) => {
    if (!session) {
      setGradesPlanAlbum('');
      setGradesPlanSubjectFilters([]);
      return;
    }

    const cacheKey = `${session.userId || 'usos'}_${activeStudyId ?? 'nostudy'}_${todayYmd()}`;
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
    const resolvedCategory = category.trim();
    const resolvedQuery = query.trim();
    if (!resolvedCategory || !resolvedQuery) return;

    if (planSearchDebounceRef.current) {
      clearTimeout(planSearchDebounceRef.current);
      planSearchDebounceRef.current = null;
    }

    setPlanSearchCat(resolvedCategory);
    setPlanSearchQ(resolvedQuery);
    setPlanSearchSuggestions([]);
    setPlanSearchLoading(false);
    setPlanSearchOpen(false);
    setPlanMoreMenuOpen(false);
    setPlanFiltersOpen(false);
    setSelectedPlanEvent(null);
    void loadPlanData({ category: resolvedCategory, query: resolvedQuery });
  }, [loadPlanData]);

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
    if (!session) {
      setGrades([]);
      return;
    }

    if (!(await ensureSessionStillValid(session))) return;

    const gradesCacheBase = session.userId || 'usos';
    const gradesCacheKey = `${gradesCacheBase}_active_terms_v4`;
    const gradesCacheKeys = [gradesCacheKey, `${gradesCacheBase}_active_terms_v3`];
    let hasCachedGrades = false;
    if (!forceRefresh) {
      const cached = gradesCacheKeys.map((key) => cache.loadGradesForce(key)).find((items): items is Grade[] => Boolean(items));
      if (cached) {
        const cleanedCached = keepRealGrades(cached);
        hasCachedGrades = cleanedCached.length > 0;
        setGrades(cleanedCached);
      }
      const freshCached = gradesCacheKeys.map((key) => cache.loadGrades(key)).find((items): items is Grade[] => Boolean(items));
      if (freshCached) {
        const cleanedFreshCached = keepRealGrades(freshCached);
        cache.saveGrades(gradesCacheKey, cleanedFreshCached);
        setGrades(cleanedFreshCached);
        if (!creditsRef.current) {
          void fetchCreditSummary(session, activeStudyId).then((summary) => {
            if (summary) setCredits(summary);
          }).catch(() => undefined);
        }
        return;
      }
    }

    setGradesLoad(true);
    setGlobalError('');
    try {
      const [gradesResult, creditsResult] = await Promise.allSettled([
        fetchCombinedGrades(session),
        fetchCreditSummary(session, activeStudyId),
      ]);

      if (creditsResult.status === 'fulfilled' && creditsResult.value) {
        setCredits(creditsResult.value);
      }
      if (gradesResult.status === 'rejected') {
        throw gradesResult.reason;
      }

      const fresh = keepRealGrades(gradesResult.value);
      cache.saveGrades(gradesCacheKey, fresh);
      setGrades(fresh);
    } catch (e) {
      if (handleSessionError(e)) return;
      if (!hasCachedGrades && !gradesRef.current.length) {
        showGlobalError(e, 'Nie można pobrać ocen.');
      } else {
        showToast('USOS jest chwilowo niedostępny, pokazuję zapisane oceny.');
      }
    } finally {
      setGradesLoad(false);
    }
  }, [session, activeStudyId, ensureSessionStillValid, handleSessionError, showGlobalError, showToast]);

  const loadFinanceData = useCallback(async (forceRefresh = false) => {
    if (!session || !activeStudyId) {
      setFinanceSnapshot({ ...EMPTY_FINANCE_SNAPSHOT });
      return;
    }

    if (!(await ensureSessionStillValid(session))) return;

    const forced = cache.loadFinanceForce(activeStudyId);
    if (forced) {
      setFinanceSnapshot(forced);
    }

    if (cache.loadFinance(activeStudyId) && !forceRefresh) return;

    setFinanceLoading(true);
    setGlobalError('');
    try {
      const records = await fetchFinance(session, activeStudyId);
      const snapshot: FinanceSnapshot = { records, fetchedAt: Date.now() };
      cache.saveFinance(activeStudyId, snapshot);
      setFinanceSnapshot(snapshot);
    } catch (e) {
      if (handleSessionError(e)) return;
      if (!forced) {
        showGlobalError(e, 'Nie można pobrać finansów.');
      }
    } finally {
      setFinanceLoading(false);
    }
  }, [session, activeStudyId, ensureSessionStillValid, handleSessionError, showGlobalError]);

  const loadInfoData = useCallback(async (forceRefresh = false) => {
    if (!session || !activeStudyId) return;
    if (!(await ensureSessionStillValid(session))) return;
    const forceCached = cache.loadInfoForce(activeStudyId);
    if (forceCached && !forceRefresh) {
      setDetails(forceCached.details);
      setHistory(forceCached.history);
      if (forceCached.els) setEls(forceCached.els);
      if (forceCached.calendarEvents) setCalendarEvents(forceCached.calendarEvents);
      if ('credits' in forceCached) setCredits(forceCached.credits ?? null);
      if (forceCached.surveys) setSurveys(forceCached.surveys);
      if (forceCached.surveysMissingScopes) setSurveysMissingScopes(forceCached.surveysMissingScopes);
    }
    if (cache.loadInfo(activeStudyId) && !forceRefresh) return; // fresh cache, skip fetch
    setInfoLoading(true);
    setGlobalError('');
    try {
      const [infoResult, creditsResult, surveysResult] = await Promise.allSettled([
        fetchInfo(session, activeStudyId),
        fetchCreditSummary(session, activeStudyId),
        fetchSurveysToFill(session),
      ]);

      if (infoResult.status === 'rejected') throw infoResult.reason;

      const payload = {
        ...infoResult.value,
        credits: creditsResult.status === 'fulfilled' ? creditsResult.value : null,
        surveys: surveysResult.status === 'fulfilled' ? surveysResult.value.items : [],
        surveysMissingScopes: surveysResult.status === 'fulfilled' ? surveysResult.value.missingScopes : [],
      };
      cache.saveInfo(activeStudyId, payload);
      setDetails(payload.details);
      setHistory(payload.history);
      setEls(payload.els ?? null);
      setCalendarEvents(payload.calendarEvents ?? []);
      setCredits(payload.credits ?? null);
      setSurveys(payload.surveys ?? []);
      setSurveysMissingScopes(payload.surveysMissingScopes ?? []);
    } catch (e) {
      if (handleSessionError(e)) return;
      if (!forceCached) showGlobalError(e, 'Nie można pobrać danych.');
    } finally {
      setInfoLoading(false);
    }
  }, [session, activeStudyId, ensureSessionStillValid, handleSessionError, showGlobalError]);

  const loadNewsData = useCallback(async (forceRefresh = false) => {
    const forced = cache.loadNewsForce() ?? [];
    if (forced.length && !forceRefresh) setNews(forced);
    if (cache.loadNews() && !forceRefresh) return;
    setNewsLoading(true);
    setGlobalError('');
    try {
      const items = await fetchNews();
      cache.saveNews(items);
      setNews(items);
    } catch (e) {
      if (!forced.length) showGlobalError(e, 'Nie można pobrać aktualności.');
    } finally {
      setNewsLoading(false);
    }
  }, [showGlobalError]);

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
      void loadGradesPlanFilters();
    }
    if (screen === 'finance') void loadFinanceData();
    if (screen === 'info') void loadInfoData();
    if (screen === 'news') void loadNewsData();
    if (screen === 'stats') void loadStatsData();
  }, [screen, session]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setSurveys([]);
    setSurveysMissingScopes([]);
    setPlanResult(null);
    setSelectedPlanEvent(null);

    if (screen === 'plan') void loadPlanData();
    if (screen === 'grades') {
      void loadGradesData(true);
      void loadGradesPlanFilters(true);
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

  const groupedGrades = useMemo(() => {
    const grouped = new Map<string, { subject: string; finalGradeItem: Grade | null; others: Grade[]; emptyFromPlanFilter: boolean }>();

    for (const g of visibleGrades) {
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
  }, [gradesPlanSubjectFilters, hiddenGradesPlanSubjectKeys, visibleGrades]);

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

    for (const g of visibleGrades) {
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
      for (const g of visibleGrades) {
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
    const fallbackEcts = Math.max(0, sumUniqueEcts(visibleGrades));
    return {
      avg,
      ectsSem: formatCreditMetric(credits?.programmeUsed, fallbackEcts),
      ectsTotal: formatCreditMetric(credits?.overallUsed, fallbackEcts),
    };
  }, [credits, visibleGrades]);

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
    if (!hiddenPlanSubjectKeys.length) return planResult;

    const hiddenKeys = new Set(hiddenPlanSubjectKeys);
    const dayColumns = planResult.dayColumns.map((column) => ({
      ...column,
      events: relayoutDayEvents(
        column.events.filter((event) => !hiddenKeys.has(getPlanEventFilterKey(event))),
      ),
    }));
    const visibleDates = new Set(dayColumns.filter((column) => column.events.length > 0).map((column) => column.date));
    const monthGrid = planResult.monthGrid.map((week) => week.map((cell) => ({
      ...cell,
      hasPlan: visibleDates.has(cell.date),
    })));

    return {
      ...planResult,
      dayColumns,
      monthGrid,
      hasAnyEventsInRange: dayColumns.some((column) => column.events.length > 0),
    };
  }, [planResult, hiddenPlanSubjectKeys]);

  const weekLayout = useMemo(() => {
    let minS = Infinity, maxE = 0;
    for (const col of visiblePlanResult?.dayColumns ?? []) {
      for (const ev of col.events) { minS = Math.min(minS, ev.startMin); maxE = Math.max(maxE, ev.endMin); }
    }
    const s0 = Number.isFinite(minS) ? minS : 7 * 60;
    const e0 = maxE > 0 ? maxE : 21 * 60;
    const startMin = Math.max(6 * 60, Math.floor((s0 - 30) / 60) * 60);
    const endMin = Math.max(startMin + 60, Math.min(23 * 60, Math.ceil((e0 + 30) / 60) * 60));
    const hh = settings.compactPlan ? 44 : 56;
    const slots: number[] = [];
    for (let m = startMin; m < endMin; m += 60) slots.push(m);
    if (!slots.length) slots.push(startMin);
    return { startMin, endMin, hourHeight: hh, slots };
  }, [visiblePlanResult?.dayColumns, settings.compactPlan]);

  const weekVisibleColumns = useMemo(() => {
    const cols = visiblePlanResult?.dayColumns ?? [];
    const weekendCols = cols.filter(col => isWeekendDate(col.date));
    const hideWeekend = weekendCols.length === 2 && weekendCols.every(col => col.events.length === 0);
    if (!hideWeekend) return cols;
    const workweekCols = cols.filter(col => !isWeekendDate(col.date));
    return workweekCols.length > 0 ? workweekCols : cols;
  }, [visiblePlanResult?.dayColumns]);

  const weekTrackH = weekLayout.slots.length * weekLayout.hourHeight;
  const min2px = weekLayout.hourHeight / 60;

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

  // ── Login ─────────────────────────────────────────────────────────────────
  // ── Install tip helpers ───────────────────────────────────────────────────
  const dismissInstallTip = () => {
    localStorage.setItem(INSTALL_TIP_KEY, '1');
    setToast('Możesz to zrobić później w zakładce "O aplikacji"');
    setInstallTipFading(true);
    setTimeout(() => setShowInstallTip(false), 300);
  };

  const handleInstallTipInstall = async () => {
    localStorage.setItem(INSTALL_TIP_KEY, '1');
    setInstallTipFading(true);
    setTimeout(() => setShowInstallTip(false), 300);
    if (isIosSafari) {
      // Small delay so tip fades first, then instructions appear
      setTimeout(() => setShowIosInstructions(true), 320);
    } else {
      await handleInstallPwa();
    }
  };

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

  // ── Plan carousel animation helpers ─────────────────────────────────────────
  function applyCarouselTransform(x: number, animated: boolean, duration = 240) {
    const el = carouselRef.current;
    if (!el) return;
    el.style.transition = animated ? `transform ${duration}ms cubic-bezier(0.25,0.46,0.45,0.94)` : 'none';
    el.style.transform = x === 0 ? '' : `translateX(${x}px)`;
  }

  function commitPlanNavigate(targetDate: string, exitRight: boolean) {
    const exitX = exitRight ? window.innerWidth : -window.innerWidth;
    const enterX = -exitX;
    applyCarouselTransform(exitX, true, 200);
    setTimeout(() => {
      if (carouselRef.current) {
        carouselRef.current.style.transition = 'none';
        carouselRef.current.style.transform = `translateX(${enterX}px)`;
      }
      const isSearch = !!(planSearchQ?.trim());
      if (isSearch) void loadPlanData({ category: planSearchCat, query: planSearchQ.trim() }, false, targetDate);
      else setPlanDate(targetDate);
      requestAnimationFrame(() => requestAnimationFrame(() => applyCarouselTransform(0, true, 220)));
    }, 215);
  }

  // ── Plan touch swipe handlers ─────────────────────────────────────────────
  const onPlanTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    // Give priority to drawer swipe from left edge
    if (e.touches[0].clientX <= 44) return;
    if (carouselRef.current) carouselRef.current.style.transition = 'none';
    planDragRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startTime: Date.now(),
      locked: false,
    };
  };

  const onPlanTouchMove = (e: React.TouchEvent) => {
    const drag = planDragRef.current;
    if (!drag || !carouselRef.current) return;
    const dx = e.touches[0].clientX - drag.startX;
    const dy = e.touches[0].clientY - drag.startY;
    if (!drag.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { planDragRef.current = null; return; }
      drag.locked = true;
    }
    carouselRef.current.style.transform = `translateX(${dx}px)`;
  };

  const onPlanTouchEnd = (e: React.TouchEvent) => {
    const drag = planDragRef.current;
    planDragRef.current = null;
    if (!drag?.locked) { applyCarouselTransform(0, true); return; }
    if (!visiblePlanResult || planLoading) { applyCarouselTransform(0, true); return; }
    const dx = e.changedTouches[0].clientX - drag.startX;
    const dt = Math.max(1, Date.now() - drag.startTime);
    const velocity = Math.abs(dx) / dt;
    if (Math.abs(dx) < 50 && velocity < 0.35) { applyCarouselTransform(0, true); return; }
    const targetDate = dx > 0 ? visiblePlanResult.prevDate : visiblePlanResult.nextDate;
    if (!targetDate) { applyCarouselTransform(0, true); return; }
    commitPlanNavigate(targetDate, dx > 0);
  };

  const onPlanTouchCancel = () => {
    planDragRef.current = null;
    applyCarouselTransform(0, true);
  };

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
    return <HomeScreen session={session} isOnline={isOnline} t={t} openScreen={openScreen} />;
  }

  function getPeriodDisplayName(key: string): string {
    return t(`periodName.${key}`) !== `periodName.${key}` ? t(`periodName.${key}`) : key.replace(/_/g, ' ');
  }

  function getPeriodKind(key: string): 'session' | 'break' | 'holiday' {
    if (key.startsWith('sesja_')) return 'session';
    if (key.startsWith('przerwa_')) return 'break';
    return 'holiday';
  }

  interface PeriodMarker { label: string; kind: 'session' | 'break' | 'holiday'; }

  // Returns markers for day boundaries (end of previous period, start of new period)
  function getPeriodTransitionMarkers(date: string, prevDate: string | null, periods: SessionPeriod[]): PeriodMarker[] {
    const markers: PeriodMarker[] = [];
    for (const p of periods) {
      if (prevDate && p.end >= prevDate && p.end < date) {
        markers.push({ label: `${t('period.end')}: ${getPeriodDisplayName(p.key)}`, kind: getPeriodKind(p.key) });
      }
      if (p.start === date) {
        markers.push({ label: `${t('period.start')}: ${getPeriodDisplayName(p.key)}`, kind: getPeriodKind(p.key) });
      }
    }
    return markers;
  }

  // Returns periods that are ACTIVE on a given date (date falls within start..end)
  function getActivePeriods(date: string, periods: SessionPeriod[]): PeriodMarker[] {
    const markers: PeriodMarker[] = [];
    for (const p of periods) {
      if (date >= p.start && date <= p.end) {
        markers.push({ label: getPeriodDisplayName(p.key), kind: getPeriodKind(p.key) });
      }
    }
    return markers;
  }

  function renderPeriodBanner(markers: PeriodMarker[]) {
    if (!markers.length) return null;
    return (
      <div className="period-markers">
        {markers.map((m, i) => (
          <div key={i} className={`period-marker period-marker-${m.kind}`}>{m.label}</div>
        ))}
      </div>
    );
  }

  function getWeekSeparatorPeriod(leftDate: string, rightDate: string, periods: SessionPeriod[]): PeriodMarker | null {
    for (const p of periods) {
      // A boundary exists if left is in period but right is not, or right is in but left is not
      const leftIn = leftDate >= p.start && leftDate <= p.end;
      const rightIn = rightDate >= p.start && rightDate <= p.end;
      if (leftIn !== rightIn) {
        return { label: getPeriodDisplayName(p.key), kind: getPeriodKind(p.key) };
      }
    }
    return null;
  }

  // Legend data
  const EVENT_LEGEND: Array<{ cls: string; label: string; color: string }> = [
    { cls: 'ev-lecture', label: 'Wykład / Ćwiczenia', color: 'var(--ev-lecture)' },
    { cls: 'ev-lab', label: 'Laboratorium', color: 'var(--ev-lab)' },
    { cls: 'ev-auditory', label: 'Audytoryjne', color: 'var(--ev-auditory)' },
    { cls: 'ev-exam', label: 'Egzamin', color: 'var(--ev-exam)' },
    { cls: 'ev-remote', label: 'Zdalne', color: 'var(--ev-remote)' },
    { cls: 'ev-cancelled', label: 'Odwołane', color: 'var(--ev-cancelled)' },
    { cls: 'ev-pass', label: 'Zaliczenie', color: 'var(--ev-pass)' },
    { cls: 'ev-project', label: 'Projekt', color: 'var(--ev-project)' },
    { cls: 'ev-seminar', label: 'Seminarium', color: 'var(--ev-seminar)' },
    { cls: 'ev-diploma', label: 'Dyplomowe', color: 'var(--ev-diploma)' },
    { cls: 'ev-lectorate', label: 'Lektorat', color: 'var(--ev-lectorate)' },
    { cls: 'ev-conservatory', label: 'Konwersatorium', color: 'var(--ev-conservatory)' },
    { cls: 'ev-consultation', label: 'Konsultacje', color: 'var(--ev-consultation)' },
    { cls: 'ev-field', label: 'Terenowe', color: 'var(--ev-field)' },
  ];

  const MARKER_LEGEND: Array<{ kind: string; label: string; color: string }> = [
    { kind: 'session', label: 'Sesja egzaminacyjna', color: '#ef5350' },
    { kind: 'break', label: 'Przerwa dydaktyczna', color: 'var(--mz-primary)' },
    { kind: 'holiday', label: 'Święto / Dzień wolny', color: 'var(--mz-success)' },
  ];

  function renderInlineLegend(className: string) {
    if (planLoading) return null;

    // Dynamically calculate what to show in the legend based on the current week/day events
    const cols = visiblePlanResult?.dayColumns ?? [];
    const activeEventClasses = new Set<string>();
    cols.forEach(col => col.events.forEach(ev => activeEventClasses.add(`ev-${ev.typeClass}`)));

    const activeMarkerKinds = new Set<string>();
    const periods = visiblePlanResult?.sessionPeriods ?? [];
    cols.forEach(col => {
      const markers = getActivePeriods(col.date, periods);
      markers.forEach(m => activeMarkerKinds.add(m.kind));
    });

    const visibleEvents = EVENT_LEGEND.filter(ev => activeEventClasses.has(ev.cls));
    const visibleMarkers = MARKER_LEGEND.filter(m => activeMarkerKinds.has(m.kind));

    if (visibleEvents.length === 0 && visibleMarkers.length === 0) return null;

    return (
      <div className={`plan-legend-inline ${className}`}>
        <div className="plan-legend-inline-title">{t('plan.legend') || 'Legenda'}</div>

        {visibleEvents.length > 0 && (
          <>
            <div className="legend-section-title">{t('plan.eventTypes') || 'Typy zajęć'}</div>
            {visibleEvents.map(ev => (
              <div key={ev.cls} className="legend-row">
                <div className="legend-swatch" style={{ background: ev.color }} />
                <span className="legend-label">{ev.label}</span>
              </div>
            ))}
          </>
        )}

        {visibleMarkers.length > 0 && (
          <>
            <div className="legend-section-title">{t('plan.periodMarkers') || 'Markery okresów'}</div>
            {visibleMarkers.map(m => (
              <div key={m.kind} className="legend-row">
                <div className="legend-line-swatch" style={{ background: m.color }} />
                <span className="legend-label">{m.label}</span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  function renderPlan() {
    const cols = visiblePlanResult?.dayColumns ?? [];
    const weekCols = weekVisibleColumns;
    const today = todayYmd();

    // Build week grid template with separator columns
    const buildWeekGridTemplate = (numCols: number) => {
      if (numCols === 0) return 'var(--plan-time-col-w, 44px)';
      const parts: string[] = ['var(--plan-time-col-w, 44px)'];
      for (let i = 0; i < numCols; i++) {
        parts.push('1fr');
        if (i < numCols - 1) {
          const sep = weekCols.length > i + 1
            ? getWeekSeparatorPeriod(weekCols[i].date, weekCols[i + 1].date, visiblePlanResult?.sessionPeriods ?? [])
            : null;
          parts.push(sep ? '3px' : '0px');
        }
      }
      return parts.join(' ');
    };

    const weekGridTemplate = buildWeekGridTemplate(weekCols.length);
    const showPlanFrameSkeleton = planLoading && !visiblePlanResult;
    const monthCells = (visiblePlanResult?.monthGrid ?? []).flat();
    const showMonthSkeleton = planLoading && monthCells.length === 0;
    const weekSkeletonColumnCount = Math.max(weekCols.length, 5);

    const renderPlanEventSkeletons = (scope: 'day' | 'week', key: string) => {
      const items = scope === 'day'
        ? [
          { top: 84, height: 88, left: '8px', width: 'calc(100% - 16px)', titleWidth: '68%', metaWidth: '54%', extraWidth: '38%' },
          { top: 238, height: 104, left: '8px', width: 'calc(78% - 12px)', titleWidth: '74%', metaWidth: '52%', extraWidth: '34%' },
          { top: 372, height: 76, left: 'calc(44% + 4px)', width: 'calc(56% - 12px)', titleWidth: '64%', metaWidth: '48%', extraWidth: '30%' },
        ]
        : [
          { top: 88, height: 72, left: '3px', width: 'calc(100% - 6px)', titleWidth: '76%', metaWidth: '58%', extraWidth: '' },
          { top: 228, height: 94, left: '3px', width: 'calc(100% - 6px)', titleWidth: '66%', metaWidth: '54%', extraWidth: '' },
        ];

      return items.map((item, idx) => (
        <div
          key={`sk-${scope}-${key}-${idx}`}
          className={`plan-skeleton-event plan-skeleton-event-${scope}`}
          style={{ top: item.top, height: item.height, left: item.left, width: item.width }}
        >
          <Skeleton className="skeleton-line skeleton-line-sm plan-skeleton-event-line plan-skeleton-event-line-title" style={{ width: item.titleWidth }} />
          <Skeleton className="skeleton-line skeleton-line-xs plan-skeleton-event-line" style={{ width: item.metaWidth }} />
          {item.extraWidth && (
            <Skeleton className="skeleton-line skeleton-line-xs plan-skeleton-event-line plan-skeleton-event-line-muted" style={{ width: item.extraWidth }} />
          )}
        </div>
      ));
    };

    const renderPlanDaySkeleton = () => (
      <div className="list-stack">
        <div className="card day-tl-card plan-loading-card">
          <div className="day-tl-head">
            <Skeleton className="skeleton-line skeleton-line-sm plan-skeleton-headline" style={{ width: '156px' }} />
            <div className="day-tl-head-right">
              <Skeleton className="skeleton-pill plan-skeleton-chip" style={{ width: '78px' }} />
            </div>
          </div>
          <div className="day-tl-body">
            <div className="day-time-col">
              {weekLayout.slots.map((m) => (
                <div key={`sk-day-time-${m}`} className="day-time-cell day-time-cell-skeleton" style={{ height: weekLayout.hourHeight }}>
                  {fmtHour(m)}
                </div>
              ))}
            </div>

            <div className="day-events-col" style={{ height: weekTrackH }}>
              {weekLayout.slots.map((m, idx) => (
                <div key={`sk-day-line-${m}`} className="day-hour-line" style={{ top: idx * weekLayout.hourHeight }} />
              ))}
              {renderPlanEventSkeletons('day', planDate)}
            </div>
          </div>
        </div>
      </div>
    );

    const renderPlanWeekSkeleton = () => {
      const skeletonWeekGridTemplate = buildWeekGridTemplate(weekSkeletonColumnCount);

      return (
        <div className="card week-card plan-loading-card">
          <div className="week-grid week-head-row" style={{ gridTemplateColumns: skeletonWeekGridTemplate }}>
            <div className="week-head-time">{t('plan.hour')}</div>
            {Array.from({ length: weekSkeletonColumnCount }).map((_, ci) => (
              <React.Fragment key={`sk-week-head-${ci}`}>
                <div className="week-head-day plan-skeleton-week-head">
                  <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '54px' }} />
                  <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '38px' }} />
                </div>
                {ci < weekSkeletonColumnCount - 1 && <div style={{ width: 0 }} />}
              </React.Fragment>
            ))}
          </div>

          <div className="week-grid" style={{ gridTemplateColumns: skeletonWeekGridTemplate }}>
            <div className="week-time-col">
              {weekLayout.slots.map((m) => (
                <div key={`sk-week-time-${m}`} className="week-time-cell week-time-cell-skeleton" style={{ height: weekLayout.hourHeight }}>
                  {fmtHour(m)}
                </div>
              ))}
            </div>

            {Array.from({ length: weekSkeletonColumnCount }).map((_, ci) => (
              <React.Fragment key={`sk-week-col-${ci}`}>
                <div className="week-day-col" style={{ height: weekTrackH }}>
                  {weekLayout.slots.map((m, idx) => (
                    <div key={`sk-week-line-${ci}-${m}`} className="week-hour-line" style={{ top: idx * weekLayout.hourHeight }} />
                  ))}
                  {renderPlanEventSkeletons('week', `${ci}`)}
                </div>
                {ci < weekSkeletonColumnCount - 1 && <div style={{ width: 0 }} />}
              </React.Fragment>
            ))}
          </div>
        </div>
      );
    };

    const renderPlanMonthSkeleton = () => (
      <div className="month-shell plan-loading-card">
        <div className="month-weekdays">{MONTH_WEEKDAY_KEYS.map((k) => <span key={k}>{t(k)}</span>)}</div>
        <div className="month-grid month-grid-skeleton">
          {Array.from({ length: 35 }).map((_, idx) => (
            <div key={`sk-month-${idx}`} className="month-cell month-cell-skeleton" aria-hidden>
              <Skeleton className="skeleton-line skeleton-line-xs month-skeleton-num" style={{ width: idx % 7 === 0 ? '34%' : '26%' }} />
              <div className="month-skeleton-dots">
                <Skeleton className="skeleton-dot" />
                {idx % 3 === 0 && <Skeleton className="skeleton-dot skeleton-dot-soft" />}
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    return (
      <section className="screen plan-screen">
        <aside className="plan-control-pane">
          {/* Sticky Header — prev | center | next */}
          <div className="plan-sticky-header">
            <button type="button" className="plan-nav-btn-compact" onClick={() => {
              const newDate = visiblePlanResult?.prevDate ?? planDate;
              commitPlanNavigate(newDate, true);
            }} aria-label={t('plan.prev')}>
              <Ic n="chevL" />
            </button>
            <div className="plan-header-center">
              <div className="plan-date-label-compact">{visiblePlanResult?.headerLabel || planDate}</div>
            </div>
            <button type="button" className="plan-nav-btn-compact" onClick={() => {
              const newDate = visiblePlanResult?.nextDate ?? planDate;
              commitPlanNavigate(newDate, false);
            }} aria-label={t('plan.next')}>
              <Ic n="chevR" />
            </button>
          </div>

          <div className="plan-floating-toolbar">
            {(['day', 'week', 'month'] as ViewMode[]).map(m => (
              <button key={m} type="button" className={`plan-mode-btn-floating ${planViewMode === m ? 'active' : ''}`} onClick={() => setPlanViewMode(m)}>
                {m === 'day' ? t('plan.day') : m === 'week' ? t('plan.week') : t('plan.month')}
              </button>
            ))}
          </div>

          {renderInlineLegend('plan-legend-side')}
        </aside>

        {/* Calendar Content */}
        <div className="plan-content">
          <div className="plan-content-surface">
            <div className="plan-container">
              <div
                className="plan-carousel-track"
                ref={carouselRef}
                onTouchStart={onPlanTouchStart}
                onTouchMove={onPlanTouchMove}
                onTouchEnd={onPlanTouchEnd}
                onTouchCancel={onPlanTouchCancel}
              >
                {/* Loader removed since skeleton acts as loader over timeline grid */}

                {planViewMode === 'day' && (
                  showPlanFrameSkeleton ? (
                    renderPlanDaySkeleton()
                  ) : (
                    <div className="list-stack">
                      {cols.map((col, ci) => {
                        const periods = visiblePlanResult?.sessionPeriods ?? [];
                        const transMarkers = getPeriodTransitionMarkers(col.date, cols[ci - 1]?.date ?? null, periods);
                        const activeMarkers = getActivePeriods(col.date, periods);
                        return (
                          <div key={col.date}>
                            {renderPeriodBanner(transMarkers)}
                            <div className="card day-tl-card">
                              <div className="day-tl-head">
                                <div className="day-tl-head-date">{fmtDateLabel(col.date, settings.language)}</div>
                                <div className="day-tl-head-right">
                                  {col.date === today && <span className="day-tl-today-badge">{t('plan.today')}</span>}
                                  {activeMarkers.map((m, i) => (
                                    <span key={i} className={`day-period-chip day-period-chip-${m.kind}`}>{m.label}</span>
                                  ))}
                                </div>
                              </div>

                              {col.events.length === 0 && !planLoading ? (
                                <div className="day-empty">{t('plan.emptyDay')}</div>
                              ) : (
                                <div className="day-tl-body">
                                  <div className="day-time-col">
                                    {weekLayout.slots.map(m => (
                                      <div key={`${col.date}-${m}`} className="day-time-cell" style={{ height: weekLayout.hourHeight }}>
                                        {fmtHour(m)}
                                      </div>
                                    ))}
                                  </div>

                                  <div className="day-events-col" style={{ height: weekTrackH }}>
                                    {weekLayout.slots.map((m, idx) => (
                                      <div key={`${col.date}-line-${m}`} className="day-hour-line" style={{ top: idx * weekLayout.hourHeight }} />
                                    ))}
                                    {col.date === today && nowMinute >= weekLayout.startMin && nowMinute <= weekLayout.endMin && (
                                      <div className="now-line" style={{ top: (nowMinute - weekLayout.startMin) * min2px }} />
                                    )}
                                    {planLoading ? (
                                      renderPlanEventSkeletons('day', col.date)
                                    ) : (
                                      col.events.map(ev => {
                                        const top = Math.max(0, (ev.startMin - weekLayout.startMin) * min2px);
                                        const h = Math.max(32, (ev.endMin - ev.startMin) * min2px);
                                        const left = `calc(${ev.leftPct}% + 2px)`;
                                        const width = `max(calc(${ev.widthPct}% - 4px), 8px)`;
                                        const open = () => setSelectedPlanEvent({ date: col.date, event: ev });
                                        return (
                                          <div
                                            key={`${col.date}-${ev.startMin}-${ev.endMin}-${ev.title}`}
                                            className={`day-event ev-${ev.typeClass}`}
                                            style={{ top, height: h, left, width }}
                                            role="button"
                                            tabIndex={0}
                                            onClick={open}
                                            onKeyDown={e => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                open();
                                              }
                                            }}
                                            title={`${ev.startStr} - ${ev.endStr} ${ev.title}`}
                                          >
                                            <div className="day-event-title">{ev.title}</div>
                                            <div className="day-event-meta">{ev.startStr}-{ev.endStr} · {ev.room}{ev.group ? ` · ${ev.group}` : ''}</div>
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {cols.length === 0 && (
                        <div className="empty-state">
                          <div className="empty-icon">📅</div>
                          <p>{t('plan.emptyDayLong')}</p>
                        </div>
                      )}
                    </div>
                  )
                )}

                {planViewMode === 'week' && (
                  showPlanFrameSkeleton ? (
                    renderPlanWeekSkeleton()
                  ) : (
                    <div className="card week-card">
                      {weekCols.length > 0 ? (
                        <>
                          <div className="week-grid week-head-row" style={{ gridTemplateColumns: weekGridTemplate }}>
                            <div className="week-head-time">{t('plan.hour')}</div>
                            {weekCols.map((col, ci) => {
                              const wActive = getActivePeriods(col.date, visiblePlanResult?.sessionPeriods ?? []);
                              const topPeriod = wActive.sort((a, b) => {
                                const p: Record<string, number> = { session: 3, break: 2, holiday: 1 };
                                return (p[b.kind] ?? 0) - (p[a.kind] ?? 0);
                              })[0] ?? null;

                              const sep = ci < weekCols.length - 1
                                ? getWeekSeparatorPeriod(col.date, weekCols[ci + 1].date, visiblePlanResult?.sessionPeriods ?? [])
                                : null;

                              return (
                                <React.Fragment key={`h-${col.date}`}>
                                  <div className={`week-head-day ${col.date === today ? 'today' : ''} ${topPeriod ? `has-period-${topPeriod.kind}` : ''}`}>
                                    <strong>{fmtWeekdayShort(col.date, settings.language)}</strong>
                                    <span>{fmtDayMonth(col.date, settings.language)}</span>
                                  </div>
                                  {sep && <div className={`week-head-separator week-head-separator-${sep.kind}`} title={sep.label} />}
                                  {ci < weekCols.length - 1 && !sep && <div style={{ width: 0 }} />}
                                </React.Fragment>
                              );
                            })}
                          </div>

                          <div className="week-grid" style={{ gridTemplateColumns: weekGridTemplate }}>
                            <div className="week-time-col">
                              {weekLayout.slots.map(m => (
                                <div key={`w-time-${m}`} className="week-time-cell" style={{ height: weekLayout.hourHeight }}>
                                  {fmtHour(m)}
                                </div>
                              ))}
                            </div>

                            {weekCols.map((col, ci) => {
                              const sep = ci < weekCols.length - 1
                                ? getWeekSeparatorPeriod(col.date, weekCols[ci + 1].date, visiblePlanResult?.sessionPeriods ?? [])
                                : null;
                              return (
                                <React.Fragment key={`w-col-${col.date}`}>
                                  <div className="week-day-col" style={{ height: weekTrackH }}>
                                    {weekLayout.slots.map((m, idx) => (
                                      <div key={`${col.date}-week-line-${m}`} className="week-hour-line" style={{ top: idx * weekLayout.hourHeight }} />
                                    ))}
                                    {col.date === today && nowMinute >= weekLayout.startMin && nowMinute <= weekLayout.endMin && (
                                      <div className="now-line" style={{ top: (nowMinute - weekLayout.startMin) * min2px }} />
                                    )}
                                    {planLoading ? (
                                      renderPlanEventSkeletons('week', col.date)
                                    ) : (
                                      col.events.map(ev => {
                                        const top = Math.max(0, (ev.startMin - weekLayout.startMin) * min2px);
                                        const h = Math.max(26, (ev.endMin - ev.startMin) * min2px);
                                        const left = `calc(${ev.leftPct}% + 2px)`;
                                        const width = `max(calc(${ev.widthPct}% - 4px), 8px)`;
                                        const open = () => setSelectedPlanEvent({ date: col.date, event: ev });
                                        return (
                                          <div
                                            key={`w-${col.date}-${ev.startMin}-${ev.endMin}-${ev.title}`}
                                            className={`week-event ev-${ev.typeClass}`}
                                            style={{ top, height: h, left, width }}
                                            role="button"
                                            tabIndex={0}
                                            onClick={open}
                                            onKeyDown={e => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                open();
                                              }
                                            }}
                                            title={`${ev.startStr} - ${ev.endStr} ${ev.title}`}
                                          >
                                            <div className="week-event-time">
                                              {ev.startStr}-{ev.endStr}{ev.room && ev.room !== '-' ? ` - ${ev.room}` : ''}
                                            </div>
                                            <div className="week-event-title">{ev.title}</div>
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                  {sep && <div className={`week-separator-col week-separator-${sep.kind}`} />}
                                  {ci < weekCols.length - 1 && !sep && <div style={{ width: 0 }} />}
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <div className="day-empty">{t('plan.emptyWeek')}</div>
                      )}
                    </div>
                  )
                )}

                {planViewMode === 'month' && (
                  showMonthSkeleton ? (
                    renderPlanMonthSkeleton()
                  ) : (
                    <div className="month-shell">
                      <div className="month-weekdays">{MONTH_WEEKDAY_KEYS.map(k => <span key={k}>{t(k)}</span>)}</div>
                      <div className="month-grid">
                        {monthCells.map(cell => (
                          <div
                            key={cell.date}
                            className={`month-cell ${cell.inCurrentMonth ? '' : 'out'} ${cell.hasPlan ? 'has' : ''} ${cell.date === today ? 'today' : ''}`}
                            onClick={() => {
                              setPlanDate(cell.date);
                              setPlanViewMode('day');
                            }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setPlanDate(cell.date);
                                setPlanViewMode('day');
                              }
                            }}
                          >
                            <span className="month-cell-num">{cell.date.slice(-2)}</span>
                            {cell.hasPlan && <span className="month-dot" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
          {renderInlineLegend('plan-legend-bottom')}
        </div>

      </section>
    );
  }

  function renderGrades() {
    return (
      <GradesScreen
        t={t}
        gradesSummary={gradesSummary}
        gradesLoading={gradesLoading}
        grades={visibleGrades}
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
        surveys={surveys}
        surveysMissingScopes={effectiveSurveysMissingScopes}
      />
    );
  }
  function renderNews() {
    return (
      <NewsScreen
        newsLoading={newsLoading}
        news={news}
        t={t}
        onOpenDetail={(item) => nav.push('news-detail', { item } as unknown as NewsDetailParams)}
      />
    );
  }

  function renderNewsDetail() {
    const p = (nav.current.params ?? {}) as NewsDetailParams;
    return <NewsDetailScreen key={p.item?.id ?? 'empty-news'} item={p.item} t={t} backInterceptRef={overlayBackAttemptRef} />;
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
    return <AboutScreen canOfferInstall={canOfferInstall} handleInstallPwa={handleInstallPwa} isIosSafari={isIosSafari} t={t} />;
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
    if (screen !== 'plan') return null;
    return (
      <PlanSearchSheet
        planSearchOpen={planSearchOpen}
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
    const actions: Array<{ key: string; icon: string; label: string; onClick: () => void; active: boolean }> = [];
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
              void loadPlanData();
            }
            return;
          }

          if (planDate !== td) {
            commitPlanNavigate(td, planDate > td);
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
    } else if (screen === 'home' && canOfferInstall) {
      actions.push({ key: 'install', icon: 'download', label: t('install.now'), onClick: () => void handleInstallPwa(), active: false });
    } else if (screen === 'grades') {
      actions.push({
        key: 'refresh',
        icon: 'refresh',
        label: t('grades.refreshLabel'),
        onClick: () => {
          void loadGradesData(true);
          void loadGradesPlanFilters(true);
        },
        active: false,
      });
    } else if (screen === 'finance') {
      actions.push({ key: 'refresh', icon: 'refresh', label: t('finance.refresh'), onClick: () => void loadFinanceData(true), active: false });
    } else if (screen === 'info') {
      actions.push({ key: 'refresh', icon: 'refresh', label: t('plan.refresh'), onClick: () => void loadInfoData(true), active: false });
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
          <button key={a.key} type="button" className={`icon-btn ${a.active ? 'active' : ''}`} onClick={a.onClick} aria-label={a.label} title={a.label}>
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
                      <span className="plan-overflow-note">{action.note}</span>
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
  const phoneViewportClass = `${phoneViewport.isPhone ? ' is-phone-viewport' : ''}${phoneViewport.needsScaleFix ? ' is-phone-scale-fix' : ''}`;

  return (
    <div
      className={`app-shell${screen === 'login' ? ' is-login' : ''}${phoneViewportClass}`}
      onTouchStart={swipe.onTouchStart}
      onTouchMove={swipe.onTouchMove}
      onTouchEnd={swipe.onTouchEnd}
      onTouchCancel={swipe.onTouchCancel}
    >
      {/* AppBar */}
      {screen !== 'login' && (
        <header className="android-appbar">
          <button type="button" className={`icon-btn appbar-nav-btn${screen === 'news-detail' ? ' is-back' : ''}`} onClick={screen === 'news-detail' ? nav.goBack : onNavIcon} aria-label={screen === 'news-detail' ? t('general.back') : t('general.openMenu')}>
            <Ic n={screen === 'news-detail' ? 'back' : 'menu'} />
          </button>
          <h1>{t(SCREEN_I18N_KEY[screen])}</h1>
          {renderAppBarActions()}
        </header>
      )}

      {/* Global loading / error banners */}
      {(globalLoading || globalError) && (
        <div className={`notification-rail${screen === 'login' ? ' is-login' : ''}`} aria-live="polite" aria-atomic="true">
          <div className="notification-stack">
            {globalLoading && (
              <div className="banner banner-loading" role="status">
                <div className="banner-spinner" />
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
                <button type="button" className="banner-retry" onClick={() => setGlobalError('')}>Zamknij</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <main key={screen}>
        {renderScreen()}
      </main>

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* PWA Install Tip */}
      {showInstallTip && (
        <div className={`install-tip-overlay${installTipFading ? ' fading' : ''}`}>
          <div className="install-tip-card">
            <div className="install-tip-icon">📱</div>
            <p className="install-tip-msg">
              {t('install.tip')}
            </p>
            <div className="install-tip-actions">
              <button
                type="button"
                className="install-tip-install-btn"
                onClick={() => void handleInstallTipInstall()}
              >
                {isIosSafari ? t('install.howIos') : t('install.now')}
              </button>
              <button
                type="button"
                className="install-tip-dismiss-btn"
                onClick={() => dismissInstallTip()}
              >
                {t('install.dismiss')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iOS Safari install instructions */}
      {showIosInstructions && (
        <div className="ios-inst-overlay" onClick={() => setShowIosInstructions(false)}>
          <div className="ios-inst-card" onClick={e => e.stopPropagation()}>
            <div className="ios-inst-title">{t('install.iosTitle')}</div>
            <ol className="ios-inst-steps">
              <li>
                <span className="ios-inst-icon">⬆️</span>
                <span dangerouslySetInnerHTML={{ __html: t('install.iosStep1') }} />
              </li>
              <li>
                <span className="ios-inst-icon">➕</span>
                <span dangerouslySetInnerHTML={{ __html: t('install.iosStep2') }} />
              </li>
              <li>
                <span className="ios-inst-icon">✅</span>
                <span dangerouslySetInnerHTML={{ __html: t('install.iosStep3') }} />
              </li>
            </ol>
            <button type="button" className="ios-inst-close" onClick={() => setShowIosInstructions(false)}>
              {t('install.iosOk')}
            </button>
          </div>
        </div>
      )}

      {renderPlanEventSheet()}
      {renderPlanSearchSheet()}
      {renderPlanFiltersSheet()}

      {/* Navigation Drawer */}
      {screen !== 'login' && (
        <div className={`app-drawer ${drawerOpen ? 'open' : ''}`} aria-hidden={!drawerOpen} aria-modal={drawerOpen}>
          <button type="button" className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-label={t('general.closeMenu')} />
          <aside className="drawer-panel" role="navigation" aria-label={t('general.openMenu')}>
            <div className="drawer-header">
              <img src={LOGO_SRC} alt="ZUTnik" className="drawer-header-logo" />
              <div className="drawer-header-info">
                <div className="drawer-header-title">ZUTnik</div>
                <div className="drawer-header-user">{session?.username || t('info.studentNameFallback')}</div>
              </div>
            </div>

            <div className="drawer-divider" />

            <div className="drawer-list">
              {drawerItems.map(item => (
                <button key={item.key} type="button" className={`drawer-item ${screen === item.key ? 'active' : ''}`} onClick={() => openScreen(item.key)}>
                  <span className="drawer-item-icon"><Ic n={item.icon} /></span>
                  {item.label}
                </button>
              ))}
            </div>

            <div className="drawer-footer">
              <button type="button" className="drawer-logout" onClick={() => { if (window.confirm(t('logout.confirm'))) { applySession(null); setDrawerOpen(false); } }}>
                <Ic n="logout" />
                {t('logout.button')}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export default App;
