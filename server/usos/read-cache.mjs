import crypto from 'node:crypto';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TTL = new Map([
  ['services/users/user', HOUR],
  ['services/apisrv/consumer', 7 * DAY],
  ['services/progs/student', 7 * DAY],
  ['services/progs/student_programme', 7 * DAY],
  ['services/courses/user', 6 * HOUR],
  ['services/courses/user_ects_points', 7 * DAY],
  ['services/credits/used_sum', 7 * DAY],
  ['services/cards/user', 7 * DAY],
  ['services/calendar/search', 7 * DAY],
  ['services/news/search', DAY],
]);

export function upstreamTtl(endpoint, params = {}) {
  if (endpoint === 'services/users/user' && params.fields === 'id|student_number') return 5 * MINUTE;
  if (TTL.has(endpoint)) return TTL.get(endpoint);
  if (endpoint.startsWith('services/grades/') || endpoint.startsWith('services/crstests/')) return 6 * HOUR;
  if (endpoint.startsWith('services/payments/') || endpoint.startsWith('services/surveys/')) return DAY;
  if (endpoint.startsWith('services/tt/')) return endpoint.endsWith('classgroup_dates2') ? 7 * DAY : 6 * HOUR;
  if (/^services\/(groups|courses|terms|geo)\//.test(endpoint) || endpoint === 'services/users/search2') return 7 * DAY;
  return 0;
}

// Only read responses live here. Keys contain a private credential digest, never tokens.
export function createUsosReadCache(fetchSource, { now = Date.now, spacing = 250, maxWait = 8000, maxEntries = 1000, maxBytes = 16 * 1024 * 1024 } = {}) {
  const salt = crypto.randomBytes(32);
  const entries = new Map();
  const pending = new Map();
  const endpoints = new Map();
  const startedAt = now();
  let bytes = 0;
  let busy = 0;
  let nextStart = 0;
  const waiting = [];

  function metrics(endpoint) {
    if (!endpoints.has(endpoint)) endpoints.set(endpoint, { endpoint, requests: 0, cacheHits: 0, coalesced: 0, backoffSkips: 0, errors: 0 });
    return endpoints.get(endpoint);
  }
  function put(key, entry) {
    bytes -= entries.get(key)?.size || 0;
    entries.delete(key);
    entry.size = entry.data === undefined ? 0 : Buffer.byteLength(JSON.stringify(entry.data));
    bytes += entry.size;
    entries.set(key, entry);
    while (entries.size > maxEntries || bytes > maxBytes) {
      const first = entries.keys().next().value;
      bytes -= entries.get(first).size;
      entries.delete(first);
    }
  }
  async function slot() {
    if (busy >= 2) await new Promise((resolve, reject) => {
      const ticket = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const index = waiting.indexOf(ticket);
        if (index >= 0) waiting.splice(index, 1);
        reject(Object.assign(new Error('Synchronizacja jest zajęta. Spróbuj później.'), { status: 503 }));
      }, maxWait);
      waiting.push(ticket);
    });
    else busy++;
    const start = Math.max(now(), nextStart);
    nextStart = start + spacing;
    const delay = start - now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  function release() {
    const next = waiting.shift();
    if (next) next();
    else busy--;
  }
  async function read(endpoint, options = {}) {
    endpoint = endpoint.replace(/^\//, '');
    const stats = metrics(endpoint);
    const owner = crypto.createHmac('sha256', salt).update(JSON.stringify([options.tokenMode || 'required', options.token || '', options.secret || ''])).digest('hex');
    const params = Object.entries(options.params || {}).filter(([, value]) => value !== null && value !== undefined && String(value) !== '').sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([owner, endpoint, params]);
    const cached = entries.get(key);
    const ttl = upstreamTtl(endpoint, options.params);
    // Manual refresh bypasses a long TTL, but never the five-minute request floor.
    if (cached?.data !== undefined && now() - cached.ts < (options.force && ttl ? Math.min(ttl, 5 * MINUTE) : ttl)) {
      stats.cacheHits++;
      return structuredClone(cached.data);
    }
    if (pending.has(key)) { stats.coalesced++; return structuredClone(await pending.get(key)); }
    if (cached?.retryAt > now()) { stats.backoffSkips++; throw cached.error; }
    if (pending.size >= 64) {
      stats.backoffSkips++;
      throw Object.assign(new Error('Synchronizacja jest zajęta. Spróbuj później.'), { status: 503 });
    }
    const operation = (async () => {
      let acquired = false;
      try {
        await slot(); acquired = true;
        stats.requests++;
        const result = await fetchSource(endpoint, options);
        if (ttl) put(key, { data: result, ts: now(), failures: 0 });
        return result;
      } catch (error) {
        if (acquired) stats.errors++;
        else stats.backoffSkips++;
        const failures = Math.min(8, (cached?.failures || 0) + 1);
        // Never serve stale data after an authentication failure.
        put(key, { error, failures, retryAt: now() + Math.min(6 * HOUR, 5 * MINUTE * 2 ** (failures - 1)) });
        throw error;
      } finally { if (acquired) release(); }
    })();
    pending.set(key, operation);
    try { return structuredClone(await operation); } finally { pending.delete(key); }
  }
  function snapshot() {
    const rows = [...endpoints.values()].map((row) => ({ ...row })).sort((a, b) => b.requests - a.requests);
    const totals = rows.reduce((sum, row) => {
      for (const key of ['requests', 'cacheHits', 'coalesced', 'backoffSkips', 'errors']) sum[key] += row[key];
      return sum;
    }, { requests: 0, cacheHits: 0, coalesced: 0, backoffSkips: 0, errors: 0 });
    return { ...totals, startedAt, updatedAt: now(), entries: entries.size, bytes, pending: pending.size, endpoints: rows };
  }
  return { read, snapshot };
}
