import { useEffect, useMemo, useRef, useState } from 'react';
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js';
import type { StatsSeriesDay, StatsSnapshot } from '../../types';
import type { AppSettings } from '../../services/storage';
import { Ic } from '../ui';
import { StatsLoadingSkeleton } from './ScreenLoaders';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

type Metric = 'activeDevices' | 'newDevices' | 'successfulLogins';
const copy = {
  pl: {
    activity: 'Aktywność', network: 'Ruch USOS', days: 'dni', active: 'Aktywne urządzenia', new: 'Nowe urządzenia', logins: 'Logowania USOS',
    today: 'dzisiaj', month: 'ostatnie 30 dni', total: 'Wszystkie urządzenia', returning: 'Powracające / 30 dni', average: 'Średnio aktywnych / 7 dni',
    updated: 'Stan na', since: 'Pomiar od', history: 'Dane dzienne', date: 'Dzień', peak: 'Maksimum', averagePeriod: 'Średnia dzienna',
    requests: 'Odczyty z USOS', hits: 'Odczyty z cache', saved: 'Bez zapytania do uczelni', errors: 'Błędy USOS',
    queued: 'Trwające / w kolejce', joined: 'Połączone pobrania', skipped: 'Wstrzymane pobrania', backend: 'Zapytania do serwera PWA',
    endpoints: 'Zapytania według zasobu', endpoint: 'Zasób', cache: 'Cache', unavailable: 'Brak danych',
    noNetwork: 'Pomiar ruchu USOS nie jest jeszcze dostępny.', restart: 'Liczniki USOS od uruchomienia serwera',
    offline: 'Offline', refresh: 'Odśwież', retry: 'Nie udało się pobrać statystyk.',
  },
  en: {
    activity: 'Activity', network: 'USOS traffic', days: 'days', active: 'Active devices', new: 'New devices', logins: 'USOS logins',
    today: 'today', month: 'last 30 days', total: 'All devices', returning: 'Returning / 30 days', average: 'Average active / 7 days',
    updated: 'As of', since: 'Tracking since', history: 'Daily data', date: 'Day', peak: 'Peak', averagePeriod: 'Daily average',
    requests: 'Reads from USOS', hits: 'Reads from cache', saved: 'Without a university request', errors: 'USOS errors',
    queued: 'Running / queued', joined: 'Coalesced reads', skipped: 'Paused reads', backend: 'Requests to the PWA server',
    endpoints: 'Requests by resource', endpoint: 'Resource', cache: 'Cache', unavailable: 'No data',
    noNetwork: 'USOS traffic measurements are not available yet.', restart: 'USOS counters since server start',
    offline: 'Offline', refresh: 'Refresh', retry: 'Could not load statistics.',
  },
};

function ActivityChart({ days, metric, label, locale }: { days: StatsSeriesDay[]; metric: Metric; label: string; locale: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const css = getComputedStyle(document.documentElement);
    const color = () => getComputedStyle(document.documentElement).getPropertyValue(metric === 'newDevices' ? '--stats-new' : metric === 'successfulLogins' ? '--stats-logins' : '--mz-primary').trim();
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: { labels: days.map((day) => day.labelShort), datasets: [{ label, data: days.map((day) => day[metric]), backgroundColor: color(), borderRadius: 3, maxBarThickness: 26 }] },
      options: {
        responsive: true, maintainAspectRatio: false, locale,
        animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 180 },
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { displayColors: false, callbacks: { title: (items) => days[items[0]?.dataIndex]?.labelLong || '', label: (item) => `${label}: ${new Intl.NumberFormat(locale).format(Number(item.raw))}` } } },
        scales: {
          x: { border: { display: false }, grid: { display: false }, ticks: { color: css.getPropertyValue('--mz-muted'), maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 11 } } },
          y: { beginAtZero: true, suggestedMax: 1, border: { display: false }, grid: { color: css.getPropertyValue('--mz-border-soft') }, ticks: { color: css.getPropertyValue('--mz-muted'), precision: 0, maxTicksLimit: 5, font: { size: 11 } } },
        },
      },
    });
    const observer = new MutationObserver(() => {
      const colors = getComputedStyle(document.documentElement);
      chart.data.datasets[0].backgroundColor = color();
      for (const axis of ['x', 'y'] as const) chart.options.scales![axis]!.ticks!.color = colors.getPropertyValue('--mz-muted');
      chart.options.scales!.y!.grid!.color = colors.getPropertyValue('--mz-border-soft');
      chart.update('none');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { observer.disconnect(); chart.destroy(); };
  }, [days, metric, label, locale]);
  return <div className="stats-canvas"><canvas ref={ref} role="img" aria-label={label} /></div>;
}

