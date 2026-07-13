import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type MutableRefObject, type SetStateAction, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';

import { useOverscrollLock } from '../../hooks/useOverscrollLock';
import type { BackInterceptResult } from '../../hooks/useAppNavigation';

import type { NewsItem, StatsCountShare, StatsSeriesDay, StatsSnapshot, UsefulLink } from '../../types';
import type { AppSettings } from '../../services/storage';
import type { TranslateFn } from '../viewTypes';
import { LOGO_SRC } from '../constants';
import { Ic, Skeleton, Toggle } from '../ui';

const NEWS_HTML_ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'h2', 'h3', 'h4']);
const NEWS_HTML_TEXTLESS_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math']);

interface NewsDetailImage {
  src: string;
  alt: string;
}

function isSafeNewsUrl(value: string, image = false): string {
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === 'http:' || url.protocol === 'https:' || (!image && url.protocol === 'mailto:')) {
      return url.href;
    }
  } catch {
    return '';
  }
  return '';
}

function sanitizeNewsHtml(html: string): string {
  if (!html.trim()) return '';

  const template = document.createElement('template');
  template.innerHTML = html;

  const sanitizeNode = (node: Node) => {
    if (!(node instanceof Element)) return;

    for (const child of Array.from(node.childNodes)) {
      sanitizeNode(child);
    }

    const tag = node.tagName.toLowerCase();
    if (NEWS_HTML_TEXTLESS_TAGS.has(tag)) {
      node.remove();
      return;
    }

    if (!NEWS_HTML_ALLOWED_TAGS.has(tag)) {
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }

    const previous = new Map(Array.from(node.attributes).map((attr) => [attr.name.toLowerCase(), attr.value]));
    for (const attr of Array.from(node.attributes)) {
      node.removeAttribute(attr.name);
    }

    if (tag === 'a') {
      const href = isSafeNewsUrl(previous.get('href') || '');
      if (href) {
        node.setAttribute('href', href);
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noreferrer');
      }
      const title = previous.get('title');
      if (title) node.setAttribute('title', title);
    }

    if (tag === 'img') {
      const src = isSafeNewsUrl(previous.get('src') || '', true);
      if (!src) {
        node.remove();
        return;
      }
      node.setAttribute('src', src);
      node.setAttribute('alt', previous.get('alt') || '');
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
    }
  };

  for (const child of Array.from(template.content.childNodes)) {
    sanitizeNode(child);
  }

  return template.innerHTML;
}

function normalizeNewsImageSrc(value: string): string {
  return isSafeNewsUrl(value, true);
}

function sameNewsImage(left: string, right: string): boolean {
  try {
    return new URL(left, window.location.origin).href === new URL(right, window.location.origin).href;
  } catch {
    return left === right;
  }
}

function statsLocale(language: string): string {
  return language === 'en' ? 'en-US' : 'pl-PL';
}

function fmtStatsInt(value: number, language: string): string {
  const number = Number(value);
  return new Intl.NumberFormat(statsLocale(language)).format(Number.isFinite(number) ? Math.round(number) : 0);
}

function fmtStatsAvg(value: number, language: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return language === 'en' ? '0.0' : '0,0';
  return number.toFixed(1).replace('.', language === 'en' ? '.' : ',');
}

function fmtStatsPercent(value: number, language: string): string {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '0%';
  const digits = number < 10 ? 1 : 0;
  return `${number.toFixed(digits).replace('.', language === 'en' ? '.' : ',')}%`;
}

function fmtStatsDelta(value: number, language: string): string {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return '0';
  return `${number > 0 ? '+' : ''}${fmtStatsInt(number, language)}`;
}

function statsNiceMax(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(numeric));
  const normalized = numeric / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return magnitude * 2;
  if (normalized <= 5) return magnitude * 5;
  return magnitude * 10;
}

