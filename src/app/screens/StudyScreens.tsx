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
  SurveyItem,
} from '../../types';
import type { AppSettings } from '../../services/storage';
import type { GroupedGradeView, TranslateFn } from '../viewTypes';
import { fmtDec, gradeTone, initials, isFinalGradeType } from '../helpers';
import { Ic, Skeleton } from '../ui';

function GradesLoadingSkeleton() {
  return (
    <>
      <div className="grades-header-wrapper">
        <div className="grades-hero skeleton-panel">
          <div className="metrics-row">
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="metric-card metric-card-skeleton">
                <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: idx === 1 ? '58%' : '46%' }} />
                <Skeleton className="skeleton-line skeleton-line-lg" style={{ width: idx === 2 ? '42%' : '64%' }} />
              </div>
            ))}
          </div>
        </div>

        <div className="grades-filters-container skeleton-panel">
          <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '72%' }} />
        </div>
      </div>

      <div className="grades-surface">
        <div className="list-stack grades-skeleton-list">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="grade-group grade-group-skeleton">
              <div className="grade-group-head">
                <div className="grade-group-head-main">
                  <Skeleton className="skeleton-circle grade-group-icon-skeleton" />
                  <div className="grade-group-name-wrap grade-group-name-wrap-skeleton">
                    <Skeleton className="skeleton-line skeleton-line-md" style={{ width: idx % 2 === 0 ? '72%' : '61%' }} />
                    <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '38%' }} />
                  </div>
                </div>

                <div className="grade-group-side">
                  <div className="grade-group-summary">
                    <Skeleton className="skeleton-pill grade-group-pill-skeleton" />
                    <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '68px' }} />
                  </div>
                  <Skeleton className="skeleton-circle grade-chevron-skeleton" />
                </div>
              </div>

              <div className="grade-group-items grade-group-items-skeleton">
                {[0, 1].map((row) => (
                  <div key={row} className="grade-row">
                    <Skeleton className="skeleton-circle grade-pill-skeleton" />
                    <div className="grade-info">
                      <Skeleton className="skeleton-pill grade-type-chip-skeleton" style={{ width: row === 0 ? '112px' : '96px' }} />
                      <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: row === 0 ? '48%' : '56%' }} />
                      <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '34%' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

type FinanceFilterKey = 'all' | 'due' | 'paid' | 'overpaid';
type FinanceStatusKey = 'due' | 'paid' | 'overpaid' | 'unknown';

function FinanceLoadingSkeleton() {
  return (
    <>
      <div className="finance-header-wrapper">
        <div className="finance-hero skeleton-panel">
          <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '88%' }} />
          <div className="metrics-row">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="metric-card metric-card-skeleton">
                <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '54%' }} />
                <Skeleton className="skeleton-line skeleton-line-lg" style={{ width: idx % 2 === 0 ? '66%' : '52%' }} />
              </div>
            ))}
          </div>
        </div>

        <div className="finance-filters-container skeleton-panel">
          <div className="field-label skeleton-field">
            <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '34%' }} />
            <Skeleton className="skeleton-block skeleton-input" />
          </div>
          <div className="finance-filter-pills finance-filter-pills-skeleton">
            {Array.from({ length: 4 }).map((_, idx) => (
              <Skeleton key={idx} className="skeleton-pill finance-filter-pill-skeleton" />
            ))}
          </div>
        </div>
      </div>

      <div className="finance-surface">
        <div className="list-stack finance-list">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="finance-record-card finance-record-card-skeleton">
              <div className="finance-record-top">
                <div className="finance-record-heading">
                  <Skeleton className="skeleton-line skeleton-line-md" style={{ width: idx % 2 === 0 ? '72%' : '58%' }} />
                  <Skeleton className="skeleton-pill finance-status-skeleton" />
                </div>
              </div>
              <div className="finance-record-metrics">
                {Array.from({ length: 2 }).map((__, metricIdx) => (
                  <div key={metricIdx} className="metric-card metric-card-skeleton">
                    <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '42%' }} />
                    <Skeleton className="skeleton-line skeleton-line-lg" style={{ width: metricIdx === 0 ? '60%' : '48%' }} />
                  </div>
                ))}
              </div>
              <div className="finance-meta-card finance-meta-card-skeleton">
                {Array.from({ length: 3 }).map((__, rowIdx) => (
                  <div key={rowIdx} className="finance-meta-row">
                    <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '28%' }} />
                    <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: rowIdx === 0 ? '32%' : '44%' }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

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

