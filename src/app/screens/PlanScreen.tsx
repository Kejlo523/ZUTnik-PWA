import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import type { PlanEventUi, PlanResult, ViewMode } from '../../types';
import type { SelectedPlanEvent, TranslateFn } from '../viewTypes';
import { fmtDayMonth, fmtHour, fmtWeekdayShort, isWeekendDate, planTypeShort, todayYmd } from '../helpers';
import { Ic, Skeleton } from '../ui';
import { useVisibleClock } from '../../hooks/useVisibleClock';
import type { PlanWindowData } from '../../services/api';
import { timetablePages, type TimetablePage } from '../../services/timetablePages';
import { periodBoundaries, periodMarkerLabel } from '../calendarPeriods';

interface Props {
  result: PlanResult | null; viewMode: ViewMode; date: string; loading: boolean;
  window: PlanWindowData | null; hiddenSubjectKeys: string[];
  compact: boolean; language: 'pl' | 'en'; t: TranslateFn;
  onMode: (mode: ViewMode) => void; onNavigate: (date: string) => void;
  onSelect: (event: SelectedPlanEvent) => void; onExport: () => void;
}

const PlanEvent = memo(function PlanEvent({ event, date, start, hourHeight, week, boundaryLeft, boundaryRight, onSelect }: {
  event: PlanEventUi; date: string; start: number; hourHeight: number; week: boolean; onSelect: Props['onSelect'];
  boundaryLeft: boolean; boundaryRight: boolean;
}) {
  const insetLeft = boundaryLeft && event.leftPct === 0 ? 12 : 2;
  const insetRight = boundaryRight && event.leftPct + event.widthPct >= 99.9 ? 12 : 2;
  const style: CSSProperties = {
    top: (event.startMin - start) * hourHeight / 60,
    height: Math.max(22, (event.endMin - event.startMin) * hourHeight / 60),
    left: `calc(${event.leftPct}% + ${insetLeft}px)`, width: `calc(${event.widthPct}% - ${insetLeft + insetRight}px)`,
  };
  return <button type="button" className={`timetable-event ev-${event.typeClass}${week ? ' is-week' : ''}`} style={style} onClick={() => onSelect({ date, event })} aria-label={`${event.title}, ${event.startStr}-${event.endStr}, ${event.room}, ${event.typeLabel}`}>
    <span className="timetable-event-time"><span>{event.startStr}</span><span className="timetable-event-time-separator" aria-hidden="true">-</span><span className="timetable-event-end">{event.endStr}</span></span>
    {(event.room || event.group) && <span className="timetable-event-context">{[event.room !== '-' ? event.room : '', event.group].filter(Boolean).join(' · ')}</span>}
    <span className="timetable-event-title-space"><span className="timetable-event-title">{event.title}</span></span>
    <span className="timetable-event-type">({event.typeCode || planTypeShort(event.typeClass, event.typeLabel)})</span>
  </button>;
});

