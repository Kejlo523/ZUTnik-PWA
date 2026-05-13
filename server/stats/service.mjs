import crypto from 'node:crypto';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const RETENTION_DAYS = 180;
const SERIES_DAYS = 30;
const METHOD_KEYS = ['mzut', 'usos', 'other'];

function formatDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDayKey(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return raw.slice(0, 10);
  }
  return '';
}

function createEmptyMethodMap() {
  return {
    mzut: 0,
    usos: 0,
    other: 0,
  };
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
}

function normalizeMethodKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return METHOD_KEYS.includes(key) ? key : 'other';
}

function normalizeMethodMap(value) {
  const next = createEmptyMethodMap();
  if (!value || typeof value !== 'object') {
    return next;
  }

  for (const key of METHOD_KEYS) {
    next[key] = normalizeCount(value[key]);
  }

  return next;
}

function normalizeDeviceRecord(value) {
  const payload = value && typeof value === 'object' ? value : {};
  return {
    firstSeenAt: String(payload.firstSeenAt || '').trim(),
    lastSeenAt: String(payload.lastSeenAt || '').trim(),
    hitCount: normalizeCount(payload.hitCount),
    successfulLogins: normalizeCount(payload.successfulLogins),
    lastUserAgent: String(payload.lastUserAgent || '').slice(0, 240),
    lastAddress: String(payload.lastAddress || '').slice(0, 120),
    lastSuccessfulLoginAt: String(payload.lastSuccessfulLoginAt || '').trim(),
    lastSuccessfulLoginMethod: normalizeMethodKey(payload.lastSuccessfulLoginMethod || ''),
  };
}

function createEmptyStatsStore() {
  return {
    version: 2,
    devices: {},
    dailyActive: {},
    successfulLoginsTotal: 0,
    successfulLoginsByDay: {},
    successfulLoginsByMethod: createEmptyMethodMap(),
  };
}

function normalizeStatsStore(value) {
  if (!value || typeof value !== 'object') {
    return createEmptyStatsStore();
  }

  const payload = value;
  const normalizedDevices = {};
  const normalizedDailyActive = {};
  const normalizedLoginsByDay = {};

  if (payload.devices && typeof payload.devices === 'object') {
    for (const [deviceKey, record] of Object.entries(payload.devices)) {
      const key = String(deviceKey || '').trim();
      if (!key) continue;
      normalizedDevices[key] = normalizeDeviceRecord(record);
    }
  }

  if (payload.dailyActive && typeof payload.dailyActive === 'object') {
    for (const [day, rawDevices] of Object.entries(payload.dailyActive)) {
      const dayKey = toDayKey(day);
      if (!dayKey || !Array.isArray(rawDevices)) continue;
      normalizedDailyActive[dayKey] = [...new Set(rawDevices.map((item) => String(item || '').trim()).filter(Boolean))];
    }
  }

  if (payload.successfulLoginsByDay && typeof payload.successfulLoginsByDay === 'object') {
    for (const [day, rawCount] of Object.entries(payload.successfulLoginsByDay)) {
      const dayKey = toDayKey(day);
      const count = normalizeCount(rawCount);
      if (!dayKey || count <= 0) continue;
      normalizedLoginsByDay[dayKey] = count;
    }
  }

  return {
    version: 2,
    devices: normalizedDevices,
    dailyActive: normalizedDailyActive,
    successfulLoginsTotal: normalizeCount(payload.successfulLoginsTotal),
    successfulLoginsByDay: normalizedLoginsByDay,
    successfulLoginsByMethod: normalizeMethodMap(payload.successfulLoginsByMethod),
  };
}

function loadStatsStore(storePath) {
  try {
    if (!existsSync(storePath)) {
      return createEmptyStatsStore();
    }

    const raw = readFileSync(storePath, 'utf8');
    if (!raw.trim()) {
      return createEmptyStatsStore();
    }

    return normalizeStatsStore(JSON.parse(raw));
  } catch {
    return createEmptyStatsStore();
  }
}

function normalizeRequestAddress(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const first = trimmed.split(',')[0].trim();
  const withoutPort = first.startsWith('[')
    ? first.replace(/^\[|\]$/g, '')
    : first.replace(/:\d+$/, '');
  return withoutPort.split('%')[0];
}

