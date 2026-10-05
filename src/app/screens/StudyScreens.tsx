import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import type {
  CalendarEvent,
  CreditSummary,
  ElsCard,
  FinanceRecord,
  Grade,
  SessionData,
  Study,
  StudyDetails,
  StudyHistoryItem,
} from '../../types';
import type { AppSettings } from '../../services/storage';
import type { GroupedGradeView, TranslateFn } from '../viewTypes';
import { fmtDec, gradeCorrectionLabel, gradeTone, initials, isFinalGradeType } from '../helpers';
import { Ic, Select } from '../ui';
import { FinanceLoadingSkeleton, GradeMetrics, GradesLoadingSkeleton, InfoMainLoadingSkeleton } from './ScreenLoaders';
import { useLoadingReveal } from '../../hooks/useLoadingReveal';

type FinanceFilterKey = 'all' | 'due' | 'paid' | 'overpaid';
type FinanceStatusKey = 'due' | 'paid' | 'overpaid' | 'unknown';

function getFinanceStatus(record: FinanceRecord): FinanceStatusKey {
  if (record.balanceValue < -0.0001) return 'due';
  if (record.balanceValue > 0.0001) return 'overpaid';
  if (Math.abs(record.balanceValue) <= 0.0001 && record.paidValue > 0.0001) return 'paid';
  return 'unknown';
}

function financeStatusRank(status: FinanceStatusKey): number {
  switch (status) {
    case 'due': return 0;
    case 'overpaid': return 1;
    case 'paid': return 2;
    default: return 3;
  }
}

function parseFinanceDateSortKey(raw: string | null): number {
  if (!raw) return Number.MAX_SAFE_INTEGER;

  const normalized = raw.trim();
  const dotted = normalized.match(/^(\d{2})[.-](\d{2})[.-](\d{2}|\d{4})$/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    const yearRaw = Number(dotted[3]);
    const year = dotted[3].length === 2 ? 2000 + yearRaw : yearRaw;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day
    ) {
      return parsed.getTime();
    }
  }

  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : Number.MAX_SAFE_INTEGER;
}

function getFinanceRelevantDateSortKey(record: FinanceRecord): number {
  const status = getFinanceStatus(record);
  const preferredDate = status === 'paid'
    ? record.paidDateText || record.dueDateText
    : record.dueDateText || record.paidDateText;
  return parseFinanceDateSortKey(preferredDate);
}

function sortFinanceRecords(records: FinanceRecord[]): FinanceRecord[] {
  return [...records].sort((left, right) => {
    const leftStatus = getFinanceStatus(left);
    const rightStatus = getFinanceStatus(right);
    const statusCompare = financeStatusRank(leftStatus) - financeStatusRank(rightStatus);
    if (statusCompare !== 0) return statusCompare;

    const leftDate = getFinanceRelevantDateSortKey(left);
    const rightDate = getFinanceRelevantDateSortKey(right);
    const dateCompare = leftStatus === 'paid'
      ? rightDate - leftDate
      : leftDate - rightDate;
    if (dateCompare !== 0) return dateCompare;

    return (left.title || '').localeCompare(right.title || '', 'pl', { sensitivity: 'base' });
  });
}

function formatFinanceMoneyText(value: string | null): string {
  if (!value) return '';

  const normalized = value.trim();
  const compact = normalized
    .replace(/\s+/g, '')
    .replace(/zl/gi, '')
    .replace(/zł/gi, '')
    .trim();

  if (/^[-+]?\d+(?:[.,]\d+)?$/.test(compact)) {
    return `${compact.replace('.', ',')} zł`;
  }
  if (/z[lł]/i.test(normalized)) {
    return normalized.replace(/zl/gi, 'zł');
  }
  return normalized;
}

function formatFinanceValue(value: number, language: AppSettings['language']): string {
  const hasFraction = Math.abs(value - Math.round(value)) > 0.0001;
  return `${new Intl.NumberFormat(language === 'en' ? 'en-GB' : 'pl-PL', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value)} zł`;
}