function buildStatsLinePath(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function buildStatsAreaPath(points: Array<{ x: number; y: number }>, baselineY: number): string {
  if (!points.length) return '';
  const last = points[points.length - 1];
  const first = points[0];
  return `${buildStatsLinePath(points)} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

function StatsKpiCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="stats-kpi-card">
      <div className="stats-kpi-label">{label}</div>
      <div className="stats-kpi-value">{value}</div>
      <div className="stats-kpi-note">{note}</div>
    </article>
  );
}

function StatsLegend({ items }: { items: Array<{ label: string; className: string }> }) {
  return (
    <div className="stats-legend">
      {items.map((item) => (
        <div key={item.label} className="stats-legend-item">
          <span className={`stats-legend-swatch ${item.className}`} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatsActivityChart({ series, language }: { series: StatsSeriesDay[]; language: string }) {
  const width = 880;
  const height = 320;
  const padding = { top: 16, right: 18, bottom: 40, left: 44 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const chartMax = statsNiceMax(Math.max(1, ...series.flatMap((day) => [day.activeDevices, day.successfulLogins])));
  const step = series.length > 1 ? innerWidth / (series.length - 1) : innerWidth;
  const barSlot = innerWidth / Math.max(1, series.length);
  const barWidth = Math.max(10, Math.min(16, barSlot * 0.62));
  const pointFor = (index: number, value: number) => {
    const ratio = chartMax > 0 ? value / chartMax : 0;
    return {
      x: Math.round((padding.left + (series.length > 1 ? index * step : innerWidth / 2)) * 100) / 100,
      y: Math.round((padding.top + innerHeight - ratio * innerHeight) * 100) / 100,
    };
  };
  const loginPoints = series.map((day, index) => pointFor(index, day.successfulLogins));
  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const value = Math.round(chartMax * (1 - ratio));
    const y = Math.round((padding.top + innerHeight * ratio) * 100) / 100;
    return { value, y };
  });
  const xLabels = series
    .map((day, index) => ({ day, index }))
    .filter(({ index }) => index === 0 || index === series.length - 1 || index % 5 === 0);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="stats-chart-svg" role="img" aria-label="Aktywne urządzenia oraz poprawne logowania z ostatnich 30 dni">
      {gridLines.map((line) => (
        <g key={line.y} className="stats-chart-grid-row">
          <line x1={padding.left} y1={line.y} x2={width - padding.right} y2={line.y} />
          <text x={padding.left - 10} y={line.y + 4} textAnchor="end">{fmtStatsInt(line.value, language)}</text>
        </g>
      ))}
      {series.map((day, index) => {
        const point = pointFor(index, day.activeDevices);
        const barHeight = Math.max(4, padding.top + innerHeight - point.y);
        const barX = point.x - barWidth / 2;
        const barY = padding.top + innerHeight - barHeight;
        return (
          <g key={day.key} className="stats-chart-bar-group">
            <title>{`${day.labelLong}: aktywne ${day.activeDevices}, logowania ${day.successfulLogins}`}</title>
            <rect className={`stats-chart-bar${index === series.length - 1 ? ' is-today' : ''}`} x={barX} y={barY} width={barWidth} height={barHeight} rx="6" />
          </g>
        );
      })}
      <path className="stats-chart-line" d={buildStatsLinePath(loginPoints)} />
      {loginPoints.map((point, index) => (
        <g key={`${series[index]?.key ?? index}-point`} className="stats-chart-point-wrap">
          <title>{`${series[index]?.labelLong ?? ''}: logowania ${series[index]?.successfulLogins ?? 0}`}</title>
          <circle className="stats-chart-point" cx={point.x} cy={point.y} r={index === series.length - 1 ? 4.5 : 3.5} />
        </g>
      ))}
      {xLabels.map(({ day, index }) => {
        const point = pointFor(index, 0);
        return <text key={`${day.key}-label`} className="stats-chart-x-label" x={point.x} y={height - 10} textAnchor="middle">{day.labelShort}</text>;
      })}
    </svg>
  );
}

function StatsNewDevicesChart({ series, language }: { series: StatsSeriesDay[]; language: string }) {
  const width = 540;
  const height = 220;
  const padding = { top: 14, right: 16, bottom: 32, left: 36 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const chartMax = statsNiceMax(Math.max(1, ...series.map((day) => day.newDevices)));
  const step = series.length > 1 ? innerWidth / (series.length - 1) : innerWidth;
  const pointFor = (index: number, value: number) => {
    const ratio = chartMax > 0 ? value / chartMax : 0;
    return {
      x: Math.round((padding.left + (series.length > 1 ? index * step : innerWidth / 2)) * 100) / 100,
      y: Math.round((padding.top + innerHeight - ratio * innerHeight) * 100) / 100,
    };
  };
  const points = series.map((day, index) => pointFor(index, day.newDevices));
  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const value = Math.round(chartMax * (1 - ratio));
    const y = Math.round((padding.top + innerHeight * ratio) * 100) / 100;
    return { value, y };
  });
  const xLabels = series
    .map((day, index) => ({ day, index }))
    .filter(({ index }) => index === 0 || index === series.length - 1 || index % 6 === 0);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="stats-chart-svg compact" role="img" aria-label="Nowe urządzenia z ostatnich 30 dni">
      {gridLines.map((line) => (
        <g key={line.y} className="stats-chart-grid-row subtle">
          <line x1={padding.left} y1={line.y} x2={width - padding.right} y2={line.y} />
          <text x={padding.left - 10} y={line.y + 4} textAnchor="end">{fmtStatsInt(line.value, language)}</text>
        </g>
      ))}
      <path className="stats-chart-area-soft" d={buildStatsAreaPath(points, padding.top + innerHeight)} />
      <path className="stats-chart-line warm" d={buildStatsLinePath(points)} />
      {points.map((point, index) => (
        <g key={`${series[index]?.key ?? index}-new-point`} className="stats-chart-point-wrap">
          <title>{`${series[index]?.labelLong ?? ''}: nowe urządzenia ${series[index]?.newDevices ?? 0}`}</title>
          <circle className="stats-chart-point warm" cx={point.x} cy={point.y} r={index === points.length - 1 ? 4 : 3} />
        </g>
      ))}
      {xLabels.map(({ day, index }) => {
        const point = pointFor(index, 0);
        return <text key={`${day.key}-new-label`} className="stats-chart-x-label" x={point.x} y={height - 8} textAnchor="middle">{day.labelShort}</text>;
      })}
    </svg>
  );
}

function StatsTopDays({ days, language }: { days: Array<StatsSeriesDay & { summaryLabel: string }>; language: string }) {
  return (
    <div className="stats-rank-list">
      {days.map((day, index) => (
        <div key={day.key} className="stats-rank-item">
          <div className="stats-rank-index">{index + 1}</div>
          <div className="stats-rank-copy">
            <div className="stats-rank-title">{day.summaryLabel}</div>
            <div className="stats-rank-meta">Aktywne: <strong>{fmtStatsInt(day.activeDevices, language)}</strong> · Logowania: <strong>{fmtStatsInt(day.successfulLogins, language)}</strong></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatsBarList({ items, countLabel, language }: { items: StatsCountShare[]; countLabel: string; language: string }) {
  const rows = items.length ? items : [{ label: 'Brak danych', count: 0, share: 0 }];
  const maxCount = Math.max(1, ...rows.map((item) => item.count));
  return (
    <div className="stats-bar-list">
      {rows.map((item) => (
        <div key={item.key ?? item.label} className="stats-bar-row">
          <div className="stats-bar-head">
            <span>{item.label}</span>
            <span>{fmtStatsInt(item.count, language)} {countLabel}</span>
          </div>
          <div className="stats-bar-track">
            <div className="stats-bar-fill" style={{ width: `${Math.max(4, (item.count / maxCount) * 100)}%` }} />
          </div>
          <div className="stats-bar-foot">{fmtStatsPercent(item.share, language)}</div>
        </div>
      ))}
    </div>
  );
}

function StatsRecentTable({ rows, language }: { rows: StatsSeriesDay[]; language: string }) {
  return (
    <div className="stats-table-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            <th>Dzień</th>
            <th>Aktywne</th>
            <th>Nowe</th>
            <th>Logowania</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.labelLong}</td>
              <td>{fmtStatsInt(row.activeDevices, language)}</td>
              <td>{fmtStatsInt(row.newDevices, language)}</td>
              <td>{fmtStatsInt(row.successfulLogins, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function prepareNewsDetailContent(html: string, fallbackImageUrl = ''): { html: string; images: NewsDetailImage[] } {
  const safeHtml = sanitizeNewsHtml(html);
  const template = document.createElement('template');
  template.innerHTML = safeHtml;

  const images: NewsDetailImage[] = [];
  for (const img of Array.from(template.content.querySelectorAll('img'))) {
    const src = normalizeNewsImageSrc(img.getAttribute('src') || '');
    if (src) {
      images.push({
        src,
        alt: img.getAttribute('alt') || '',
      });
    }
    img.remove();
  }

  for (const element of Array.from(template.content.querySelectorAll('a'))) {
    if (!element.textContent?.trim() && element.children.length === 0) {
      element.remove();
    }
  }

  for (const element of Array.from(template.content.querySelectorAll('p, figure, blockquote'))) {
    if (!element.textContent?.trim() && element.children.length === 0) {
      element.remove();
    }
  }

  const fallbackSrc = normalizeNewsImageSrc(fallbackImageUrl);
  if (fallbackSrc && !images.some((image) => sameNewsImage(image.src, fallbackSrc))) {
    images.unshift({ src: fallbackSrc, alt: '' });
  }

  return {
    html: template.innerHTML.trim(),
    images,
  };
}

function NewsLoadingSkeleton() {
  return (
    <div className="list-stack news-skeleton-grid">
      {Array.from({ length: 6 }).map((_, idx) => (
        <div key={idx} className="news-card news-card-skeleton" aria-hidden>
          <Skeleton className="news-thumb news-thumb-skeleton" />
          <div className="news-content news-content-skeleton">
            <Skeleton className="skeleton-line skeleton-line-md" style={{ width: idx % 2 === 0 ? '82%' : '74%' }} />
            <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '28%' }} />
            <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '96%' }} />
            <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '72%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface NewsScreenProps {
  newsLoading: boolean;
  news: NewsItem[];
  t: TranslateFn;
  onOpenDetail: (item: NewsItem) => void;
}

export function NewsScreen({ newsLoading, news, t, onOpenDetail }: NewsScreenProps) {
  const showNewsSkeleton = newsLoading && news.length === 0;

  return (
    <section className="screen news-screen">
      {showNewsSkeleton && <NewsLoadingSkeleton />}
      {!newsLoading && news.length === 0 && (
        <div className="empty-state"><div className="empty-state-icon">📰</div><p>{t('news.empty')}</p></div>
      )}
      {!showNewsSkeleton && (
        <div className="list-stack">
          {news.map((item) => (
            <button key={item.id} type="button" className="news-card" onClick={() => onOpenDetail(item)}>
              {item.thumbUrl ? (
                <img src={item.thumbUrl} alt="" className="news-thumb" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).replaceWith(Object.assign(document.createElement('div'), { className: 'news-thumb-placeholder', innerHTML: '<svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H4a2 2 0 00-2 2v16a2 2 0 002 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2"/><path fill="currentColor" d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/></svg>' })); }} />
              ) : (
                <div className="news-thumb-placeholder"><Ic n="news" /></div>
              )}
              <div className="news-content">
                <div className="news-title">{item.title}</div>
                <div className="news-date">{item.date}</div>
                <div className="news-snippet">{item.snippet}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

interface NewsDetailScreenProps {
  item?: NewsItem;
  t: TranslateFn;
  galleryBackRef: MutableRefObject<(() => BackInterceptResult) | null>;
}

interface NewsGalleryModalProps {
  images: NewsDetailImage[];
  index: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

type GallerySwipePhase = 'idle' | 'dragging' | 'settling';

function NewsGalleryModal({ images, index, onClose, onNext, onPrev }: NewsGalleryModalProps) {
  const image = images[index];
  const [zoom, setZoom] = useState(1);
  const [swipeState, setSwipeState] = useState<{ dx: number; progress: number; phase: GallerySwipePhase; direction: -1 | 0 | 1 }>({
    dx: 0,
    progress: 0,
    phase: 'idle',
    direction: 0,
  });
  const touchStartRef = useRef<{ x: number; y: number; ts: number; width: number; locked: boolean } | null>(null);
  const swipeCommitTimerRef = useRef<number | null>(null);
  const hasMany = images.length > 1;

  const resetSwipe = () => {
    setSwipeState({ dx: 0, progress: 0, phase: 'idle', direction: 0 });
  };

  useEffect(() => {
    setZoom(1);
    resetSwipe();
  }, [index]);

  useOverscrollLock(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight' && hasMany) onNext();
      if (event.key === 'ArrowLeft' && hasMany) onPrev();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hasMany, onClose, onNext, onPrev]);

  useEffect(() => () => {
    if (swipeCommitTimerRef.current !== null) {
      window.clearTimeout(swipeCommitTimerRef.current);
    }
  }, []);

  if (!image) return null;

  const toggleZoom = () => {
    setZoom((current) => (current > 1 ? 1 : 2));
  };

  const finishSwipe = (direction: -1 | 1) => {
    if (swipeCommitTimerRef.current !== null) {
      window.clearTimeout(swipeCommitTimerRef.current);
    }

    setSwipeState({ dx: 0, progress: 1, phase: 'settling', direction });
    swipeCommitTimerRef.current = window.setTimeout(() => {
      swipeCommitTimerRef.current = null;
      resetSwipe();
      if (direction > 0) onNext();
      else onPrev();
    }, 260);
  };

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || !hasMany || zoom > 1) return;
    if (swipeCommitTimerRef.current !== null) {
      window.clearTimeout(swipeCommitTimerRef.current);
      swipeCommitTimerRef.current = null;
    }

    const target = event.currentTarget;
    touchStartRef.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
      ts: Date.now(),
      width: Math.max(1, target.clientWidth),
      locked: false,
    };
    setSwipeState({ dx: 0, progress: 0, phase: 'dragging', direction: 0 });
  };

  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    if (!start || !hasMany || zoom > 1 || event.touches.length !== 1) return;

    const rawDx = event.touches[0].clientX - start.x;
    const dy = event.touches[0].clientY - start.y;
    if (!start.locked) {
      if (Math.abs(rawDx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(rawDx) * 1.15) {
        touchStartRef.current = null;
        resetSwipe();
        return;
      }
      start.locked = true;
    }

    event.preventDefault();
    const limit = start.width * 0.92;
    const dx = Math.max(-limit, Math.min(limit, rawDx));
    const progress = Math.min(1, Math.abs(dx) / Math.max(1, start.width * 0.42));
    setSwipeState({ dx, progress, phase: 'dragging', direction: 0 });
  };

  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || !hasMany || zoom > 1 || event.changedTouches.length !== 1) return;

    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    const elapsed = Math.max(1, Date.now() - start.ts);
    const velocity = Math.abs(dx) / elapsed;
    const threshold = Math.min(120, Math.max(56, start.width * 0.18));

    if (!start.locked || Math.abs(dx) < Math.abs(dy) * 1.2 || (Math.abs(dx) < threshold && velocity < 0.45)) {
      resetSwipe();
      return;
    }

    finishSwipe(dx < 0 ? 1 : -1);
  };

  const onTouchCancel = () => {
    touchStartRef.current = null;
    resetSwipe();
  };

  const zoomedStyle = zoom > 1
    ? { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' }
    : undefined;
  const canAnimateSwipe = hasMany && zoom === 1;
  const getRelativeImage = (offset: number) => images[(index + offset + images.length) % images.length];
  const swipeTrackTransform = swipeState.phase === 'settling'
    ? (swipeState.direction > 0 ? 'translate3d(-200%, 0, 0)' : 'translate3d(0, 0, 0)')
    : `translate3d(calc(-100% + ${Math.round(swipeState.dx)}px), 0, 0)`;
  const swipeTrackStyle = {
    '--gallery-active-scale': String(1 - swipeState.progress * 0.035),
    '--gallery-active-opacity': String(1 - swipeState.progress * 0.1),
    '--gallery-side-scale': String(0.96 + swipeState.progress * 0.04),
    '--gallery-side-opacity': String(0.72 + swipeState.progress * 0.28),
    transform: swipeTrackTransform,
  } as CSSProperties;
  const swipeTrackClass = [
    'news-gallery-track',
    swipeState.phase === 'dragging' ? 'is-dragging' : '',
    swipeState.phase === 'settling' ? 'is-settling' : '',
  ].filter(Boolean).join(' ');

  return createPortal(
    <div className="news-gallery-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="news-gallery-surface" onClick={(event) => event.stopPropagation()}>
        <div className="news-gallery-topbar">
          <div className="news-gallery-counter">{index + 1} / {images.length}</div>
          <div className="news-gallery-actions">
            <button type="button" className="news-gallery-icon-btn" onClick={toggleZoom} aria-label={zoom > 1 ? 'Pomniejsz zdjęcie' : 'Przybliż zdjęcie'}>
              <Ic n={zoom > 1 ? 'minus' : 'plus'} />
            </button>
            <button type="button" className="news-gallery-icon-btn" onClick={onClose} aria-label="Zamknij galerię">
              <Ic n="x" />
            </button>
          </div>
        </div>

        <div
          className="news-gallery-frame"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          {hasMany ? (
            <button type="button" className="news-gallery-nav news-gallery-nav-prev" onClick={onPrev} aria-label="Poprzednie zdjęcie">
              <Ic n="chevL" />
            </button>
          ) : null}

          <div className={`news-gallery-viewport${zoom > 1 ? ' is-zoomed' : ''}`}>
            {canAnimateSwipe ? (
              <div className={swipeTrackClass} style={swipeTrackStyle}>
                {[-1, 0, 1].map((offset) => {
                  const slideImage = getRelativeImage(offset);
                  return (
                    <div key={`${slideImage.src}-${offset}`} className={`news-gallery-slide${offset === 0 ? ' is-active' : ''}`}>
                      <img
                        src={slideImage.src}
                        alt={slideImage.alt}
                        className="news-gallery-image"
                        draggable={false}
                        onDoubleClick={toggleZoom}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <img
                src={image.src}
                alt={image.alt}
                className={`news-gallery-image${zoom > 1 ? ' is-zoomed' : ''}`}
                style={zoomedStyle}
                draggable={false}
                onDoubleClick={toggleZoom}
              />
            )}
          </div>

          {hasMany ? (
            <button type="button" className="news-gallery-nav news-gallery-nav-next" onClick={onNext} aria-label="Następne zdjęcie">
              <Ic n="chevR" />
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function NewsDetailScreen({ item, t, galleryBackRef }: NewsDetailScreenProps) {
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const galleryHistoryRef = useRef(false);

  const preparedContent = useMemo(
    () => (item ? prepareNewsDetailContent(item.contentHtml || item.descriptionHtml, item.thumbUrl) : { html: '', images: [] }),
    [item],
  );
  const galleryOpen = galleryIndex !== null && preparedContent.images.length > 0;
  const safeGalleryIndex = galleryOpen
    ? Math.min(Math.max(galleryIndex ?? 0, 0), preparedContent.images.length - 1)
    : 0;

  useEffect(() => {
    if (!galleryOpen) return;

    window.history.pushState({ zutnik: true, overlay: 'news-gallery' }, '', window.location.href);
    galleryHistoryRef.current = true;

    const handler = (): BackInterceptResult => {
      galleryHistoryRef.current = false;
      setGalleryIndex(null);
      return 'consume';
    };

    galleryBackRef.current = handler;
    return () => {
      if (galleryBackRef.current === handler) {
        galleryBackRef.current = null;
      }
    };
  }, [galleryBackRef, galleryOpen]);

  const closeGallery = () => {
    if (galleryHistoryRef.current) {
      window.history.back();
      return;
    }
    setGalleryIndex(null);
  };

  const goToGalleryImage = (direction: -1 | 1) => {
    setGalleryIndex((current) => {
      const count = preparedContent.images.length;
      if (!count) return null;
      const start = current === null ? 0 : current;
      return (start + direction + count) % count;
    });
  };

  if (!item) {
    return <section className="screen news-detail-screen"><div className="empty-state"><p>{t('newsDetail.noContent')}</p></div></section>;
  }

  return (
    <section className="screen news-detail-screen">
      <div className="card news-detail-card">
        <div className="news-detail-title">{item.title}</div>
        <div className="news-detail-date">{item.date}</div>
        {preparedContent.html ? (
          <div className="news-detail-body" dangerouslySetInnerHTML={{ __html: preparedContent.html }} />
        ) : (
          <div className="news-detail-body">{item.descriptionText || item.snippet}</div>
        )}
        {preparedContent.images.length > 0 && (
          <div className={`news-detail-media-grid${preparedContent.images.length === 1 ? ' is-single' : ''}`}>
            {preparedContent.images.map((image, index) => (
              <button
                key={`${image.src}-${index}`}
                type="button"
                className="news-detail-media-item"
                onClick={() => setGalleryIndex(index)}
                aria-label={`Otwórz zdjęcie ${index + 1} z ${preparedContent.images.length}`}
              >
                <img src={image.src} alt={image.alt} loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        )}
      </div>
      {item.link && (
        <a href={item.link} target="_blank" rel="noreferrer" className="news-source-btn">
          {t('newsDetail.openBrowser')} ↗
        </a>
      )}
      {galleryOpen && (
        <NewsGalleryModal
          key={preparedContent.images[safeGalleryIndex]?.src ?? safeGalleryIndex}
          images={preparedContent.images}
          index={safeGalleryIndex}
          onClose={closeGallery}
          onNext={() => goToGalleryImage(1)}
          onPrev={() => goToGalleryImage(-1)}
        />
      )}
    </section>
  );
}

interface LinksScreenProps {
  links: UsefulLink[];
  t: TranslateFn;
}

export function LinksScreen({ links, t }: LinksScreenProps) {
  const globals = links.filter((l) => l.scope === 'GLOBAL');
  const faculties = links.filter((l) => l.scope === 'FACULTY');

  return (
    <section className="screen links-screen">
      {faculties.length > 0 && <div className="link-category">{t('links.faculty')}</div>}
      {faculties.map((l) => (
        <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="link-card">
          <div className="link-card-title">{l.title}</div>
          <div className="link-card-desc">{l.description}</div>
        </a>
      ))}
      <div className="link-category">{t('links.university')}</div>
      {globals.map((l) => (
        <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="link-card">
          <div className="link-card-title">{l.title}</div>
          <div className="link-card-desc">{l.description}</div>
        </a>
      ))}
    </section>
  );
}

interface StatsScreenProps {
  snapshot: StatsSnapshot | null;
  statsLoading: boolean;
  statsError: string;
  language: AppSettings['language'];
  t: TranslateFn;
  onRefresh: () => Promise<void> | void;
}

function StatsLoadingSkeleton() {
  return (
    <section className="screen stats-screen">
      <div className="stats-hero stats-hero-loading">
        <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '140px' }} />
        <Skeleton className="skeleton-line skeleton-line-md" style={{ width: '260px' }} />
        <div className="stats-kpi-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="stats-kpi-card" aria-hidden>
              <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '62%' }} />
              <Skeleton className="skeleton-line skeleton-line-md" style={{ width: '44%' }} />
              <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '72%' }} />
            </div>
          ))}
        </div>
      </div>
      <div className="stats-grid-main">
        <div className="stats-panel stats-panel-large" aria-hidden>
          <Skeleton className="skeleton-line skeleton-line-md" style={{ width: '220px' }} />
          <Skeleton className="stats-chart-skeleton" />
        </div>
        <div className="stats-side-stack" aria-hidden>
          <Skeleton className="stats-side-skeleton" />
          <Skeleton className="stats-side-skeleton" />
        </div>
      </div>
    </section>
  );
}

export function StatsScreen({ snapshot, statsLoading, statsError, language, t, onRefresh }: StatsScreenProps) {
  if (statsLoading && !snapshot) {
    return <StatsLoadingSkeleton />;
  }

  if (!snapshot) {
    return (
      <section className="screen stats-screen">
        <div className="stats-state-panel">
          <div className="stats-state-icon"><Ic n="stats" /></div>
          <div>
            <h2>{t('stats.unavailableTitle')}</h2>
            <p>{statsError || t('stats.unavailableCopy')}</p>
          </div>
          <button type="button" className="stats-refresh-btn" onClick={() => void onRefresh()}>
            <Ic n="refresh" />
            {t('stats.refresh')}
          </button>
        </div>
      </section>
    );
  }

  const { kpis, meta, peaks, series, topDays, activeMix, loginMethods, loginMethodCoverage, recentRows } = snapshot;
  const activityCoverage = kpis.totalDevices > 0 ? (kpis.uniqueActive30d / kpis.totalDevices) * 100 : 0;
  const methodsWithFallback = loginMethods.some((item) => item.count > 0)
    ? loginMethods
    : [{ key: 'none', label: t('stats.noData'), count: 0, share: 0 }];

  return (
    <section className="screen stats-screen">
      <div className="stats-hero">
        <div className="stats-hero-top">
          <div>
            <div className="stats-eyebrow">{t('stats.eyebrow')}</div>
            <h2>{t('stats.title')}</h2>
            <p>{t('stats.copy')}</p>
          </div>
          <button type="button" className={`stats-refresh-btn${statsLoading ? ' is-loading' : ''}`} onClick={() => void onRefresh()} disabled={statsLoading}>
            <Ic n="refresh" />
            {t('stats.refresh')}
          </button>
        </div>

        <div className="stats-meta-line">
          <span>{t('stats.updated')}: <strong>{meta.updatedAtLabel}</strong></span>
          <span>{t('stats.trackedSince')}: <strong>{meta.trackedSinceLabel}</strong></span>
          <span>{t('stats.totalDevices')}: <strong>{fmtStatsInt(kpis.totalDevices, language)}</strong></span>
          <span>{t('stats.apiHits')}: <strong>{fmtStatsInt(kpis.totalApiHits, language)}</strong></span>
        </div>

        <div className="stats-kpi-grid">
          <StatsKpiCard label={t('stats.activeToday')} value={fmtStatsInt(kpis.todayActiveDevices, language)} note={`${fmtStatsDelta(kpis.todayDeltaActive, language)} ${t('stats.vsYesterday')}`} />
          <StatsKpiCard label={t('stats.loginsToday')} value={fmtStatsInt(kpis.successfulLoginsToday, language)} note={`${fmtStatsDelta(kpis.todayDeltaLogins, language)} ${t('stats.vsYesterday')}`} />
          <StatsKpiCard label={t('stats.unique30d')} value={fmtStatsInt(kpis.uniqueActive30d, language)} note={`${fmtStatsPercent(activityCoverage, language)} ${t('stats.ofBase')}`} />
          <StatsKpiCard label={t('stats.returning30d')} value={fmtStatsInt(kpis.returningDevices30d, language)} note={`${fmtStatsPercent(kpis.returningShare30d, language)} ${t('stats.ofActive')}`} />
        </div>
      </div>

      <div className="stats-grid-main">
        <article className="stats-panel stats-panel-large">
          <div className="stats-panel-head">
            <div>
              <div className="stats-panel-kicker">{t('stats.last30d')}</div>
              <h3>{t('stats.activityTitle')}</h3>
            </div>
            <div className="stats-chip">
              <span>{t('stats.avgActive7d')}</span>
              <strong>{fmtStatsAvg(kpis.averageActive7d, language)}</strong>
            </div>
          </div>
          <div className="stats-chart-shell">
            <StatsLegend items={[
              { label: t('stats.activeDevices'), className: 'bar-active' },
              { label: t('stats.successfulLogins'), className: 'line-logins' },
            ]} />
            <StatsActivityChart series={series} language={language} />
          </div>
          <div className="stats-inline-note">
            {t('stats.peakActive')}: <strong>{peaks.active ? `${fmtStatsInt(peaks.active.value, language)} · ${peaks.active.label}` : t('stats.noData')}</strong>
          </div>
        </article>

        <aside className="stats-side-stack">
          <article className="stats-panel">
            <div className="stats-panel-head compact">
              <div>
                <div className="stats-panel-kicker">{t('stats.ranking')}</div>
                <h3>{t('stats.topDays')}</h3>
              </div>
            </div>
            <StatsTopDays days={topDays} language={language} />
          </article>

          <article className="stats-panel">
            <div className="stats-panel-head compact">
              <div>
                <div className="stats-panel-kicker">{t('stats.auth')}</div>
                <h3>{t('stats.loginSources')}</h3>
              </div>
            </div>
            <StatsBarList items={methodsWithFallback} countLabel={t('stats.loginsCount')} language={language} />
            {loginMethodCoverage.isPartial && (
              <div className="stats-inline-note">{t('stats.partialMethods')}</div>
            )}
          </article>
        </aside>
      </div>

      <div className="stats-detail-grid">
        <article className="stats-panel">
          <div className="stats-panel-head">
            <div>
              <div className="stats-panel-kicker">{t('stats.acquisition')}</div>
              <h3>{t('stats.newDevices')}</h3>
            </div>
            <div className="stats-chip">
              <span>{t('stats.today')}</span>
              <strong>{fmtStatsInt(kpis.newDevicesToday, language)}</strong>
            </div>
          </div>
          <div className="stats-chart-shell">
            <StatsLegend items={[{ label: t('stats.newDevices'), className: 'line-new' }]} />
            <StatsNewDevicesChart series={series} language={language} />
          </div>
        </article>

        <article className="stats-panel">
          <div className="stats-panel-head compact">
            <div>
              <div className="stats-panel-kicker">{t('stats.retention')}</div>
              <h3>{t('stats.returning')}</h3>
            </div>
          </div>
          <StatsBarList items={activeMix} countLabel={t('stats.devicesCount')} language={language} />
        </article>
      </div>

      <article className="stats-panel">
        <div className="stats-panel-head">
          <div>
            <div className="stats-panel-kicker">{t('stats.recent')}</div>
            <h3>{t('stats.last7d')}</h3>
          </div>
          <div className="stats-chip">
            <span>{t('stats.avgLogins7d')}</span>
            <strong>{fmtStatsAvg(kpis.averageLogins7d, language)}</strong>
          </div>
        </div>
        <StatsRecentTable rows={recentRows} language={language} />
      </article>
    </section>
  );
}

interface SettingsScreenProps {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  t: TranslateFn;
}

export function SettingsScreen({ settings, setSettings, t }: SettingsScreenProps) {
  const themeOptions = [
    { value: 'system' as const, label: t('settings.themeSystem') },
    { value: 'light' as const, label: t('settings.themeLight') },
    { value: 'dark' as const, label: t('settings.themeDark') },
  ];
  const themeLabel = themeOptions.find((option) => option.value === settings.theme)?.label ?? t('settings.themeSystem');
  const summaryItems = [
    {
      icon: 'user',
      label: t('settings.language'),
      value: settings.language === 'pl' ? 'Polski' : 'English',
    },
    {
      icon: 'eye',
      label: t('settings.theme'),
      value: themeLabel,
    },
    {
      icon: 'clock',
      label: t('settings.refresh'),
      value: `${settings.refreshMinutes} min`,
    },
    {
      icon: 'calendar',
      label: t('settings.compactPlan'),
      value: settings.compactPlan ? t('settings.stateOn') : t('settings.stateOff'),
    },
    {
      icon: 'grade',
      label: t('settings.gradeGroup'),
      value: settings.gradesGrouping ? t('settings.stateOn') : t('settings.stateOff'),
    },
  ] as const;

  return (
    <section className="screen settings-screen">
      <aside className="settings-side-card">
        <div className="settings-side-icon"><Ic n="settings" /></div>
        <div className="settings-side-eyebrow">{t('settings.desktopEyebrow')}</div>
        <div className="settings-side-title">{t('settings.desktopTitle')}</div>
        <div className="settings-side-copy">{t('settings.desktopCopy')}</div>

        <div className="settings-side-grid">
          {summaryItems.map((item) => (
            <div key={item.label} className="settings-side-item">
              <div className="settings-side-item-icon"><Ic n={item.icon} /></div>
              <div className="settings-side-item-copy">
                <div className="settings-side-item-label">{item.label}</div>
                <div className="settings-side-item-value">{item.value}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="settings-main">
        <div className="settings-card settings-section-card">
          <div className="settings-card-head">
            <div className="settings-card-kicker">{t('settings.sectionInterface')}</div>
            <div className="settings-card-title">{t('settings.sectionInterface')}</div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">{t('settings.language')}</div>
              <div className="settings-row-sub">{t('settings.languageSub')}</div>
            </div>
            <select value={settings.language} onChange={(e) => setSettings((p) => ({ ...p, language: e.target.value as 'pl' | 'en' }))}>
              <option value="pl">Polski</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="settings-row settings-row-theme">
            <div className="settings-row-info">
              <div className="settings-row-label">{t('settings.theme')}</div>
              <div className="settings-row-sub">{t('settings.themeSub')}</div>
            </div>
            <div className="settings-theme-segmented" role="radiogroup" aria-label={t('settings.theme')}>
              {themeOptions.map((option) => {
                const active = settings.theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`settings-theme-segment${active ? ' is-active' : ''}`}
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSettings((p) => ({ ...p, theme: option.value }))}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">{t('settings.refresh')}</div>
              <div className="settings-row-sub">{t('settings.refreshSub')}</div>
            </div>
            <select value={settings.refreshMinutes} onChange={(e) => setSettings((p) => ({ ...p, refreshMinutes: Number(e.target.value) as 30 | 60 | 120 }))}>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
              <option value={120}>120 min</option>
            </select>
          </div>
        </div>

        <div className="settings-card settings-section-card">
          <div className="settings-card-head">
            <div className="settings-card-kicker">{t('settings.sectionViews')}</div>
            <div className="settings-card-title">{t('settings.sectionViews')}</div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">{t('settings.compactPlan')}</div>
              <div className="settings-row-sub">{t('settings.compactPlanSub')}</div>
            </div>
            <Toggle checked={settings.compactPlan} onChange={(v) => setSettings((p) => ({ ...p, compactPlan: v }))} />
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">{t('settings.gradeGroup')}</div>
              <div className="settings-row-sub">{t('settings.gradeGroupSub')}</div>
            </div>
            <Toggle checked={settings.gradesGrouping} onChange={(v) => setSettings((p) => ({ ...p, gradesGrouping: v }))} />
          </div>
        </div>
      </div>
    </section>
  );
}

interface AboutScreenProps {
  canOfferInstall: boolean;
  handleInstallPwa: () => Promise<void> | void;
  isIosSafari: boolean;
  t: TranslateFn;
}

export function AboutScreen({ canOfferInstall, handleInstallPwa, isIosSafari, t }: AboutScreenProps) {
  return (
    <section className="screen about-screen">
      <div className="about-overview">
        <div className="about-hero card">
          <div className="about-hero-head">
            <img src={LOGO_SRC} alt="Logo ZUTnik" className="about-logo-img" />
            <div className="about-hero-copy">
              <div className="about-app-name">ZUTnik</div>
              <div className="about-version">2.0 (PWA)</div>
              <div className="about-note">{t('about.pwaNote')}</div>
            </div>
          </div>

          {canOfferInstall && (
            <button type="button" className="about-action-card about-install-card" onClick={() => void handleInstallPwa()}>
              <div className="about-action-icon">📲</div>
              <div className="about-action-content">
                <div className="about-action-title">{t('about.installApp')}</div>
                <div className="about-action-desc">
                  {isIosSafari ? t('about.installIos') : t('about.installAndroid')}
                </div>
              </div>
              <div className="about-action-arrow">→</div>
            </button>
          )}
        </div>

        <div className="about-description card">
          <p>{t('about.description')}</p>
          <p className="about-signoff">Made with ❤️ by Kejlo</p>
        </div>
      </div>

      <div className="about-panels">
        <div className="about-actions">
          <a href="https://github.com/Kejlo523" target="_blank" rel="noreferrer" className="about-action-card">
            <div className="about-action-icon">📝</div>
            <div className="about-action-content">
              <div className="about-action-title">{t('about.sourceCode')}</div>
              <div className="about-action-desc">{t('about.sourceDesc')}</div>
            </div>
            <div className="about-action-arrow">→</div>
          </a>
        </div>

        <div className="about-links">
          <a href="https://zutnik.endozero.pl" target="_blank" rel="noreferrer" className="about-link-item">
            <span className="about-link-icon">ℹ️</span>
            <span className="about-link-text">{t('about.projectSite')}</span>
            <span className="about-link-arrow">→</span>
          </a>

          <a href="https://endozero.pl" target="_blank" rel="noreferrer" className="about-link-item">
            <span className="about-link-icon">👤</span>
            <span className="about-link-text">{t('about.authorSite')}</span>
            <span className="about-link-arrow">→</span>
          </a>

          <a href="https://endozero.pl" target="_blank" rel="noreferrer" className="about-link-item">
            <span className="about-link-icon">🔒</span>
            <span className="about-link-text">{t('about.privacyPolicy')}</span>
            <span className="about-link-arrow">→</span>
          </a>

          <a href="mailto:kejlo@endozero.pl" className="about-link-item">
            <span className="about-link-icon">📧</span>
            <span className="about-link-text">E-mail: kejlo@endozero.pl</span>
            <span className="about-link-arrow">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}