const TimetableContent = memo(function TimetableContent({ page, active, loading, compact, language, t, onMode, onNavigate, onSelect, onExport, onScroll, scrollRef }: {
  page: TimetablePage; active: boolean; onScroll: (value: number) => void; scrollRef: (element: HTMLDivElement | null) => void;
} & Pick<Props, 'loading' | 'compact' | 'language' | 't' | 'onMode' | 'onNavigate' | 'onSelect' | 'onExport'>) {
  const result = page.result;
  const viewMode = result.viewMode;
  const today = todayYmd();
  const hourHeight = compact ? 40 : 46;
  const start = 360;
  const slots = useMemo(() => Array.from({ length: 17 }, (_, index) => start + index * 60), []);
  const columns = useMemo(() => {
    const cols = result.dayColumns;
    if (viewMode !== 'week') return cols;
    const weekends = cols.filter((col) => isWeekendDate(col.date));
    return weekends.every((col) => col.events.length === 0) ? cols.filter((col) => !isWeekendDate(col.date)) : cols;
  }, [result, viewMode]);
  const types = useMemo(() => [...new Map(columns.flatMap((col) => col.events).map((ev) => [ev.typeClass, ev.typeLabel])).entries()], [columns]);
  const boundaries = useMemo(() => columns.map((col, index) => index > 0 ? periodBoundaries(result.sessionPeriods, columns[index - 1].date, col.date) : []), [columns, result.sessionPeriods]);
  const now = useVisibleClock();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const loadingEmpty = active && loading && !page.cached && !result.hasAnyEventsInRange;
  const columnCount = loadingEmpty ? (viewMode === 'day' ? 1 : 5) : Math.max(1, columns.length);
  const gridStyle = { '--day-count': columnCount, '--hour-height': `${hourHeight}px` } as CSSProperties;
  const trackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const spaces = Array.from(trackRef.current?.querySelectorAll<HTMLElement>('.timetable-event-title-space') ?? []);
    if (!spaces.length) return;
    let active = true;
    const fit = (nodes: HTMLElement[]) => {
      // Read the whole batch before writing; paging transforms never trigger this observer.
      const sizes = nodes.map((node) => ({ node, lines: Math.max(0, Math.floor((node.getBoundingClientRect().height + .01) / parseFloat(getComputedStyle(node.firstElementChild!).lineHeight))) }));
      for (const { node, lines } of sizes) {
        if (node.style.getPropertyValue('--title-lines') !== String(Math.max(1, lines))) node.style.setProperty('--title-lines', String(Math.max(1, lines)));
        node.style.visibility = lines ? '' : 'hidden';
      }
    };
    const observer = new ResizeObserver((entries) => fit(entries.map((entry) => entry.target as HTMLElement)));
    spaces.forEach((node) => observer.observe(node));
    fit(spaces);
    void document.fonts.ready.then(() => { if (active) fit(spaces); });
    return () => { active = false; observer.disconnect(); };
  }, [columns]);

  return <div className="timetable-page" style={gridStyle} data-active={active} data-page-key={page.key} aria-label={result.headerLabel} aria-hidden={!active} inert={!active}>
      {viewMode !== 'month' && <div className="timetable-head"><div aria-hidden="true" />
        {loadingEmpty ? Array.from({ length: columnCount }, (_, i) => <div key={i}><Skeleton className="skeleton-line" style={{ width: 26 }} /></div>) : columns.map((col) => <button type="button" key={col.date} className={col.date === today ? 'today' : ''} onClick={() => { onNavigate(col.date); onMode('day'); }}><strong>{fmtWeekdayShort(col.date, language)}</strong><span>{fmtDayMonth(col.date, language)}</span></button>)}
      </div>}
      <div className="timetable-scroll" ref={scrollRef} onScroll={(e) => { if (active) onScroll(e.currentTarget.scrollTop); }}>
        <div className="timetable-track" ref={trackRef}>
          {viewMode === 'month' ? <>
            <div className="month-weekdays">{Array.from({ length: 7 }, (_, i) => <span key={i}>{fmtWeekdayShort(`2026-06-${String(i + 1).padStart(2, '0')}`, language)}</span>)}</div>
            <div className="month-grid">{result.monthGrid.flat().map((cell) => <button type="button" key={cell.date} className={`month-cell${cell.inCurrentMonth ? '' : ' out'}${cell.date === today ? ' today' : ''}`} onClick={() => { if (loadingEmpty) return; onNavigate(cell.date); onMode('day'); }} aria-label={cell.date}>{loadingEmpty ? <Skeleton className="skeleton-circle" /> : <><span>{Number(cell.date.slice(-2))}</span>{cell.hasPlan && <i className="month-dot" />}</>}</button>)}</div>
          </> : <div className="timetable-grid" style={{ height: slots.length * hourHeight }}>
            <div className="timetable-times">{slots.map((minute) => <span key={minute} style={{ height: hourHeight }}>{fmtHour(minute)}</span>)}</div>
            {(loadingEmpty ? Array.from({ length: columnCount }, (_, i) => ({ date: `${i}`, events: [] })) : columns).map((col, index) => {
              const markers = loadingEmpty ? [] : boundaries[index];
              return <div key={col.date} className={`timetable-day${markers.length ? ' has-boundary' : ''}`}>
                {markers.length > 0 && <div className={`timetable-period-boundary boundary-${markers[0].kind}`}>
                  {markers.map((marker, markerIndex) => <span key={`${marker.period.key}:${marker.period.start}:${marker.edge}`} className={`timetable-boundary-label boundary-${marker.kind}`} style={{ top: `${(markerIndex + .5) / markers.length * 100}%` }}>{periodMarkerLabel(marker, t)}</span>)}
                </div>}
                {col.date === today && nowMinute >= start && nowMinute < 1380 && <span className="now-line" style={{ top: (nowMinute - start) * hourHeight / 60 }} />}
                {loadingEmpty ? (index % 2 === 0 && <div className="timetable-event timetable-skeleton" style={{ top: hourHeight * (index + 2), height: hourHeight * 1.7, left: 2, right: 2 }}><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" style={{ width: '60%' }} /></div>) : col.events.map((event) => <PlanEvent key={`${col.date}:${event.startMin}:${event.endMin}:${event.subjectKey}:${event.room}:${event.group}:${event.typeClass}`} event={event} date={col.date} start={start} hourHeight={hourHeight} week={viewMode === 'week'} boundaryLeft={markers.length > 0} boundaryRight={Boolean(boundaries[index + 1]?.length)} onSelect={onSelect} />)}
              </div>;
            })}
          </div>}
        </div>
        {!loadingEmpty && !result.hasAnyEventsInRange && <div className="timetable-empty"><Ic n="calendar" /><span>{page.cached ? t(viewMode === 'day' ? 'plan.emptyDay' : 'plan.emptyWeek') : language === 'en' ? 'No saved timetable for this range.' : 'Brak zapisanego planu w tym zakresie.'}</span></div>}
        <footer className="timetable-footer">
          {types.length > 0 && <details><summary>{t('plan.legend')}<Ic n="chevR" /></summary><div className="timetable-legend">{types.map(([type, label]) => <span key={type}><i className={`ev-${type}`} />{label}</span>)}</div></details>}
          <button type="button" className="text-btn" onClick={onExport} disabled={loadingEmpty}><Ic n="download" />{language === 'en' ? 'Export semester' : 'Eksport semestru'}</button>
          <small>{language === 'en' ? 'Saved timetable · USOS' : 'Plan zapisany na urządzeniu · USOS'}</small>
        </footer>
      </div>
  </div>;
});

