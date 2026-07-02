export type ViewMode = 'day' | 'week' | 'month';

export interface UsosSessionData {
  accessToken: string;
  accessTokenSecret: string;
  scopes?: string[];
  authorizedAt?: number;
  expiresAt?: number;
}

export interface SessionData {
  userId: string;
  username: string;
  authKey: string;
  imageUrl: string;
  tokenJpg?: string;
  activeStudyId: string | null;
  usos?: UsosSessionData;
  persistedAt?: number;
}

export interface UsosGrade {
  courseId: string;
  courseName: string;
  grade: string;
  date: string;
  term: number;
}

export interface Study {
  przynaleznoscId: string;
  label: string;
}

export interface Semester {
  listaSemestrowId: string;
  nrSemestru: string;
  pora: string;
  rokAkademicki: string;
  status: string;
}

export interface Grade {
  subjectName: string;
  courseId?: string;
  grade: string;
  weight: number;
  type: string;
  teacher: string;
  date: string;
  gradeDescription?: string;
  passes?: boolean | null;
  countsIntoAverage?: boolean | null;
  examId?: string;
  examSessionNumber?: string;
}

export interface FinanceRecord {
  title: string;
  amountText: string | null;
  paidText: string | null;
  dueDateText: string | null;
  paidDateText: string | null;
  balanceText: string | null;
  accountText: string | null;
  amountValue: number;
  paidValue: number;
  balanceValue: number;
}

export interface FinanceSnapshot {
  records: FinanceRecord[];
  fetchedAt: number;
}

export interface ElsCard {
  id: string;
  expirationDate: string;
  isActive: boolean;
}

export interface CalendarEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  type: string;
  isDayOff: boolean;
}

export interface StudyDetails {
  album: string;
  wydzial: string;
  kierunek: string;
  forma: string;
  poziom: string;
  specjalnosc: string;
  specjalizacja: string;
  status: string;
  rokAkademicki: string;
  semestrLabel: string;
}

export interface StudyHistoryItem {
  label: string;
  status: string;
}

export interface CreditSummary {
  studentProgrammeId: string;
  programmeUsed: number | null;
  overallUsed: number | null;
}

export interface SurveyItem {
  id: string;
  title: string;
  type: string;
  startDate: string;
  endDate: string;
  canFillOut: boolean;
  didFillOut: boolean;
  headlineHtml: string;
  courseName: string;
  lecturerName: string;
  facultyName: string;
  programmeName: string;
}

export interface CourseTestScore {
  id: string;
  name: string;
  type: 'points' | 'grade';
  value: string;
  points: number | null;
  maxPoints: number | null;
  date: string;
  comment: string;
}

export interface CourseTest {
  id: string;
  rootId: string;
  courseId: string;
  termId: string;
  courseName: string;
  testName: string;
  scores: CourseTestScore[];
}

export interface NewsItem {
  id: number;
  title: string;
  date: string;
  pubDateRaw: string;
  snippet: string;
  link: string;
  descriptionHtml: string;
  descriptionText: string;
  contentHtml: string;
  thumbUrl: string;
}

export interface StatsSeriesDay {
  key: string;
  labelShort: string;
  labelLong: string;
  activeDevices: number;
  successfulLogins: number;
  newDevices: number;
}

export interface StatsKpis {
  todayActiveDevices: number;
  uniqueActive30d: number;
  returningDevices30d: number;
  returningShare30d: number;
  newDevices30d: number;
  successfulLoginsToday: number;
  successfulLoginsTotal: number;
  totalDevices: number;
  totalApiHits: number;
  averageActive7d: number;
  averageLogins7d: number;
  todayDeltaActive: number;
  todayDeltaLogins: number;
  newDevicesToday: number;
}

export interface StatsPeak {
  label: string;
  value: number;
}

export interface StatsCountShare {
  key?: string;
  label: string;
  count: number;
  share: number;
}

export interface StatsSnapshot {
  series: StatsSeriesDay[];
  kpis: StatsKpis;
  peaks: {
    active: StatsPeak | null;
    logins: StatsPeak | null;
  };
  topDays: Array<StatsSeriesDay & { summaryLabel: string }>;
  recentRows: StatsSeriesDay[];
  activeMix: StatsCountShare[];
  loginMethods: StatsCountShare[];
  loginMethodCoverage: {
    recordedTotal: number;
    overallTotal: number;
    isPartial: boolean;
  };
  meta: {
    todayKey: string;
    trackedSinceLabel: string;
    updatedAtLabel: string;
    chartMax: number;
  };
}

export interface PlanEventUi {
  startMin: number;
  endMin: number;
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
  title: string;
  room: string;
  group: string;
  startStr: string;
  endStr: string;
  tooltip: string;
  typeClass: string;
  typeLabel: string;
  subjectKey: string;
  teacher: string;
}

export interface PlanDayColumn {
  date: string;
  events: PlanEventUi[];
}

export interface PlanMonthCell {
  date: string;
  hasPlan: boolean;
  inCurrentMonth: boolean;
}

export interface PlanSubjectFilter {
  key: string;
  label: string;
  subjectLabel?: string;
  typeKey?: string;
  typeLabel?: string;
  count: number;
}

export interface SessionPeriod {
  key: string;  // e.g. 'sesja_zimowa', 'przerwa_dydaktyczna_letnia'
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface PlanResult {
  viewMode: ViewMode;
  currentDate: string;
  rangeStart: string;
  rangeEnd: string;
  dayColumns: PlanDayColumn[];
  hasAnyEventsInRange: boolean;
  monthGrid: PlanMonthCell[][];
  subjectFilters: PlanSubjectFilter[];
  prevDate: string;
  nextDate: string;
  todayDate: string;
  headerLabel: string;
  sessionPeriods: SessionPeriod[];
  debug: {
    album: string;
    entriesTotal: number;
    daysWithData: string[];
  };
}

export interface UsefulLink {
  id: string;
  title: string;
  description: string;
  url: string;
  scope: 'GLOBAL' | 'FACULTY';
  facultyCode?: string;
}

export type ScreenKey =
  | 'login'
  | 'home'
  | 'plan'
  | 'grades'
  | 'finance'
  | 'info'
  | 'news'
  | 'news-detail'
  | 'stats'
  | 'links'
  | 'settings'
  | 'about';