function formatFinanceValue(value: number): string {
  const hasFraction = Math.abs(value - Math.round(value)) > 0.0001;
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value)} zł`;
}

function formatFinanceNoticeDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
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

function hasMissingScope(scopes: string[], scope: string): boolean {
  return scopes.includes(scope);
}

function InfoMainLoadingSkeleton() {
  return (
    <div className="info-main">
      <div className="info-card info-card-skeleton">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="info-row">
            <Skeleton className="skeleton-line skeleton-line-xs info-row-label-skeleton" />
            <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: idx % 2 === 0 ? '56%' : '68%' }} />
          </div>
        ))}
      </div>

      <div className="info-card info-card-skeleton">
        <div className="info-card-head">
          <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '136px' }} />
        </div>
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="history-row">
            <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: idx === 0 ? '46%' : '58%' }} />
            <Skeleton className="skeleton-pill info-history-status-skeleton" style={{ width: idx === 1 ? '88px' : '72px' }} />
          </div>
        ))}
      </div>

      <div className="info-card info-card-skeleton">
        <div className="info-card-head">
          <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '164px' }} />
        </div>
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="history-row info-calendar-row-skeleton">
            <div className="info-calendar-copy-skeleton">
              <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: idx === 2 ? '64%' : '78%' }} />
              <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '42%' }} />
            </div>
            <Skeleton className="skeleton-pill info-calendar-pill-skeleton" style={{ width: idx === 1 ? '84px' : '60px' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface GradesScreenProps {
  t: TranslateFn;
  gradesSummary: { avg: string; ects: string; count: string };
  gradesLoading: boolean;
  grades: Grade[];
  settings: AppSettings;
  groupedGrades: GroupedGradeView[];
  expandedGradeSubjects: Record<string, boolean>;
  setExpandedGradeSubjects: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export function GradesScreen({
  t,
  gradesSummary,
  gradesLoading,
  grades,
  settings,
  groupedGrades,
  expandedGradeSubjects,
  setExpandedGradeSubjects,
}: GradesScreenProps) {
  const showGradesSkeleton = gradesLoading && grades.length === 0;
  const gradeText = (grade: string, fallbackKey: 'grades.missingGrade' | 'grades.missingGradeShort' = 'grades.missingGradeShort') => (
    grade.trim() || t(fallbackKey)
  );
  const gradeTypeText = (grade: Grade) => (
    isFinalGradeType(grade.type, grade.subjectName) ? t('grades.finalGrade') : (grade.type || t('grades.component'))
  );

  return (
    <section className="screen grades-screen">
      {showGradesSkeleton ? (
        <GradesLoadingSkeleton />
      ) : (
        <>
          <div className="grades-header-wrapper">
            <div className="grades-hero">
              <div className="metrics-row">
                <div className="metric-card"><div className="metric-label">{t('grades.avg')}</div><div className="metric-value">{gradesSummary.avg}</div></div>
                <div className="metric-card"><div className="metric-label">{t('grades.ects')}</div><div className="metric-value">{gradesSummary.ects}</div></div>
                <div className="metric-card"><div className="metric-label">{t('grades.count')}</div><div className="metric-value">{gradesSummary.count}</div></div>
              </div>
            </div>
          </div>

          <div className="grades-surface">
            {!gradesLoading && grades.length === 0 && (
              <div className="empty-state"><div className="empty-state-icon">🎓</div><p>{t('grades.noGrades')}</p></div>
            )}

            <div className="list-stack">
              {settings.gradesGrouping ? (
                groupedGrades.map(({ subject, items, finalGrade, ects }) => {
                  const isOpen = !!expandedGradeSubjects[subject];
                  const detailItems = items.filter((g) => !isFinalGradeType(g.type, g.subjectName));
                  const visibleItems = detailItems.length > 0 ? detailItems : items;
                  const previewItems = visibleItems.slice(0, 3);
                  const previewOverflow = Math.max(0, visibleItems.length - previewItems.length);
                  return (
                    <div key={subject} className={`grade-group${isOpen ? ' is-open' : ''}`}>
                      <button
                        type="button"
                        className="grade-group-head"
                        onClick={() => setExpandedGradeSubjects((prev) => ({ ...prev, [subject]: !prev[subject] }))}
                        aria-expanded={isOpen}
                      >
                        <div className="grade-group-head-main">
                          <div className="grade-group-icon"><Ic n="grade" /></div>
                          <div className="grade-group-name-wrap">
                            <div className="grade-group-name">{subject}</div>
                          </div>
                        </div>
                        <div className="grade-group-side">
                          <div className="grade-group-summary">
                            <div className={`grade-group-pill ${gradeTone(finalGrade)}`}>{gradeText(finalGrade)}</div>
                            <div className="grade-group-summary-copy">
                              <span>{t('grades.finalGrade')}</span>
                              {ects > 0 && <span>{fmtDec(ects, 1)} ECTS</span>}
                            </div>
                          </div>
                          <div className={`grade-group-chevron ${isOpen ? 'open' : ''}`}><Ic n="chevR" /></div>
                        </div>
                      </button>

                      {!isOpen && visibleItems.length > 0 && (
                        <div className="grade-group-preview">
                          {previewItems.map((g, i) => (
                            <span
                              key={`${subject}-preview-${i}`}
                              className={`grade-preview-pill ${gradeTone(g.grade)}`}
                            >
                              {g.grade.trim() || '–'}
                            </span>
                          ))}
                          {previewOverflow > 0 && (
                            <span className="grade-preview-pill count">+{previewOverflow}</span>
                          )}
                        </div>
                      )}

                      <div className={`grade-group-items-wrap ${isOpen ? 'open' : ''}`} aria-hidden={!isOpen}>
                        <div className="grade-group-items">
                          {visibleItems.map((g, i) => (
                            <div key={`${subject}-${i}`} className="grade-row">
                              <span className={`grade-pill ${gradeTone(g.grade)}`}>{g.grade.trim() || '–'}</span>
                              <div className="grade-info">
                                <div className="grade-type-chip">{gradeTypeText(g)}</div>
                                {!g.grade.trim() && <div className="grade-date-teacher grade-missing-note">{t('grades.missingGrade')}</div>}
                                {g.date && <div className="grade-date-teacher">{g.date}</div>}
                                {g.teacher && <div className="grade-date-teacher grade-date-teacher-secondary">{g.teacher}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="grade-group">
                  {grades.map((g, i) => (
                    <div key={`flat-${i}-${g.subjectName}`} className="grade-row grade-row-flat">
                      <div className="grade-flat-top">
                        <div className="grade-flat-subject">{g.subjectName || t('grades.subject')}</div>
                        <span className={`grade-pill ${gradeTone(g.grade)}`}>{g.grade.trim() || '–'}</span>
                      </div>
                      <div className="grade-flat-meta">
                        <div className="grade-type-chip">{gradeTypeText(g)}</div>
                        {!g.grade.trim() && <div className="grade-date-teacher grade-missing-note">{t('grades.missingGrade')}</div>}
                        {(g.date || g.teacher) && (
                          <div className="grade-date-teacher">
                            {g.date || '–'}{g.teacher ? ` · ${g.teacher}` : ''}
                          </div>
                        )}
                        {g.weight > 0 && <div className="grade-ects-chip">{fmtDec(g.weight, 1)} ECTS</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

interface FinanceScreenProps {
  t: TranslateFn;
  studies: Study[];
  activeStudyId: string | null;
  updateActiveStudy: (studyId: string | null) => void;
  financeRecords: FinanceRecord[];
  financeLoading: boolean;
  financeFetchedAt: number;
  onToast: (message: string) => void;
  hasProgrammeSplitNotice?: boolean;
}

export function FinanceScreen({
  t,
  studies,
  activeStudyId,
  updateActiveStudy,
  financeRecords,
  financeLoading,
  financeFetchedAt,
  onToast,
  hasProgrammeSplitNotice = false,
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
  const noticeDateText = financeFetchedAt > 0
    ? formatFinanceNoticeDate(financeFetchedAt)
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
    <section className={`screen finance-screen${noticeOpen ? ' notice-open' : ''}`}>
      {showSkeleton ? (
        <FinanceLoadingSkeleton />
      ) : (
        <>
          <div className="finance-header-wrapper">
            <div className="finance-hero">
              <div className="finance-hero-subtitle">{t('finance.subtitle')}</div>

              <div className="metrics-row finance-summary-grid">
                <div className="metric-card">
                  <div className="metric-label">{t('finance.summaryDue')}</div>
                  <div className="metric-value">{formatFinanceValue(summary.dueTotal)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t('finance.summaryPaid')}</div>
                  <div className="metric-value">{formatFinanceValue(summary.paidTotal)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t('finance.summaryOpen')}</div>
                  <div className="metric-value">{summary.openItems}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t('finance.summaryOverpaid')}</div>
                  <div className="metric-value">{formatFinanceValue(summary.overpaidTotal)}</div>
                </div>
              </div>
            </div>

            <div className="finance-filters-container">
              {studies.length > 0 && (
                <label className="field-label">
                  {t('finance.studyField')}
                  <select value={activeStudyId ?? ''} onChange={(e) => updateActiveStudy(e.target.value || null)}>
                    {studies.map((study) => (
                      <option key={study.przynaleznoscId} value={study.przynaleznoscId}>
                        {study.label}
                      </option>
                    ))}
                  </select>
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
                    onClick={() => setFilter(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {hasProgrammeSplitNotice && (
                <div className="usos-scope-note">{t('usos.programmeSplitNotice')}</div>
              )}
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
  surveys: SurveyItem[];
  surveysMissingScopes: string[];
}

export function InfoScreen({
  session,
  studies,
  activeStudyId,
  updateActiveStudy,
  studentPhotoBlobUrl,
  studentPhotoError,
  t,
  infoLoading,
  details,
  history,
  els,
  calendarEvents,
  credits,
  surveys,
  surveysMissingScopes,
}: InfoScreenProps) {
  const hasSideColumn = !!session || studies.length > 0;
  const showInfoSkeleton = infoLoading && !details && history.length === 0 && !els && calendarEvents.length === 0;
  const showSurveysCard = surveys.length > 0
    || hasMissingScope(surveysMissingScopes, 'surveys_filling')
    || (!infoLoading && !!details);

  return (
    <section className={`screen info-screen${hasSideColumn ? '' : ' info-screen-full'}`}>
      {hasSideColumn && (
        <aside className="info-side">
          {session && (
            <div className="info-profile-card">
              {studentPhotoBlobUrl && !studentPhotoError ? (
                <img
                  src={studentPhotoBlobUrl}
                  alt={t('info.photoAlt')}
                  className="info-profile-photo"
                />
              ) : (
                <div className="info-profile-fallback">{initials(session.username || 'S')}</div>
              )}
              <div className="info-profile-meta">
                <div className="info-profile-name">{session.username || t('info.studentNameFallback')}</div>
                <div className="info-profile-id">{t('info.userId')}: {session.userId || '-'}</div>
              </div>
            </div>
          )}

          {studies.length > 0 && (
            <label className="field-label info-study-select">
              {t('info.studyField')}
              <select value={activeStudyId ?? ''} onChange={(e) => updateActiveStudy(e.target.value || null)}>
                {studies.map((s) => <option key={s.przynaleznoscId} value={s.przynaleznoscId}>{s.label}</option>)}
              </select>
            </label>
          )}
        </aside>
      )}

      {showInfoSkeleton ? (
        <InfoMainLoadingSkeleton />
      ) : (
        <div className="info-main">
          {details && (
            <div className="info-card">
              {([
                { l: t('info.detailAlbum'), v: details.album },
                { l: t('info.detailFaculty'), v: details.wydzial },
                { l: t('info.detailField'), v: details.kierunek },
                { l: t('info.detailForm'), v: details.forma },
                { l: t('info.detailLevel'), v: details.poziom },
                { l: t('info.detailSpecialty'), v: details.specjalnosc },
                { l: t('info.detailSpecialization'), v: details.specjalizacja },
                { l: t('info.detailStatus'), v: details.status },
                { l: t('info.detailYear'), v: details.rokAkademicki },
                { l: t('info.detailSem'), v: details.semestrLabel },
              ].filter((r) => r.v)).map((r) => (
                <div key={r.l} className="info-row">
                  <div className="info-row-label">{r.l}</div>
                  <div className="info-row-value">{r.v}</div>
                </div>
              ))}
            </div>
          )}
          {credits && (credits.programmeUsed !== null || credits.overallUsed !== null) && (
            <div className="info-card ects-card">
              <div className="info-card-head">{t('info.ectsProgress')}</div>
              <div className="ects-metrics">
                <div className="ects-metric">
                  <div className="metric-label">{t('info.ectsProgramme')}</div>
                  <div className="metric-value">{formatNullableNumber(credits.programmeUsed)} ECTS</div>
                </div>
                <div className="ects-metric">
                  <div className="metric-label">{t('info.ectsOverall')}</div>
                  <div className="metric-value">{formatNullableNumber(credits.overallUsed)} ECTS</div>
                </div>
              </div>
            </div>
          )}
          {history.length > 0 && (
            <div className="info-card info-history-card">
              <div className="info-card-head">{t('info.studyHistory')}</div>
              {history.map((h, i) => (
                <div key={i} className="history-row">
                  <span className="history-label">{h.label}</span>
                  <span className="history-status">{h.status}</span>
                </div>
              ))}
            </div>
          )}

          {showSurveysCard && (
            <div className="info-card surveys-card">
              <div className="info-card-head">{t('info.surveysTitle')}</div>
              {hasMissingScope(surveysMissingScopes, 'surveys_filling') ? (
                <div className="info-inline-note">{t('info.surveysNeedsLogin')}</div>
              ) : surveys.length === 0 ? (
                <div className="info-inline-note">{t('info.surveysEmpty')}</div>
              ) : (
                surveys.map((survey) => (
                  <div key={survey.id} className="survey-row">
                    <div className="survey-main">
                      <div className="survey-title">{survey.title}</div>
                      <div className="survey-meta">
                        {[survey.type, survey.courseName, survey.lecturerName, survey.endDate ? `${t('info.surveyUntil')} ${survey.endDate}` : ''].filter(Boolean).join(' · ')}
                      </div>
                      {survey.headlineHtml && (
                        <div className="survey-headline" dangerouslySetInnerHTML={{ __html: survey.headlineHtml }} />
                      )}
                    </div>
                    <span className={`survey-status ${survey.canFillOut ? 'open' : 'done'}`}>
                      {survey.canFillOut ? t('info.surveyOpen') : t('info.surveyDone')}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {els && (
            <div className="info-card">
              <div className="info-card-head">Legitymacja Elektroniczna (ELS)</div>
              <div className="info-row">
                <div className="info-row-label">Status</div>
                <div className="info-row-value">
                  <span className={`grade-pill ${els.isActive ? 'ok' : 'bad'}`} style={{ padding: '4px 8px', fontSize: '13px' }}>
                    {els.isActive ? 'Aktywna' : 'Nieaktywna'}
                  </span>
                </div>
              </div>
              <div className="info-row">
                <div className="info-row-label">Ważna do</div>
                <div className="info-row-value">{els.expirationDate}</div>
              </div>
            </div>
          )}

          {calendarEvents.length > 0 && (
            <div className="info-card">
              <div className="info-card-head">Kalendarz Akademicki (30 dni)</div>
              {calendarEvents.map((ev, i) => (
                <div key={i} className="history-row" style={{ alignItems: 'flex-start', padding: '12px 16px' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div className="history-label">{ev.name}</div>
                    <div className="history-status" style={{ fontSize: '12px', opacity: 0.8, textAlign: 'left' }}>
                      {ev.startDate === ev.endDate ? ev.startDate : `${ev.startDate} – ${ev.endDate}`}
                    </div>
                  </div>
                  {ev.isDayOff && (
                    <span className="grade-pill ok" style={{ padding: '2px 6px', fontSize: '11px', alignSelf: 'center' }}>
                      Dzień wolny
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {!infoLoading && !details && (
            <div className="empty-state"><div className="empty-state-icon">👤</div><p>{t('info.empty')}</p></div>
          )}
        </div>
      )}
    </section>
  );
}