function formatFinanceNoticeDate(timestamp: number, language: AppSettings['language']): string {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'pl-PL', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function getFinanceStatusLabel(status: FinanceStatusKey, t: TranslateFn): string {
  switch (status) {
    case 'due': return t('finance.statusDue');
    case 'paid': return t('finance.statusPaid');
    case 'overpaid': return t('finance.statusOverpaid');
    default: return t('finance.statusUnknown');
  }
}

function matchesFinanceFilter(record: FinanceRecord, filter: FinanceFilterKey): boolean {
  const status = getFinanceStatus(record);
  if (filter === 'all') return true;
  return status === filter;
}

function getFinanceCopyableAccount(accountText: string | null): string {
  return accountText ? accountText.replace(/\s+/g, '') : '';
}

function formatFinanceAccount(accountText: string | null): string {
  const raw = getFinanceCopyableAccount(accountText);
  if (!raw) return '';

  const parts: string[] = [];
  const digitsOnly = /^\d+$/.test(raw);
  const firstGroup = digitsOnly && raw.length >= 10 ? 2 : 4;

  for (let cursor = 0; cursor < raw.length;) {
    const size = cursor === 0 ? firstGroup : 4;
    parts.push(raw.slice(cursor, cursor + size));
    cursor += size;
  }

  return parts.join(' ');
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('copy_failed');
  }
}

function formatFinanceLine(template: string, value: string): string {
  return template.replace('{{value}}', value);
}

function buildFinanceDetailsText(record: FinanceRecord, t: TranslateFn): string {
  const lines = [record.title || t('finance.recordFallback')];

  if (record.amountText) lines.push(formatFinanceLine(t('finance.lineAmount'), formatFinanceMoneyText(record.amountText)));
  if (record.paidText) lines.push(formatFinanceLine(t('finance.linePaid'), formatFinanceMoneyText(record.paidText)));
  if (record.dueDateText) lines.push(formatFinanceLine(t('finance.lineDueDate'), record.dueDateText));
  if (record.paidDateText) lines.push(formatFinanceLine(t('finance.linePaidDate'), record.paidDateText));
  if (record.balanceText) lines.push(formatFinanceLine(t('finance.lineBalance'), formatFinanceMoneyText(record.balanceText)));

  const account = getFinanceCopyableAccount(record.accountText);
  if (account) {
    lines.push(formatFinanceLine(t('finance.lineAccount'), account));
  }

  return lines.filter(Boolean).join('\n');
}