export const PlanScreen = memo(function PlanScreen({ result, window: savedWindow, hiddenSubjectKeys, viewMode, date, loading, compact, language, t, onMode, onNavigate, onSelect, onExport }: Props) {
  const pages = useMemo(() => timetablePages(viewMode, date, result, savedWindow, hiddenSubjectKeys), [viewMode, date, result, savedWindow, hiddenSubjectKeys]);
  const centerKey = pages[1].key;
  const [selection, setSelection] = useState(() => ({ center: centerKey, key: centerKey }));
  const activeKey = selection.center === centerKey ? selection.key : centerKey;
  const latest = useRef({ pages, onNavigate });
  const selectedPageKey = useRef(centerKey);
  const scrollPositions = useRef<Partial<Record<ViewMode, number>>>({});
  const scrollers = useRef(new Map<string, HTMLDivElement>());
  const [viewportRef, pager] = useEmblaCarousel({
    startIndex: 1, align: 'start', containScroll: false, skipSnaps: false, duration: 18,
    watchSlides: false, watchFocus: false,
    watchDrag: (_api, event) => !(event.target instanceof Element && event.target.closest('.timetable-footer')),
    breakpoints: { '(prefers-reduced-motion: reduce)': { duration: 0 } },
  });

  useLayoutEffect(() => { latest.current = { pages, onNavigate }; }, [pages, onNavigate]);
  useLayoutEffect(() => {
    // Recycle only after settling. The visible keyed page and its DOM survive.
    const visible = scrollers.current.get(centerKey);
    const top = visible && selectedPageKey.current === centerKey ? visible.scrollTop : scrollPositions.current[viewMode] ?? 0;
    scrollPositions.current[viewMode] = top;
    pager?.reInit({ startIndex: 1 });
    for (const element of scrollers.current.values()) {
      if (Math.abs(element.scrollTop - top) > 1) element.scrollTop = top;
    }
  }, [pager, centerKey, viewMode]);
  useEffect(() => {
    if (!pager) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let tolerance = .75 / (pager.rootNode().clientWidth * (pager.scrollSnapList().length - 1));
    const selected = () => {
      const currentPages = latest.current.pages;
      const selectedPage = currentPages[pager.selectedScrollSnap()];
      if (selectedPageKey.current !== selectedPage.key) {
        const incoming = scrollers.current.get(selectedPage.key);
        const top = scrollPositions.current[selectedPage.result.viewMode] ?? 0;
        if (incoming && Math.abs(incoming.scrollTop - top) > 1) incoming.scrollTop = top;
        selectedPageKey.current = selectedPage.key;
      }
      setSelection((previous) => previous.center === currentPages[1].key && previous.key === selectedPage.key ? previous : { center: currentPages[1].key, key: selectedPage.key });
    };
    const reinitialized = () => {
      tolerance = .75 / (pager.rootNode().clientWidth * (pager.scrollSnapList().length - 1));
      selected();
    };
    const settled = () => {
      const index = pager.selectedScrollSnap();
      pager.rootNode().dataset.dragging = 'false';
      if (index !== 1) latest.current.onNavigate(latest.current.pages[index].result.currentDate);
    };
    const dragging = () => {
      const source = scrollers.current.get(latest.current.pages[pager.selectedScrollSnap()].key);
      if (source) for (const element of scrollers.current.values()) if (element !== source) element.scrollTop = source.scrollTop;
      pager.rootNode().dataset.dragging = 'true';
    };
    const released = () => {
      pager.rootNode().dataset.dragging = 'false';
      // Embla's release physics otherwise overrides the configured duration.
      pager.internalEngine().scrollBody.useDuration(reducedMotion.matches ? 0 : 18);
      selected();
    };
    const scrolling = () => {
      if (pager.internalEngine().dragHandler.pointerDown()) return;
      const distance = Math.abs(pager.scrollProgress() - pager.scrollSnapList()[pager.selectedScrollSnap()]);
      // Finish the invisible subpixel tail without blocking the next gesture.
      if (distance > 0 && distance < tolerance) pager.scrollTo(pager.selectedScrollSnap(), true);
    };
    const selectionChanged = () => { selected(); if (reducedMotion.matches) settled(); };
    pager.on('settle', settled).on('select', selectionChanged).on('reInit', reinitialized).on('scroll', scrolling).on('pointerDown', dragging).on('pointerUp', released);
    return () => { pager.off('settle', settled).off('select', selectionChanged).off('reInit', reinitialized).off('scroll', scrolling).off('pointerDown', dragging).off('pointerUp', released); };
  }, [pager]);
  const rememberScroll = (value: number) => {
    scrollPositions.current[viewMode] = value;
  };

  return <section className="screen timetable-screen" aria-busy={loading}>
    <div className="timetable-controls">
      <div className="segmented timetable-modes" role="tablist" aria-label="Widok planu" style={{ '--selected-mode': ['day', 'week', 'month'].indexOf(viewMode) } as CSSProperties}>
        {(['day', 'week', 'month'] as ViewMode[]).map((mode) => <button key={mode} type="button" role="tab" aria-selected={viewMode === mode} className={viewMode === mode ? 'active' : ''} onClick={() => onMode(mode)}>{t(`plan.${mode}`)}</button>)}
      </div>
      <div className="timetable-pager"><button type="button" className="icon-btn" aria-label={t('plan.prev')} title={t('plan.prev')} onClick={() => pager?.scrollPrev()}><Ic n="chevL" /></button><button type="button" className="text-btn" onClick={() => onNavigate(todayYmd())}>{t('plan.today')}</button><button type="button" className="icon-btn" aria-label={t('plan.next')} title={t('plan.next')} onClick={() => pager?.scrollNext()}><Ic n="chevR" /></button></div>
    </div>
    <div className="timetable-surface timetable-viewport" ref={viewportRef} role="region" aria-label={language === 'en' ? 'Timetable' : 'Plan zajęć'} tabIndex={0} onKeyDown={(e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.target instanceof Element && e.target.closest('input, select, textarea, summary')) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') pager?.scrollPrev(); else pager?.scrollNext();
    }}>
      <div className="plan-carousel-track">
        {pages.map((page) => <TimetableContent key={page.key} page={page} active={page.key === activeKey} loading={loading} compact={compact} language={language} t={t}
          onMode={onMode} onNavigate={onNavigate} onSelect={onSelect} onExport={onExport} onScroll={rememberScroll}
          scrollRef={(element) => { if (element) scrollers.current.set(page.key, element); else scrollers.current.delete(page.key); }} />)}
      </div>
    </div>
  </section>;
});
