import type { ScreenKey } from '../../types';
import type { TranslateFn } from '../viewTypes';
import { Skeleton, SkeletonRegion, Spinner } from '../ui';

export function MetricSkeletons({ count = 3, className = '' }: { count?: number; className?: string }) {
  return <div className={`metrics-row ${className}`}>{Array.from({ length: count }, (_, index) => <div key={index} className="metric-card metric-card-skeleton"><Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '64%' }} /><Skeleton className="skeleton-line skeleton-line-lg" style={{ width: '46%' }} /></div>)}</div>;
}

export function StatsLoadingSkeleton() {
  return <SkeletonRegion label="Ładowanie statystyk">
    <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '60%', marginBottom: 20 }} />
    <div className="stats-tabs stats-tabs-loading" aria-hidden><Skeleton className="skeleton-line skeleton-line-md" style={{ width: '42%' }} /><Skeleton className="skeleton-line skeleton-line-md" style={{ width: '42%' }} /></div>
    <div className="stats-kpi-grid">{[0, 1, 2, 3].map((key) => <div key={key} className="stats-kpi" aria-hidden><Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '80%' }} /><Skeleton className="skeleton-line skeleton-line-lg" style={{ width: '45%' }} /><Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '60%' }} /></div>)}</div>
    <div className="stats-section" aria-hidden><Skeleton className="skeleton-line skeleton-line-md" style={{ width: '42%' }} /><div className="stats-metric-select"><Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '70%' }} /></div><div className="stats-canvas stats-chart-loading">{[30, 65, 45, 80, 55, 90, 70, 50, 76, 88, 65, 95].map((height, i) => <Skeleton key={i} style={{ height: `${height}%` }} />)}</div></div>
  </SkeletonRegion>;
}

export function GradesLoadingSkeleton({ summary = false }: { summary?: boolean }) {
  return <SkeletonRegion className="grades-loading" label="Ładowanie ocen">
    {summary && <div className="grades-header-wrapper"><MetricSkeletons /></div>}
    <div className="grades-surface"><div className="list-stack grades-skeleton-list">{Array.from({ length: 4 }, (_, index) => <div key={index} className="grade-group grade-group-skeleton">
      <div className="grade-group-head"><Skeleton className="skeleton-line skeleton-line-md" style={{ width: index % 2 ? '64%' : '78%' }} /><Skeleton className="skeleton-circle grade-chevron-skeleton" /></div>
      <div className="grade-group-preview">{[0, 1].map((slot) => <span className="grade-preview-item" key={slot}><Skeleton className="skeleton-pill grade-preview-type-skeleton" /><Skeleton className="skeleton-circle grade-preview-pill" /></span>)}</div>
    </div>)}</div></div>
  </SkeletonRegion>;
}

export function FinanceLoadingSkeleton() {
  return <SkeletonRegion label="Ładowanie finansów">
    <div className="finance-header-wrapper"><div className="finance-hero"><div className="finance-hero-head"><div className="finance-hero-copy"><Skeleton className="skeleton-line skeleton-line-md" style={{ width: '170px' }} /><Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '88%', marginTop: 4 }} /></div></div><MetricSkeletons count={4} className="finance-summary-grid" /></div>
      <div className="finance-filters-container"><Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '96px', marginBottom: 8 }} /><Skeleton className="skeleton-input" /><Skeleton className="skeleton-input finance-filter-skeleton" /></div>
    </div>
    <div className="finance-surface"><div className="list-stack finance-list">{[0, 1, 2].map((index) => <div key={index} className="finance-record-card">
      <div className="finance-record-heading"><Skeleton className="skeleton-line skeleton-line-md" style={{ width: '64%' }} /><Skeleton className="skeleton-pill finance-status-skeleton" /></div>
      <div className="finance-record-metrics"><MetricSkeletons count={2} /></div>
      <div className="finance-meta-card">{[0, 1, 2].map((row) => <div className="finance-meta-row" key={row}><Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '32%' }} /><Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '38%' }} /></div>)}</div>
      <Skeleton className="skeleton-input" style={{ marginTop: 10 }} />
    </div>)}</div></div>
  </SkeletonRegion>;
}

export function InfoMainLoadingSkeleton() {
  return <SkeletonRegion className="info-main" label="Ładowanie informacji o studiach">{[2, 3, 5].map((count, index) => <div className="info-card info-card-skeleton" key={index}>
    <div className="info-card-head"><Skeleton className="skeleton-line skeleton-line-md" style={{ width: index === 0 ? 130 : 160 }} /></div>
    {Array.from({ length: count }, (_, row) => <div className="info-row" key={row}><Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '38%' }} /><Skeleton className="skeleton-line skeleton-line-sm" style={{ width: row % 2 ? '32%' : '48%' }} /></div>)}
  </div>)}</SkeletonRegion>;
}

export function GradeMetrics({ summary, t }: { summary: { avg: string; ectsSem: string; ectsTotal: string }; t: TranslateFn }) {
  return <div className="grades-header-wrapper"><div className="grades-hero"><div className="metrics-row">
    <div className="metric-card"><div className="metric-label">{t('grades.avg')}</div><div className="metric-value">{summary.avg}</div></div>
    <div className="metric-card"><div className="metric-label">{t('grades.ectsSem')}</div><div className="metric-value">{summary.ectsSem}</div></div>
    <div className="metric-card"><div className="metric-label">{t('grades.ectsTotal')}</div><div className="metric-value">{summary.ectsTotal}</div></div>
  </div></div></div>;
}

export function ScreenChunkFallback({ screen, gradesSummary, t }: { screen: ScreenKey; gradesSummary: { avg: string; ectsSem: string; ectsTotal: string }; t: TranslateFn }) {
  if (screen === 'stats') return <section className="screen stats-screen"><StatsLoadingSkeleton /></section>;
  if (screen === 'grades') return <section className="screen grades-screen"><GradeMetrics summary={gradesSummary} t={t} /><GradesLoadingSkeleton /></section>;
  if (screen === 'finance') return <section className="screen finance-screen"><FinanceLoadingSkeleton /></section>;
  if (screen === 'info') return <section className="screen info-screen info-screen-full"><InfoMainLoadingSkeleton /></section>;
  if (screen === 'links') return <section className="screen links-screen"><SkeletonRegion label="Ładowanie przydatnych stron">{[0, 1, 2, 3, 4].map((index) => <div className="link-card" key={index}><Skeleton className="link-thumb" /><div className="link-card-copy"><Skeleton className="skeleton-line skeleton-line-md" style={{ width: '60%' }} /><Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '35%', marginTop: 6 }} /><Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '85%', marginTop: 6 }} /></div></div>)}</SkeletonRegion></section>;
  return <section className="screen screen-chunk-fallback"><Spinner text="" /></section>;
}