function Kpi({ label, value, note, tone = '' }: { label: string; value: string; note: string; tone?: string }) {
  return <div className={`stats-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export default function StatsScreen({ snapshot, statsLoading, statsError, language, onRefresh }: {
  snapshot: StatsSnapshot | null; statsLoading: boolean; statsError: string; language: AppSettings['language']; onRefresh: () => Promise<void> | void;
}) {
  const c = copy[language];
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const [tab, setTab] = useState<'activity' | 'network'>('activity');
  const [range, setRange] = useState<7 | 30>(30);
  const [metric, setMetric] = useState<Metric>('activeDevices');
  const days = useMemo(() => snapshot?.series.slice(-range) || [], [snapshot, range]);
  const metrics: Array<{ key: Metric; label: string }> = [{ key: 'activeDevices', label: c.active }, { key: 'newDevices', label: c.new }, { key: 'successfulLogins', label: c.logins }];

  if (statsLoading && !snapshot) return <section className="screen stats-screen"><StatsLoadingSkeleton /></section>;
  if (!snapshot) return <section className="screen stats-screen"><div className="empty-state"><Ic n="stats" /><h2>{c.unavailable}</h2><p>{statsError || c.retry}</p><button type="button" className="btn-secondary" disabled={statsLoading} onClick={() => void onRefresh()}><Ic n="refresh" />{c.refresh}</button></div></section>;
  const { kpis, network, meta } = snapshot;
  const label = metrics.find((item) => item.key === metric)!.label;
  const highest = days.reduce<StatsSeriesDay | null>((best, day) => !best || day[metric] > best[metric] ? day : best, null);
  const average = days.length ? days.reduce((sum, day) => sum + day[metric], 0) / days.length : 0;
  const avoided = network ? network.cacheHits + network.coalesced + network.backoffSkips : 0;
  const ratio = network && avoided + network.requests > 0 ? 100 * avoided / (avoided + network.requests) : 0;

  return <section className="screen stats-screen" aria-busy={statsLoading}>
    <div className="stats-status"><span><Ic n="clock" />{c.updated} {meta.updatedAtLabel}</span>{!navigator.onLine && <span><Ic n="wifi-off" />{c.offline}</span>}</div>
    {statsError && <p className="stats-error" role="status">{statsError}</p>}
    <div className="stats-tabs" role="tablist" aria-label={language === 'en' ? 'Statistics' : 'Statystyki'} onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'activity' : event.key === 'End' ? 'network' : tab === 'activity' ? 'network' : 'activity';
      setTab(next); document.getElementById(`stats-tab-${next}`)?.focus();
    }}>
      {(['activity', 'network'] as const).map((key) => <button key={key} id={`stats-tab-${key}`} type="button" role="tab" tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} aria-controls={`stats-panel-${key}`} onClick={() => setTab(key)}><Ic n={key === 'activity' ? 'stats' : 'layers'} />{c[key]}</button>)}
    </div>
    {tab === 'activity' ? <div role="tabpanel" id="stats-panel-activity" aria-labelledby="stats-tab-activity">
      <div className="stats-kpi-grid">
        <Kpi label={c.active} value={number(kpis.todayActiveDevices)} note={c.today} tone="is-accent" />
        <Kpi label={c.logins} value={number(kpis.successfulLoginsToday)} note={c.today} />
        <Kpi label={c.active} value={number(kpis.uniqueActive30d)} note={c.month} />
        <Kpi label={c.new} value={number(kpis.newDevices30d)} note={c.month} />
      </div>
      <section className="stats-section stats-activity">
        <header className="stats-section-head"><h2>{c.activity}</h2><div className="stats-range" role="group" aria-label={language === 'en' ? 'Date range' : 'Zakres dat'}>{([7, 30] as const).map((value) => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{value} {c.days}</button>)}</div></header>
        <div className="stats-metric-select" role="group" aria-label={language === 'en' ? 'Metric' : 'Miara'}>{metrics.map((item) => <button key={item.key} type="button" aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.label}</button>)}</div>
        <ActivityChart days={days} metric={metric} label={label} locale={locale} />
        <div className="stats-chart-summary"><span>{c.averagePeriod} <strong>{number(average)}</strong></span><span>{c.peak} <strong>{number(highest?.[metric] || 0)}</strong>{highest && highest[metric] > 0 && <small>{highest.labelShort}</small>}</span></div>
      </section>
      <dl className="stats-facts"><div><dt>{c.total}</dt><dd>{number(kpis.totalDevices)}</dd></div><div><dt>{c.returning}</dt><dd>{number(kpis.returningDevices30d)} <small>{number(kpis.returningShare30d)}%</small></dd></div><div><dt>{c.average}</dt><dd>{number(kpis.averageActive7d)}</dd></div></dl>
      <details className="stats-history"><summary>{c.history}<Ic n="chevR" /></summary><div className="stats-table-wrap"><table className="stats-table"><thead><tr><th scope="col">{c.date}</th><th scope="col">{c.active}</th><th scope="col">{c.new}</th><th scope="col">{c.logins}</th></tr></thead><tbody>{[...days].reverse().map((day) => <tr key={day.key}><th scope="row">{day.labelLong}</th><td>{number(day.activeDevices)}</td><td>{number(day.newDevices)}</td><td>{number(day.successfulLogins)}</td></tr>)}</tbody></table></div></details>
      <p className="stats-footnote">{c.since} {meta.trackedSinceLabel}{metric === 'successfulLogins' && meta.usosTrackingSince ? ` · USOS ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(meta.usosTrackingSince))}` : ''}</p>
    </div> : <div role="tabpanel" id="stats-panel-network" aria-labelledby="stats-tab-network">
      {network ? <>
        <div className="stats-kpi-grid"><Kpi label={c.requests} value={number(network.requests)} note="USOS API" /><Kpi label={c.hits} value={number(network.cacheHits)} note={c.cache} tone="is-accent" /><Kpi label={c.saved} value={`${number(ratio)}%`} note={number(avoided)} /><Kpi label={c.errors} value={number(network.errors)} note="USOS API" tone={network.errors ? 'is-warning' : ''} /></div>
        <dl className="stats-facts"><div><dt>{c.joined}</dt><dd>{number(network.coalesced)}</dd></div><div><dt>{c.skipped}</dt><dd>{number(network.backoffSkips)}</dd></div><div><dt>{c.queued}</dt><dd>{number(network.pending)}</dd></div></dl>
        <section className="stats-section"><header className="stats-section-head"><h2>{c.endpoints}</h2></header><div className="stats-table-wrap"><table className="stats-table stats-endpoints"><thead><tr><th scope="col">{c.endpoint}</th><th scope="col">USOS</th><th scope="col">{c.cache}</th><th scope="col">{c.errors}</th></tr></thead><tbody>{network.endpoints.map((row) => <tr key={row.endpoint}><th scope="row"><code>{row.endpoint.replace(/^services\//, '')}</code></th><td>{number(row.requests)}</td><td>{number(row.cacheHits)}</td><td className={row.errors ? 'stats-error-value' : ''}>{number(row.errors)}</td></tr>)}</tbody></table></div></section>
        <p className="stats-footnote">{c.restart}: {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(network.startedAt))}</p>
      </> : <p className="stats-footnote">{c.noNetwork}</p>}
      <dl className="stats-facts stats-server-total"><div><dt>{c.backend}</dt><dd>{number(kpis.totalApiHits)}</dd></div></dl>
    </div>}
  </section>;
}
