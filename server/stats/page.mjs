function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtInt(value) {
  const number = Number(value);
  return new Intl.NumberFormat('pl-PL').format(Number.isFinite(number) ? Math.round(number) : 0);
}

function fmtAvg(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0,0';
  return number.toFixed(1).replace('.', ',');
}

function fmtPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '0%';
  const digits = number < 10 ? 1 : 0;
  return `${number.toFixed(digits).replace('.', ',')}%`;
}

function fmtSignedDelta(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return '0';
  return `${number > 0 ? '+' : ''}${fmtInt(number)}`;
}

function niceMax(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(numeric));
  const normalized = numeric / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return magnitude * 2;
  if (normalized <= 5) return magnitude * 5;
  return magnitude * 10;
}

function buildLinePath(points) {
  if (!points.length) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function buildAreaPath(points, baselineY) {
  if (!points.length) return '';
  const line = buildLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

function renderLegend(items) {
  return `
    <div class="legend">
      ${items.map((item) => `
        <div class="legend-item">
          <span class="legend-swatch ${escapeHtml(item.className)}"></span>
          <span>${escapeHtml(item.label)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderKpiCard({ label, value, note, tone = '' }) {
  return `
    <article class="kpi-card ${escapeHtml(tone)}">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(value)}</div>
      <div class="kpi-note">${escapeHtml(note)}</div>
    </article>
  `;
}

function renderActivityChart(series) {
  const width = 880;
  const height = 320;
  const padding = { top: 16, right: 18, bottom: 40, left: 44 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const chartMax = niceMax(Math.max(1, ...series.flatMap((day) => [day.activeDevices, day.successfulLogins])));
  const step = series.length > 1 ? innerWidth / (series.length - 1) : innerWidth;
  const barSlot = innerWidth / Math.max(1, series.length);
  const barWidth = Math.max(10, Math.min(16, barSlot * 0.62));
  const pointFor = (index, value) => {
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

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Aktywne urządzenia oraz poprawne logowania z ostatnich 30 dni">
      ${gridLines.map((line) => `
        <g class="chart-grid-row">
          <line x1="${padding.left}" y1="${line.y}" x2="${width - padding.right}" y2="${line.y}"></line>
          <text x="${padding.left - 10}" y="${line.y + 4}" text-anchor="end">${escapeHtml(fmtInt(line.value))}</text>
        </g>
      `).join('')}
      ${series.map((day, index) => {
        const point = pointFor(index, day.activeDevices);
        const barHeight = Math.max(4, padding.top + innerHeight - point.y);
        const barX = point.x - barWidth / 2;
        const barY = padding.top + innerHeight - barHeight;
        const isToday = index === series.length - 1;
        return `
          <g class="chart-bar-group">
            <title>${escapeHtml(`${day.labelLong}: aktywne ${day.activeDevices}, logowania ${day.successfulLogins}`)}</title>
            <rect class="chart-bar${isToday ? ' is-today' : ''}" x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="6"></rect>
          </g>
        `;
      }).join('')}
      <path class="chart-line" d="${buildLinePath(loginPoints)}"></path>
      ${loginPoints.map((point, index) => `
        <g class="chart-point-wrap">
          <title>${escapeHtml(`${series[index].labelLong}: logowania ${series[index].successfulLogins}`)}</title>
          <circle class="chart-point" cx="${point.x}" cy="${point.y}" r="${index === series.length - 1 ? 4.5 : 3.5}"></circle>
        </g>
      `).join('')}
      ${xLabels.map(({ day, index }) => {
        const point = pointFor(index, 0);
        return `<text class="chart-x-label" x="${point.x}" y="${height - 10}" text-anchor="middle">${escapeHtml(day.labelShort)}</text>`;
      }).join('')}
    </svg>
  `;
}

function renderNewDevicesChart(series) {
  const width = 540;
  const height = 220;
  const padding = { top: 14, right: 16, bottom: 32, left: 36 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const chartMax = niceMax(Math.max(1, ...series.map((day) => day.newDevices)));
  const step = series.length > 1 ? innerWidth / (series.length - 1) : innerWidth;
  const pointFor = (index, value) => {
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

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg compact" role="img" aria-label="Nowe urządzenia z ostatnich 30 dni">
      ${gridLines.map((line) => `
        <g class="chart-grid-row subtle">
          <line x1="${padding.left}" y1="${line.y}" x2="${width - padding.right}" y2="${line.y}"></line>
          <text x="${padding.left - 10}" y="${line.y + 4}" text-anchor="end">${escapeHtml(fmtInt(line.value))}</text>
        </g>
      `).join('')}
      <path class="chart-area-soft" d="${buildAreaPath(points, padding.top + innerHeight)}"></path>
      <path class="chart-line warm" d="${buildLinePath(points)}"></path>
      ${points.map((point, index) => `
        <g class="chart-point-wrap">
          <title>${escapeHtml(`${series[index].labelLong}: nowe urządzenia ${series[index].newDevices}`)}</title>
          <circle class="chart-point warm" cx="${point.x}" cy="${point.y}" r="${index === points.length - 1 ? 4 : 3}"></circle>
        </g>
      `).join('')}
      ${xLabels.map(({ day, index }) => {
        const point = pointFor(index, 0);
        return `<text class="chart-x-label" x="${point.x}" y="${height - 8}" text-anchor="middle">${escapeHtml(day.labelShort)}</text>`;
      }).join('')}
    </svg>
  `;
}

function renderTopDays(topDays) {
  return `
    <div class="rank-list">
      ${topDays.map((day, index) => `
        <div class="rank-item">
          <div class="rank-index">${index + 1}</div>
          <div class="rank-copy">
            <div class="rank-title">${escapeHtml(day.summaryLabel)}</div>
            <div class="rank-meta">Aktywne: <strong>${escapeHtml(fmtInt(day.activeDevices))}</strong> · Logowania: <strong>${escapeHtml(fmtInt(day.successfulLogins))}</strong></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderBarList(items, { accentClass, countLabel }) {
  const maxCount = Math.max(1, ...items.map((item) => item.count));
  return `
    <div class="bar-list">
      ${items.map((item) => `
        <div class="bar-row">
          <div class="bar-row-head">
            <span>${escapeHtml(item.label)}</span>
            <span>${escapeHtml(`${fmtInt(item.count)} ${countLabel}`)}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill ${escapeHtml(accentClass)}" style="width:${Math.max(4, (item.count / maxCount) * 100)}%"></div>
          </div>
          <div class="bar-row-foot">${escapeHtml(fmtPercent(item.share))}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRecentTable(rows) {
  return `
    <div class="table-wrap">
      <table class="stats-table">
        <thead>
          <tr>
            <th>Dzień</th>
            <th>Aktywne urządzenia</th>
            <th>Nowe urządzenia</th>
            <th>Poprawne logowania</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.labelLong)}</td>
              <td>${escapeHtml(fmtInt(row.activeDevices))}</td>
              <td>${escapeHtml(fmtInt(row.newDevices))}</td>
              <td>${escapeHtml(fmtInt(row.successfulLogins))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export function renderStatsPage({ snapshot, appHomePath }) {
  const { kpis, meta, peaks, series, topDays, activeMix, loginMethods, loginMethodCoverage, recentRows } = snapshot;
  const activityCoverage = kpis.totalDevices > 0 ? (kpis.uniqueActive30d / kpis.totalDevices) * 100 : 0;
  const cards = [
    { label: 'Aktywne dziś', value: fmtInt(kpis.todayActiveDevices), note: `${fmtSignedDelta(kpis.todayDeltaActive)} vs wczoraj`, tone: 'tone-cool' },
    { label: 'Logowania dziś', value: fmtInt(kpis.successfulLoginsToday), note: `${fmtSignedDelta(kpis.todayDeltaLogins)} vs wczoraj`, tone: 'tone-cool' },
    { label: 'Unikalne 30 dni', value: fmtInt(kpis.uniqueActive30d), note: `${fmtPercent(activityCoverage)} bazy`, tone: 'tone-mint' },
    { label: 'Powracające 30 dni', value: fmtInt(kpis.returningDevices30d), note: `${fmtPercent(kpis.returningShare30d)} aktywnych`, tone: 'tone-amber' },
  ];
  const methodsWithFallback = loginMethods.some((item) => item.count > 0)
    ? loginMethods
    : [{ label: 'Brak danych', count: 0, share: 0 }];

  return `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>ZUTnik • Statystyki</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #000000;
      --panel: #0a0a0a;
      --panel-strong: #101010;
      --panel-soft: #060606;
      --border: #1f1f1f;
      --border-strong: #343434;
      --text: #f5f5f5;
      --muted: #929292;
      --cool: #ffffff;
      --mint: #d6d6d6;
      --amber: #9b9b9b;
      --rose: #b8b8b8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Aptos", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
      color: var(--text);
      background: var(--bg);
      padding: 18px 14px 28px;
    }
    .shell { max-width: 1180px; margin: 0 auto; display: grid; gap: 14px; }
    .card {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 18px;
      overflow: hidden;
    }
    .hero {
      padding: 18px;
      display: grid;
      gap: 14px;
    }
    .hero-top { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--panel-soft);
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1, h2, h3, p { margin: 0; }
    .hero h1 {
      margin-top: 10px;
      font-size: clamp(28px, 4vw, 40px);
      line-height: 1;
      letter-spacing: -0.04em;
    }
    .hero-copy {
      margin-top: 6px;
      max-width: 42ch;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .btn, .btn:visited {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 0 14px;
      border-radius: 12px;
      border: 1px solid var(--border-strong);
      background: #111111;
      color: var(--text);
      text-decoration: none;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .btn-primary { background: #161616; }
    .hero-meta-line {
      padding-top: 12px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .kpi-card {
      padding: 16px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel-strong);
      min-height: 0;
      display: grid;
      align-content: start;
      gap: 8px;
    }
    .kpi-label { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .kpi-value { font-size: clamp(28px, 4vw, 38px); line-height: 0.95; font-weight: 800; letter-spacing: -0.05em; }
    .kpi-note { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .main-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(300px, 0.9fr); gap: 14px; }
    .section-card { padding: 18px; display: grid; gap: 14px; }
    .section-head { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
    .section-overline {
      display: none;
    }
    .section-title, .card-title-sm {
      font-size: clamp(20px, 3vw, 26px);
      line-height: 1.08;
      letter-spacing: -0.03em;
    }
    .card-title-sm { font-size: 20px; }
    .section-meta {
      padding: 10px 12px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel-soft);
      min-width: 170px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .section-meta strong { color: var(--text); display: block; font-size: 18px; line-height: 1.1; margin-top: 4px; letter-spacing: -0.03em; }
    .chart-shell {
      padding: 14px;
      border-radius: 16px;
      border: 1px solid var(--border);
      background: var(--panel-soft);
    }
    .chart-svg { display: block; width: 100%; height: auto; }
    .chart-grid-row line { stroke: rgba(255, 255, 255, 0.08); stroke-width: 1; }
    .chart-grid-row text { fill: #7d7d7d; font-size: 12px; font-weight: 600; }
    .chart-grid-row.subtle line { stroke: rgba(255, 255, 255, 0.06); }
    .chart-bar { fill: rgba(255, 255, 255, 0.14); stroke: rgba(255, 255, 255, 0.18); stroke-width: 1; }
    .chart-bar.is-today { fill: rgba(255, 255, 255, 0.34); stroke: rgba(255, 255, 255, 0.42); }
    .chart-line { fill: none; stroke: var(--mint); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
    .chart-line.warm { stroke: var(--amber); }
    .chart-point { fill: var(--mint); stroke: #000000; stroke-width: 2; }
    .chart-point.warm { fill: var(--amber); }
    .chart-area-soft { fill: rgba(255, 255, 255, 0.06); stroke: none; }
    .chart-x-label { fill: #7d7d7d; font-size: 12px; font-weight: 700; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; }
    .legend-item { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; font-weight: 600; }
    .legend-swatch { width: 12px; height: 12px; border-radius: 999px; display: inline-block; }
    .legend-swatch.bar-active { background: #a9a9a9; }
    .legend-swatch.line-logins { background: var(--mint); }
    .legend-swatch.line-new { background: var(--amber); }
    .side-stack, .detail-grid { display: grid; gap: 14px; }
    .detail-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .rank-list, .bar-list { display: grid; gap: 12px; }
    .rank-item {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel-soft);
    }
    .rank-index {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: #111111;
      color: var(--text);
      border: 1px solid var(--border);
      font-weight: 800;
      font-size: 18px;
      letter-spacing: -0.03em;
    }
    .rank-title { font-size: 16px; font-weight: 700; line-height: 1.3; }
    .rank-meta { margin-top: 6px; color: var(--muted); font-size: 13px; line-height: 1.55; }
    .bar-row { display: grid; gap: 8px; }
    .bar-row-head { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; font-size: 14px; line-height: 1.4; }
    .bar-row-head span:first-child { font-weight: 700; }
    .bar-row-head span:last-child { color: var(--muted); }
    .bar-track {
      width: 100%;
      height: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .bar-fill { height: 100%; border-radius: inherit; min-width: 6px; }
    .bar-fill.mint { background: #a8a8a8; }
    .bar-fill.cool { background: #d8d8d8; }
    .bar-row-foot { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--panel-soft);
    }
    .stats-table { width: 100%; border-collapse: collapse; min-width: 680px; }
    .stats-table th, .stats-table td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      text-align: left;
      font-size: 14px;
      line-height: 1.45;
      white-space: nowrap;
    }
    .stats-table th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      background: rgba(255, 255, 255, 0.02);
    }
    .stats-table td:nth-child(n + 2) { text-align: right; font-variant-numeric: tabular-nums; }
    .note-box {
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel-soft);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    @media (max-width: 1180px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .main-grid, .detail-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 820px) {
      body { padding: 16px 12px 28px; }
      .hero-top { flex-direction: column; }
      .hero { padding: 16px; }
      .section-card { padding: 16px; }
      .section-head { flex-direction: column; }
      .section-meta { min-width: 0; width: 100%; }
    }
    @media (max-width: 560px) {
      .kpi-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="card hero">
      <div class="hero-top">
        <div>
          <div class="eyebrow">/v2/stats</div>
          <h1>Statystyki</h1>
          <p class="hero-copy">Ruch, logowania i retencja w jednym miejscu.</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="btn btn-primary" onclick="window.location.reload()">Odśwież</button>
          <a class="btn" href="${escapeHtml(appHomePath)}">Powrót</a>
        </div>
      </div>
      <div class="hero-meta-line">
        Aktualizacja: ${escapeHtml(meta.updatedAtLabel)} · Od: ${escapeHtml(meta.trackedSinceLabel)} ·
        Urządzenia: ${escapeHtml(fmtInt(kpis.totalDevices))} · Nowe 30 dni: ${escapeHtml(fmtInt(kpis.newDevices30d))} ·
        Logowania: ${escapeHtml(fmtInt(kpis.successfulLoginsTotal))}
      </div>
      <div class="kpi-grid">
        ${cards.map(renderKpiCard).join('')}
      </div>
    </section>

    <section class="main-grid">
      <article class="card section-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">Aktywne vs logowania</h2>
          </div>
          <div class="section-meta">
            Średnio aktywnych / 7 dni
            <strong>${escapeHtml(fmtAvg(kpis.averageActive7d))}</strong>
            Szczyt aktywności: ${escapeHtml(peaks.active ? `${fmtInt(peaks.active.value)} · ${peaks.active.label}` : 'brak danych')}
          </div>
        </div>
        <div class="chart-shell">
          ${renderLegend([{ label: 'Aktywne urządzenia', className: 'bar-active' }, { label: 'Poprawne logowania', className: 'line-logins' }])}
          ${renderActivityChart(series)}
        </div>
      </article>

      <aside class="side-stack">
        <article class="card section-card">
          <div>
            <h3 class="card-title-sm">Najmocniejsze dni</h3>
          </div>
          ${renderTopDays(topDays)}
        </article>

        <article class="card section-card">
          <div>
            <h3 class="card-title-sm">Źródła logowania</h3>
          </div>
          ${renderBarList(methodsWithFallback, { accentClass: 'cool', countLabel: 'logowań' })}
          <div class="note-box">
            ${loginMethodCoverage.isPartial
              ? `Część starszych logowań nie ma przypisanej metody.`
              : `Pełny podział metod.`}
          </div>
        </article>
      </aside>
    </section>

    <section class="detail-grid">
      <article class="card section-card">
        <div class="section-head">
          <div>
            <h2 class="card-title-sm">Nowe urządzenia</h2>
          </div>
          <div class="section-meta">
            30 dni
            <strong>${escapeHtml(fmtInt(kpis.newDevices30d))}</strong>
            Dziś: ${escapeHtml(fmtInt(kpis.newDevicesToday))}
          </div>
        </div>
        <div class="chart-shell">
          ${renderLegend([{ label: 'Nowe urządzenia', className: 'line-new' }])}
          ${renderNewDevicesChart(series)}
        </div>
      </article>

      <article class="card section-card">
        <div>
          <h2 class="card-title-sm">Powracalność</h2>
        </div>
        ${renderBarList(activeMix, { accentClass: 'mint', countLabel: 'urządzeń' })}
      </article>
    </section>

    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2 class="card-title-sm">Ostatnie 7 dni</h2>
        </div>
        <div class="section-meta">
          Tabela
          <strong>7 dni</strong>
          Najnowsze u góry.
        </div>
      </div>
      ${renderRecentTable(recentRows)}
    </section>
  </main>
</body>
</html>`;
}