function formatNullableNumber(value: number | null | undefined, fractionDigits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: Math.abs(value - Math.round(value)) > 0.0001 ? fractionDigits : 0,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

interface GradesScreenProps {
  t: TranslateFn;
  gradesSummary: { avg: string; ectsSem: string; ectsTotal: string };
  gradesLoading: boolean;
  grades: Grade[];
  settings: AppSettings;
  groupedGrades: GroupedGradeView[];
  expandedGradeSubjects: Record<string, boolean>;
  setExpandedGradeSubjects: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export function GradesScreen({
  t, gradesSummary, gradesLoading, grades, settings, groupedGrades,
  expandedGradeSubjects, setExpandedGradeSubjects,
}: GradesScreenProps) {
  const showSkeleton = gradesLoading && grades.length === 0;
  const revealRef = useLoadingReveal<HTMLDivElement>(showSkeleton);
  const gradeText = (grade: string) => grade.trim() || t('grades.missingGradeShort');
  const gradeTypeText = (grade: Grade) => isFinalGradeType(grade.type, grade.subjectName)
    ? t('grades.finalGrade') : grade.type || t('grades.component');
  const shortType = (grade: Grade) => {
    const type = gradeTypeText(grade);
    if (/lab/i.test(type)) return 'Lab';
    if (/wyk|lecture/i.test(type)) return t('grades.lectureShort');
    if (/ćw|cw|exercise/i.test(type)) return t('grades.exerciseShort');
    return type;
  };
  const hasContent = settings.gradesGrouping ? groupedGrades.length > 0 : grades.length > 0;
  return <section className="screen grades-screen" aria-busy={gradesLoading}>
    <GradeMetrics summary={gradesSummary} t={t} />
    {showSkeleton ? <GradesLoadingSkeleton /> : <div className="grades-surface" ref={revealRef}>
      {!gradesLoading && !hasContent && <div className="empty-state"><Ic n="grade" /><p>{t('grades.noGrades')}</p></div>}
      <div className="list-stack">
        {settings.gradesGrouping ? groupedGrades.map(({ subject, items, finalGrade, ects, emptyFromPlanFilter }) => {
          const isOpen = !!expandedGradeSubjects[subject];
          const canExpand = items.length > 0;
          const previewItems = items.slice(0, 3);
          const overflow = Math.max(0, items.length - previewItems.length);
          const hasCorrection = previewItems.some((grade) => !!gradeCorrectionLabel(grade));
          const hasFinal = !!finalGrade.trim();
          return <div className="grade-subject" key={subject}>
            <button type="button" className={`grade-group${isOpen ? ' is-open' : ''}${emptyFromPlanFilter ? ' is-empty-from-plan' : ''}`}
              onClick={() => { if (canExpand) setExpandedGradeSubjects((prev) => ({ ...prev, [subject]: !prev[subject] })); }}
              aria-expanded={canExpand && isOpen} aria-controls={canExpand ? `grade-details-${encodeURIComponent(subject)}` : undefined} aria-disabled={!canExpand}>
              <div className={`grade-group-head${canExpand ? '' : ' no-expand'}`}>
                <div className="grade-group-head-main"><div className="grade-group-name">{subject}</div></div>
                <div className="grade-group-side">
                  {emptyFromPlanFilter ? <div className="grade-group-summary"><div className="grade-group-pill neutral">-</div><div className="grade-group-summary-copy"><span>{t('grades.noGradesShort')}</span></div></div>
                    : (hasFinal || ects > 0) && <div className="grade-group-summary">
                      {hasFinal && <div className={`grade-group-pill ${gradeTone(finalGrade)}`}>{gradeText(finalGrade)}</div>}
                      <div className="grade-group-summary-copy">{hasFinal && <span>{t('grades.finalGrade')}</span>}{ects > 0 && <span>{fmtDec(ects, 1)} ECTS</span>}</div>
                    </div>}
                  {canExpand && <div className={`grade-group-chevron ${isOpen ? 'open' : ''}`}><Ic n="chevR" /></div>}
                </div>
              </div>
              {canExpand && <div className="grade-group-preview">
                {previewItems.map((grade, index) => <span key={index} className="grade-preview-item">
                  <span className="grade-preview-type" title={gradeTypeText(grade)}>{shortType(grade)}</span>
                  <span className={`grade-preview-pill ${gradeTone(grade.grade)}`}>{gradeText(grade.grade)}</span>
                  {hasCorrection && <span className={`grade-preview-correction${gradeCorrectionLabel(grade) ? '' : ' is-placeholder'}`}>{gradeCorrectionLabel(grade) || '\u00a0'}</span>}
                </span>)}
                {overflow > 0 && <span className="grade-preview-item"><span className="grade-preview-type is-placeholder" /><span className="grade-preview-pill count">+{overflow}</span>{hasCorrection && <span className="grade-preview-correction is-placeholder" />}</span>}
              </div>}
            </button>
            {canExpand && <div id={`grade-details-${encodeURIComponent(subject)}`} className={`grade-group-items-wrap ${isOpen ? 'open' : ''}`} hidden={!isOpen}>
              <div className="grade-group-items">{items.map((grade, index) => <div key={index} className="grade-row">
                <span className={`grade-pill ${gradeTone(grade.grade)}`}>{gradeText(grade.grade)}</span>
                <div className="grade-info"><div className="grade-type-chip">{gradeTypeText(grade)}</div>
                  {gradeCorrectionLabel(grade) && <span className="grade-correction-note">{gradeCorrectionLabel(grade)}</span>}
                  {grade.date && <div className="grade-date-teacher">{grade.date}</div>}
                  {grade.teacher && <div className="grade-date-teacher grade-date-teacher-secondary">{grade.teacher}</div>}
                </div>
              </div>)}</div>
            </div>}
          </div>;
        }) : grades.map((grade, index) => <div key={`flat-${index}-${grade.subjectName}`} className="grade-row grade-row-flat">
          <div className="grade-flat-top"><div className="grade-flat-subject">{grade.subjectName || t('grades.subject')}</div><span className={`grade-pill ${gradeTone(grade.grade)}`}>{gradeText(grade.grade)}</span></div>
          <div className="grade-flat-meta"><div className="grade-type-chip">{gradeTypeText(grade)}</div>
            {gradeCorrectionLabel(grade) && <span className="grade-correction-note">{gradeCorrectionLabel(grade)}</span>}
            {(grade.date || grade.teacher) && <div className="grade-date-teacher">{grade.date || '–'}{grade.teacher ? ` · ${grade.teacher}` : ''}</div>}
            {grade.weight > 0 && <div className="grade-ects-chip">{fmtDec(grade.weight, 1)} ECTS</div>}
          </div>
        </div>)}
      </div>
    </div>}
  </section>;
}

interface FinanceScreenProps {
  t: TranslateFn;
  language: AppSettings['language'];
  studies: Study[];
  activeStudyId: string | null;
  updateActiveStudy: (studyId: string | null) => void;
  financeRecords: FinanceRecord[];
  financeLoading: boolean;
  financeFetchedAt: number;
  onRefresh: () => void;
  onToast: (message: string) => void;
}

export function FinanceScreen({
  t,
  language,
  studies,
  activeStudyId,
  updateActiveStudy,
  financeRecords,
  financeLoading,
  financeFetchedAt,
  onRefresh,
  onToast,
}: FinanceScreenProps) {
  const [filter, setFilter] = useState<FinanceFilterKey>('all');
  const [noticeOpen, setNoticeOpen] = useState(false);

  const summary = useMemo(() => {
    let dueTotal = 0;
    let paidTotal = 0;
    let overpaidTotal = 0;
    let openItems = 0;

    for (const record of financeRecords) {
      paidTotal += Math.max(0, record.paidValue);

      const status = getFinanceStatus(record);
      if (status === 'due') {
        dueTotal += Math.abs(record.balanceValue);
        openItems += 1;
      } else if (status === 'overpaid') {
        overpaidTotal += record.balanceValue;
      }
    }

    return { dueTotal, paidTotal, overpaidTotal, openItems };
  }, [financeRecords]);

  const filteredRecords = useMemo(() => (
    sortFinanceRecords(financeRecords.filter((record) => matchesFinanceFilter(record, filter)))
  ), [financeRecords, filter]);

  const showSkeleton = financeLoading && financeRecords.length === 0;
  const revealRef = useLoadingReveal<HTMLElement>(showSkeleton);
  const noticeDateText = financeFetchedAt > 0
    ? formatFinanceNoticeDate(financeFetchedAt, language)
    : t('finance.noticeLoading');
  const noticeMain = t('finance.noticeMain').replace('{{date}}', noticeDateText);

  const handleCopyAccount = async (record: FinanceRecord) => {
    const account = getFinanceCopyableAccount(record.accountText);
    if (!account) {
      onToast(t('finance.copyAccountMissing'));
      return;
    }

    try {
      await copyTextToClipboard(account);
      onToast(t('finance.copyAccountSuccess'));
    } catch {
      onToast(t('finance.copyFailed'));
    }
  };

  const handleCopyDetails = async (record: FinanceRecord) => {
    try {
      await copyTextToClipboard(buildFinanceDetailsText(record, t));
      onToast(t('finance.copyDetailsSuccess'));
    } catch {
      onToast(t('finance.copyFailed'));
    }
  };

  const emptyMessage = (() => {
    switch (filter) {
      case 'due': return t('finance.emptyDue');
      case 'paid': return t('finance.emptyPaid');
      case 'overpaid': return t('finance.emptyOverpaid');
      default: return t('finance.emptyAll');
    }
  })();

  return (
    <section ref={revealRef} className={`screen finance-screen${noticeOpen ? ' notice-open' : ''}`} aria-busy={financeLoading}>
      {showSkeleton ? (
        <FinanceLoadingSkeleton />
      ) : (
        <>
          <div className="finance-header-wrapper">
            <div className="finance-hero">
              <div className="finance-hero-head">
                <div className="finance-hero-copy">
                  <div className="finance-hero-title">{t('finance.overview')}</div>
                  <div className="finance-hero-subtitle">{t('finance.subtitle')}</div>
                </div>
                <button
                  type="button"
                  className="finance-refresh-btn"
                  onClick={onRefresh}
                  disabled={financeLoading}
                  aria-label={t('finance.refresh')}
                >
                  <Ic n="refresh" />
                </button>
              </div>

              <div className="metrics-row finance-summary-grid">
                <div className="metric-card">
                  <div className="metric-label">{t('finance.summaryDue')}</div>
                  <div className="metric-value">{formatFinanceValue(summary.dueTotal, language)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t('finance.summaryPaid')}</div>
                  <div className="metric-value">{formatFinanceValue(summary.paidTotal, language)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t('finance.summaryOpen')}</div>
                  <div className="metric-value">{summary.openItems}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t('finance.summaryOverpaid')}</div>
                  <div className="metric-value">{formatFinanceValue(summary.overpaidTotal, language)}</div>
                </div>
              </div>
            </div>

            <div className="finance-filters-container">
              {studies.length > 0 && (
                <label className="field-label">
                  {t('finance.studyField')}
                  <Select value={activeStudyId ?? ''} onChange={(e) => updateActiveStudy(e.target.value || null)}>
                    {studies.map((study) => (
                      <option key={study.przynaleznoscId} value={study.przynaleznoscId}>
                        {study.label}
                      </option>
                    ))}
                  </Select>
                </label>
              )}

              <div className="finance-filter-pills" role="tablist" aria-label={t('screen.finance')}>
                {([
                  { key: 'all', label: t('finance.filterAll') },
                  { key: 'due', label: t('finance.filterDue') },
                  { key: 'paid', label: t('finance.filterPaid') },
                  { key: 'overpaid', label: t('finance.filterOverpaid') },
                ] as Array<{ key: FinanceFilterKey; label: string }>).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`finance-filter-pill ${filter === item.key ? 'active' : ''}`}
                    role="tab"
                    aria-selected={filter === item.key}
                    onClick={() => setFilter(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="finance-surface">
            {financeRecords.length === 0 && !financeLoading ? (
              <div className="empty-state"><div className="empty-state-icon">💸</div><p>{t('finance.emptyAll')}</p></div>
            ) : filteredRecords.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">💳</div><p>{emptyMessage}</p></div>
            ) : (
              <div className="list-stack finance-list">
                {filteredRecords.map((record, index) => {
                  const status = getFinanceStatus(record);
                  const account = getFinanceCopyableAccount(record.accountText);
                  const hasMeta = Boolean(record.paidText || record.dueDateText || record.paidDateText);

                  return (
                    <article
                      key={`${record.title || 'finance'}-${record.dueDateText || record.paidDateText || index}`}
                      className="finance-record-card"
                    >
                      <div className="finance-record-top">
                        <div className="finance-record-heading">
                          <div className="finance-record-title">{record.title || t('finance.recordFallback')}</div>
                          <div className={`finance-status-chip ${status}`}>{getFinanceStatusLabel(status, t)}</div>
                        </div>
                      </div>

                      <div className="finance-record-metrics">
                        {record.amountText && (
                          <div className="metric-card finance-record-metric">
                            <div className="metric-label">{t('finance.labelAmount')}</div>
                            <div className="metric-value">{formatFinanceMoneyText(record.amountText)}</div>
                          </div>
                        )}
                        {record.balanceText && (
                          <div className={`metric-card finance-record-metric finance-balance-card ${status}`}>
                            <div className="metric-label">{t('finance.labelBalance')}</div>
                            <div className="metric-value">{formatFinanceMoneyText(record.balanceText)}</div>
                          </div>
                        )}
                      </div>

                      {hasMeta && (
                        <div className="finance-meta-card">
                          {record.paidText && (
                            <div className="finance-meta-row">
                              <span>{t('finance.labelPaid')}</span>
                              <strong>{formatFinanceMoneyText(record.paidText)}</strong>
                            </div>
                          )}
                          {record.dueDateText && (
                            <div className="finance-meta-row">
                              <span>{t('finance.labelDueDate')}</span>
                              <strong>{record.dueDateText}</strong>
                            </div>
                          )}
                          {record.paidDateText && (
                            <div className="finance-meta-row">
                              <span>{t('finance.labelPaidDate')}</span>
                              <strong>{record.paidDateText}</strong>
                            </div>
                          )}
                        </div>
                      )}

                      {account && (
                        <button
                          type="button"
                          className="finance-account-card"
                          onClick={() => void handleCopyAccount(record)}
                        >
                          <span className="finance-account-label">{t('finance.labelAccount')}</span>
                          <span className="finance-account-value">{formatFinanceAccount(record.accountText)}</span>
                        </button>
                      )}

                      <div className="finance-record-actions">
                        <button
                          type="button"
                          className="finance-action-btn"
                          onClick={() => void handleCopyAccount(record)}
                          disabled={!account}
                        >
                          {t('finance.copyAccount')}
                        </button>
                        <button
                          type="button"
                          className="finance-action-btn"
                          onClick={() => void handleCopyDetails(record)}
                        >
                          {t('finance.copyDetails')}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`finance-notice-card ${noticeOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className="finance-notice-toggle"
              onClick={() => setNoticeOpen((prev) => !prev)}
              aria-expanded={noticeOpen}
            >
              <span className="finance-notice-icon">i</span>
              <span className="finance-notice-copy">
                <span className="finance-notice-title">{t('finance.noticeTitle')}</span>
                <span className="finance-notice-date">{noticeDateText}</span>
              </span>
              <span className={`finance-notice-chevron ${noticeOpen ? 'open' : ''}`}><Ic n="chevR" /></span>
            </button>

            {noticeOpen && (
              <div className="finance-notice-content">
                <p>{noticeMain}</p>
                <p>{t('finance.noticeOverpaid')}</p>
                <p>{t('finance.noticeAssignments')}</p>
                <p>{t('finance.noticeContact')}</p>
                <p>{t('finance.copyAccountWarning')}</p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

interface InfoScreenProps {
  session: SessionData | null;
  studies: Study[];
  activeStudyId: string | null;
  updateActiveStudy: (studyId: string | null) => void;
  studentPhotoBlobUrl: string | null;
  studentPhotoError: boolean;
  t: TranslateFn;
  infoLoading: boolean;
  details: StudyDetails | null;
  history: StudyHistoryItem[];
  els: ElsCard | null;
  calendarEvents: CalendarEvent[];
  credits: CreditSummary | null;
  onRefresh: () => void;
}

export function InfoScreen({
  session, studies, activeStudyId, updateActiveStudy, studentPhotoBlobUrl, studentPhotoError,
  t, infoLoading, details, history, els, calendarEvents, credits, onRefresh,
}: InfoScreenProps) {
  const hasSideColumn = !!session || studies.length > 0;
  const showSkeleton = infoLoading && !details && history.length === 0 && !els && calendarEvents.length === 0;
  const revealRef = useLoadingReveal<HTMLDivElement>(showSkeleton);
  const row = (label: string, value: string, className = '') => <div className="info-row" key={label}><div className="info-row-label">{label}</div><div className={`info-row-value ${className}`}>{value || '–'}</div></div>;
  return <section className={`screen info-screen${hasSideColumn ? '' : ' info-screen-full'}`} aria-busy={infoLoading}>
    {hasSideColumn && <aside className="info-side">
      {session && <div className="info-profile-card">
        {studentPhotoBlobUrl && !studentPhotoError ? <img src={studentPhotoBlobUrl} alt={t('info.photoAlt')} className="info-profile-photo" /> : <div className="info-profile-fallback">{initials(session.username || 'S')}</div>}
        <div className="info-profile-meta"><div className="info-profile-eyebrow">{t('screen.info')}</div><div className="info-profile-name">{session.username || t('info.studentNameFallback')}</div><div className="info-profile-id">{t('info.detailAlbum')}: {details?.album || session.userId || '–'}</div></div>
        <button className="icon-btn info-refresh-btn" onClick={onRefresh} disabled={infoLoading} aria-label={t('plan.refresh')} title={t('plan.refresh')}><Ic n="refresh" /></button>
      </div>}
      {studies.length > 0 && <label className="field-label info-study-select">{t('info.studyField')}<Select value={activeStudyId ?? ''} onChange={(event) => updateActiveStudy(event.target.value || null)}>{studies.map((study) => <option key={study.przynaleznoscId} value={study.przynaleznoscId}>{study.label}</option>)}</Select></label>}
    </aside>}
    {showSkeleton ? <InfoMainLoadingSkeleton /> : <div className="info-main" ref={revealRef}>
      {credits && (credits.programmeUsed !== null || credits.overallUsed !== null) && <div className="info-card ects-card"><div className="info-card-head">{t('info.ectsProgress')}</div>
        {row(t('info.ectsProgramme'), `${formatNullableNumber(credits.programmeUsed)} ECTS`)}
        {row(t('info.ectsOverall'), `${formatNullableNumber(credits.overallUsed)} ECTS`)}
      </div>}
      {els && <div className="info-card"><div className="info-card-head">{t('info.elsTitle')}</div>
        {row(t('info.detailStatus'), t(els.isActive ? 'info.elsActive' : 'info.elsInactive'), els.isActive ? 'status-success' : 'status-danger')}
        {row(t('info.elsExpires'), els.expirationDate)}
        {row(t('info.elsNumber'), els.id)}
      </div>}
      {details && <div className="info-card"><div className="info-card-head">{t('info.currentStudies')}</div>
        {([{ l: t('info.detailAlbum'), v: details.album }, { l: t('info.detailField'), v: details.kierunek }, { l: t('info.detailStatus'), v: details.status }, { l: t('info.detailFaculty'), v: details.wydzial }, { l: t('info.detailForm'), v: details.forma }, { l: t('info.detailLevel'), v: details.poziom }, { l: t('info.detailSpecialty'), v: details.specjalnosc }, { l: t('info.detailSpecialization'), v: details.specjalizacja }].filter((item) => item.v)).map((item) => row(item.l, item.v))}
        <div className="info-study-term">{details.rokAkademicki && <span>{t('info.detailYear')}: <strong>{details.rokAkademicki}</strong></span>}{details.semestrLabel && <span>{t('info.detailSem')}: <strong>{details.semestrLabel}</strong></span>}</div>
      </div>}
      {history.length > 0 && <div className="info-card info-history-card"><div className="info-card-head"><Ic n="grade" />{t('info.studyHistory')}</div>{history.map((item, index) => <div key={index} className="history-row"><span className="history-label">{item.label}</span><span className="history-status">{item.status}</span></div>)}</div>}
      {calendarEvents.length > 0 && <details className="info-calendar"><summary>{t('info.calendarTitle')}</summary>{calendarEvents.map((event) => <div className="history-row" key={event.id}><div><div className="history-label">{event.name}</div><div className="history-status">{event.startDate === event.endDate ? event.startDate : `${event.startDate} – ${event.endDate}`}</div></div>{event.isDayOff && <span className="status-success">{t('info.dayOff')}</span>}</div>)}</details>}
      {!infoLoading && !details && !els && !credits && <div className="empty-state"><Ic n="user" /><p>{t('info.empty')}</p></div>}
    </div>}
  </section>;
}