function extractRequestAddresses(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((item) => normalizeRequestAddress(item))
    .filter(Boolean);
  const direct = [
    normalizeRequestAddress(req.ip),
    normalizeRequestAddress(req.socket?.remoteAddress),
  ].filter(Boolean);
  return [...new Set([...forwarded, ...direct])];
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentage(part, total) {
  if (!total) return 0;
  return (part / total) * 100;
}

function buildSeries(store, today, locale) {
  const newDevicesByDay = {};
  for (const device of Object.values(store.devices)) {
    const dayKey = toDayKey(device.firstSeenAt);
    if (!dayKey) continue;
    newDevicesByDay[dayKey] = (newDevicesByDay[dayKey] || 0) + 1;
  }

  const dayFormatter = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' });
  const fullFormatter = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', weekday: 'short' });
  const series = [];

  for (let offset = SERIES_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = formatDayKey(date);
    series.push({
      key,
      labelShort: dayFormatter.format(date),
      labelLong: fullFormatter.format(date),
      activeDevices: (store.dailyActive[key] || []).length,
      successfulLogins: store.successfulLoginsByDay[key] || 0,
      newDevices: newDevicesByDay[key] || 0,
    });
  }

  return series;
}

function buildActiveDeviceStats(store, series) {
  const activeDaysPerDevice = new Map();
  const activeDeviceKeys = new Set();

  for (const day of series) {
    const dayDevices = store.dailyActive[day.key] || [];
    for (const deviceKey of dayDevices) {
      activeDeviceKeys.add(deviceKey);
      activeDaysPerDevice.set(deviceKey, (activeDaysPerDevice.get(deviceKey) || 0) + 1);
    }
  }

  const uniqueActive = activeDeviceKeys.size;
  const returning = [...activeDaysPerDevice.values()].filter((count) => count >= 2).length;
  const bucketDefs = [
    { label: '1 dzien', match: (count) => count === 1 },
    { label: '2-3 dni', match: (count) => count >= 2 && count <= 3 },
    { label: '4-9 dni', match: (count) => count >= 4 && count <= 9 },
    { label: '10+ dni', match: (count) => count >= 10 },
  ];

  const buckets = bucketDefs.map((bucket) => {
    const count = [...activeDaysPerDevice.values()].filter(bucket.match).length;
    return {
      label: bucket.label,
      count,
      share: percentage(count, uniqueActive),
    };
  });

  return {
    uniqueActive,
    returning,
    returningShare: percentage(returning, uniqueActive),
    buckets,
  };
}

function findPeakDay(series, key) {
  return series.reduce((best, day) => {
    if (!best || day[key] > best[key]) return day;
    if (best && day[key] === best[key] && day.key > best.key) return day;
    return best;
  }, null);
}

export function createStatsService({ storePath, locale = 'pl-PL' }) {
  let statsStore = loadStatsStore(storePath);
  let statsPersistTimer = null;

  function persistStatsStore() {
    try {
      mkdirSync(path.dirname(storePath), { recursive: true });
      writeFileSync(storePath, JSON.stringify(statsStore, null, 2));
    } catch (error) {
      console.warn('Failed to persist local stats store', error);
    }
  }

  function scheduleStatsPersist() {
    if (statsPersistTimer) return;

    statsPersistTimer = setTimeout(() => {
      statsPersistTimer = null;
      persistStatsStore();
    }, 600);

    if (typeof statsPersistTimer.unref === 'function') {
      statsPersistTimer.unref();
    }
  }

  function pruneStatsBuckets(now = new Date()) {
    const cutoff = new Date(now);
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffKey = formatDayKey(cutoff);

    for (const day of Object.keys(statsStore.dailyActive)) {
      if (day < cutoffKey) {
        delete statsStore.dailyActive[day];
      }
    }

    for (const day of Object.keys(statsStore.successfulLoginsByDay)) {
      if (day < cutoffKey) {
        delete statsStore.successfulLoginsByDay[day];
      }
    }
  }

  function getRequestDeviceKey(req) {
    const explicitDeviceId = String(req.headers['x-zutnik-device-id'] || req.headers['x-mzut-device-id'] || '').trim();
    if (explicitDeviceId) {
      return `device:${crypto.createHash('sha1').update(explicitDeviceId).digest('hex')}`;
    }

    const address = extractRequestAddresses(req)[0] || 'unknown';
    const userAgent = String(req.headers['user-agent'] || 'unknown');
    return `legacy:${crypto.createHash('sha1').update(`${address}|${userAgent}`).digest('hex')}`;
  }

  function ensureTrackedDevice(req, nowIso = new Date().toISOString()) {
    const deviceKey = getRequestDeviceKey(req);
    if (!deviceKey) {
      return { deviceKey: '', record: null };
    }

    const current = statsStore.devices[deviceKey];
    const next = current && typeof current === 'object'
      ? normalizeDeviceRecord(current)
      : normalizeDeviceRecord({});

    next.firstSeenAt = next.firstSeenAt || nowIso;
    next.lastSeenAt = nowIso;
    next.lastUserAgent = String(req.headers['user-agent'] || '').slice(0, 240);
    next.lastAddress = (extractRequestAddresses(req)[0] || '').slice(0, 120);
    statsStore.devices[deviceKey] = next;

    return { deviceKey, record: next };
  }

  function recordDeviceActivity(req) {
    pruneStatsBuckets();
    const dayKey = formatDayKey();
    const { deviceKey, record } = ensureTrackedDevice(req);
    if (!deviceKey || !record) return;

    record.hitCount += 1;
    const bucket = statsStore.dailyActive[dayKey] ?? [];
    if (!bucket.includes(deviceKey)) {
      bucket.push(deviceKey);
      statsStore.dailyActive[dayKey] = bucket;
    }

    scheduleStatsPersist();
  }

  function recordSuccessfulLogin(req, method) {
    pruneStatsBuckets();
    const dayKey = formatDayKey();
    const nowIso = new Date().toISOString();
    const methodKey = normalizeMethodKey(method);
    const { record } = ensureTrackedDevice(req, nowIso);

    if (record) {
      record.successfulLogins += 1;
      record.lastSuccessfulLoginAt = nowIso;
      record.lastSuccessfulLoginMethod = methodKey;
    }

    statsStore.successfulLoginsTotal += 1;
    statsStore.successfulLoginsByDay[dayKey] = (statsStore.successfulLoginsByDay[dayKey] || 0) + 1;
    statsStore.successfulLoginsByMethod[methodKey] = (statsStore.successfulLoginsByMethod[methodKey] || 0) + 1;
    scheduleStatsPersist();
  }

  function getSnapshot(now = new Date()) {
    pruneStatsBuckets(now);

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const todayKey = formatDayKey(today);
    const series = buildSeries(statsStore, today, locale);
    const last7 = series.slice(-7);
    const activeStats = buildActiveDeviceStats(statsStore, series);
    const latest = series.at(-1) || { activeDevices: 0, successfulLogins: 0, newDevices: 0 };
    const previous = series.at(-2) || null;
    const peakActiveDay = findPeakDay(series, 'activeDevices');
    const peakLoginDay = findPeakDay(series, 'successfulLogins');
    const newDevices30d = series.reduce((sum, day) => sum + day.newDevices, 0);
    const totalApiHits = Object.values(statsStore.devices).reduce((sum, device) => sum + device.hitCount, 0);
    const trackedSinceKey = Object.values(statsStore.devices)
      .map((device) => toDayKey(device.firstSeenAt))
      .filter(Boolean)
      .sort()[0] || '';
    const trackedSinceLabel = trackedSinceKey
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${trackedSinceKey}T00:00:00`))
      : 'Brak danych';
    const methodTotal = Object.values(statsStore.successfulLoginsByMethod).reduce((sum, count) => sum + count, 0);
    const loginMethods = [
      { key: 'mzut', label: 'Legacy API', count: statsStore.successfulLoginsByMethod.mzut || 0 },
      { key: 'usos', label: 'USOS OAuth', count: statsStore.successfulLoginsByMethod.usos || 0 },
      { key: 'other', label: 'Inne', count: statsStore.successfulLoginsByMethod.other || 0 },
    ].map((method) => ({
      ...method,
      share: percentage(method.count, methodTotal),
    }));

    const topDays = [...series]
      .sort((left, right) => {
        if (right.activeDevices !== left.activeDevices) {
          return right.activeDevices - left.activeDevices;
        }
        if (right.successfulLogins !== left.successfulLogins) {
          return right.successfulLogins - left.successfulLogins;
        }
        return right.key.localeCompare(left.key);
      })
      .slice(0, 3)
      .map((day) => ({
        ...day,
        summaryLabel: day.labelLong,
      }));

    return {
      series,
      kpis: {
        todayActiveDevices: latest.activeDevices,
        uniqueActive30d: activeStats.uniqueActive,
        returningDevices30d: activeStats.returning,
        returningShare30d: activeStats.returningShare,
        newDevices30d,
        successfulLoginsToday: latest.successfulLogins,
        successfulLoginsTotal: statsStore.successfulLoginsTotal,
        totalDevices: Object.keys(statsStore.devices).length,
        totalApiHits,
        averageActive7d: average(last7.map((day) => day.activeDevices)),
        averageLogins7d: average(last7.map((day) => day.successfulLogins)),
        todayDeltaActive: previous ? latest.activeDevices - previous.activeDevices : 0,
        todayDeltaLogins: previous ? latest.successfulLogins - previous.successfulLogins : 0,
        newDevicesToday: latest.newDevices,
      },
      peaks: {
        active: peakActiveDay
          ? {
            label: peakActiveDay.labelLong,
            value: peakActiveDay.activeDevices,
          }
          : null,
        logins: peakLoginDay
          ? {
            label: peakLoginDay.labelLong,
            value: peakLoginDay.successfulLogins,
          }
          : null,
      },
      topDays,
      recentRows: [...series.slice(-7)].reverse(),
      activeMix: activeStats.buckets,
      loginMethods,
      loginMethodCoverage: {
        recordedTotal: methodTotal,
        overallTotal: statsStore.successfulLoginsTotal,
        isPartial: methodTotal < statsStore.successfulLoginsTotal,
      },
      meta: {
        todayKey,
        trackedSinceLabel,
        updatedAtLabel: new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(now),
        chartMax: Math.max(1, ...series.flatMap((day) => [day.activeDevices, day.successfulLogins, day.newDevices])),
      },
    };
  }

  return {
    recordDeviceActivity,
    recordSuccessfulLogin,
    getSnapshot,
  };
}
