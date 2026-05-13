import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Try loading from several locations: root, current dir
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Agent } from 'undici';
import { createStatsService } from './stats/service.mjs';
import { renderStatsPage } from './stats/page.mjs';

const app = express();
const port = Number(process.env.PORT || 8787);

const USOS_CONSUMER_KEY = process.env.USOS_CONSUMER_KEY || '';
const USOS_CONSUMER_SECRET = process.env.USOS_CONSUMER_SECRET || '';
const USOS_BASE_URL = (process.env.USOS_BASE_URL || 'https://usosapi.zut.edu.pl/').replace(/\/+$/, '') + '/';

const MZUT_API_BASE = 'https://www.zut.edu.pl/app-json-proxy/index.php';
const PLAN_STUDENT_BASE = 'https://plan.zut.edu.pl/schedule_student.php';
const PLAN_SUGGEST_BASE = 'https://plan.zut.edu.pl/schedule.php';
const RSS_URL = 'https://www.zut.edu.pl/rssfeed-studenci';
const REQUEST_TIMEOUT_MS = 20_000;
const APP_BASE_PATH = (() => {
  const raw = String(process.env.VITE_APP_BASE || '/v2').trim();
  if (!raw) return '/v2';
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  return normalized.replace(/\/+$/, '') || '/';
})();
const APP_HOME_PATH = APP_BASE_PATH === '/' ? '/' : `${APP_BASE_PATH}/`;
const STATS_ROUTE_PATH = APP_BASE_PATH === '/' ? '/stats' : `${APP_BASE_PATH}/stats`;
const STATS_STORE_PATH = path.join(__dirname, 'data', 'usage-stats.json');
const PLAN_FILTERS_STORE_PATH = path.join(__dirname, 'data', 'plan-hidden-subjects.json');
const STATS_BASIC_USER = process.env.STATS_USER || 'Kejlo';
const STATS_BASIC_PASS = process.env.STATS_PASS || 'hx875875';

const unsafeAgent = new Agent({
  connect: { rejectUnauthorized: false },
});
const statsAccessLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 400 && getStatsAuthState(req) === 'valid',
});
const statsService = createStatsService({ storePath: STATS_STORE_PATH, locale: 'pl-PL' });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.set('trust proxy', 1);
app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/') && req.path !== '/api/health') {
    statsService.recordDeviceActivity(req);
  }
  next();
});

function sanitizeFunctionName(value) {
  const fn = String(value || '').trim();
  return /^[a-zA-Z0-9_]+$/.test(fn) ? fn : '';
}

function sanitizeParams(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_]+$/.test(key)) continue;
    out[key] = String(raw ?? '');
  }
  return out;
}

function normalizeAlbumKey(value) {
  const album = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{3,32}$/.test(album) ? album : '';
}

function normalizePlanHiddenSubjectKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function createEmptyPlanFiltersStore() {
  return {
    version: 1,
    albums: {},
  };
}

function normalizePlanFiltersStore(value) {
  if (!value || typeof value !== 'object') {
    return createEmptyPlanFiltersStore();
  }

  const albums = {};
  const rawAlbums = value.albums && typeof value.albums === 'object' ? value.albums : {};

  for (const [rawAlbum, rawKeys] of Object.entries(rawAlbums)) {
    const album = normalizeAlbumKey(rawAlbum);
    if (!album) continue;

    const hiddenSubjectKeys = normalizePlanHiddenSubjectKeys(rawKeys);
    if (!hiddenSubjectKeys.length) continue;

    albums[album] = hiddenSubjectKeys;
  }

  return {
    version: 1,
    albums,
  };
}

function loadPlanFiltersStore(storePath) {
  try {
    if (!existsSync(storePath)) {
      return createEmptyPlanFiltersStore();
    }

    const raw = readFileSync(storePath, 'utf8');
    if (!raw.trim()) {
      return createEmptyPlanFiltersStore();
    }

    return normalizePlanFiltersStore(JSON.parse(raw));
  } catch {
    return createEmptyPlanFiltersStore();
  }
}

function savePlanFiltersStore(storePath, store) {
  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(normalizePlanFiltersStore(store), null, 2));
}

function getPlanHiddenSubjects(album) {
  const normalizedAlbum = normalizeAlbumKey(album);
  if (!normalizedAlbum) return [];

  const store = loadPlanFiltersStore(PLAN_FILTERS_STORE_PATH);
  return store.albums[normalizedAlbum] || [];
}

function setPlanHiddenSubjects(album, hiddenSubjectKeys) {
  const normalizedAlbum = normalizeAlbumKey(album);
  if (!normalizedAlbum) return [];

  const normalizedKeys = normalizePlanHiddenSubjectKeys(hiddenSubjectKeys);
  const store = loadPlanFiltersStore(PLAN_FILTERS_STORE_PATH);

  if (normalizedKeys.length) {
    store.albums[normalizedAlbum] = normalizedKeys;
  } else {
    delete store.albums[normalizedAlbum];
  }

  savePlanFiltersStore(PLAN_FILTERS_STORE_PATH, store);
  return normalizedKeys;
}

function safeTextEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getStatsAuthState(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Basic ')) {
    return 'missing';
  }

  let decoded = '';
  try {
    decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return 'invalid';
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) {
    return 'invalid';
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  return safeTextEqual(username, STATS_BASIC_USER) && safeTextEqual(password, STATS_BASIC_PASS)
    ? 'valid'
    : 'invalid';
}

function sendStatsBasicAuthPrompt(res) {
  res.set('WWW-Authenticate', 'Basic realm="ZUTnik stats", charset="UTF-8"');
  return res.status(401).type('text/plain').send('Authentication required');
}

function redirectToAppHome(res) {
  return res.redirect(APP_HOME_PATH);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      dispatcher: unsafeAgent,
      signal: controller.signal,
      ...options,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function passthroughJson(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Niepoprawny JSON z upstream');
  }
}

// ── USOS OAuth 1.0a Signing ────────────────────────────────────────────────

function pct(s) {
  if (!s) return '';
  return encodeURIComponent(String(s))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+') // Simple OAuth 1.0 implementation often uses + for space, but RFC 3986 says %20.
    // However, the Android implementation used .replace("+", "%20"), so it wants %20.
    .replace(/\+/g, '%20')
    .replace(/%7E/g, '~');
}

function signOAuth1(method, baseUrl, params, consumerSecret, tokenSecret = '') {
  // Sort and join params
  const sortedPairs = Object.entries(params)
    .map(([k, v]) => `${pct(k)}=${pct(v)}`)
    .sort()
    .join('&');

  const sigBase = [
    method.toUpperCase(),
    pct(baseUrl),
    pct(sortedPairs)
  ].join('&');

  const signingKey = [
    pct(consumerSecret),
    pct(tokenSecret)
  ].join('&');

  return crypto
    .createHmac('sha1', signingKey)
    .update(sigBase)
    .digest('base64');
}

function getAuthHeader(oauthParams, signature) {
  const parts = Object.entries(oauthParams)
    .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
    .sort();
  parts.push(`oauth_signature="${pct(signature)}"`);
  return `OAuth ${parts.join(', ')}`;
}

function baseOAuthParams() {
  return {
    oauth_consumer_key: USOS_CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0'
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

app.get('/api/plan-hidden-subjects/:album', (req, res) => {
  const album = normalizeAlbumKey(req.params.album);
  if (!album) {
    return res.status(400).json({ error: 'Niepoprawny numer albumu.' });
  }

  return res.json({
    album,
    hiddenSubjectKeys: getPlanHiddenSubjects(album),
  });
});

app.put('/api/plan-hidden-subjects/:album', (req, res) => {
  const album = normalizeAlbumKey(req.params.album);
  if (!album) {
    return res.status(400).json({ error: 'Niepoprawny numer albumu.' });
  }

  const hiddenSubjectKeys = setPlanHiddenSubjects(album, req.body?.hiddenSubjectKeys);
  return res.json({
    album,
    hiddenSubjectKeys,
  });
});

app.post('/api/proxy/mzut', async (req, res) => {
  try {
    const fn = sanitizeFunctionName(req.body?.fn);
    const params = sanitizeParams(req.body?.params);

    if (!fn) {
      return res.status(400).json({ error: 'Brak poprawnej funkcji ZUT' });
    }

    const url = `${MZUT_API_BASE}?f=${encodeURIComponent(fn)}`;
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      body.set(key, value);
    }

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'ZUTnik-PWA-Proxy/1.0',
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body,
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream ZUT HTTP ${response.status}` });
    }

    const data = await passthroughJson(response);
    const status = String(data?.logInStatus || data?.loginInStatus || '').trim().toUpperCase();
    if (fn === 'getAuthorization' && status === 'OK') {
      statsService.recordSuccessfulLogin(req, 'mzut');
    }
    return res.json({ data });
  } catch (error) {
    return res.status(502).json({ error: `Proxy ZUT error: ${error.message}` });
  }
});

app.get('/api/proxy/plan-student', async (req, res) => {
  try {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (!/^[a-zA-Z0-9_]+$/.test(key)) continue;
      query.set(key, String(value ?? ''));
    }

    const url = `${PLAN_STUDENT_BASE}?${query.toString()}`;
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'ZUTnik-PWA-Proxy/1.0' },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream plan HTTP ${response.status}` });
    }

    const data = await passthroughJson(response);
    return res.json({ data });
  } catch (error) {
    return res.status(502).json({ error: `Proxy plan error: ${error.message}` });
  }
});

app.get('/api/proxy/plan-suggest', async (req, res) => {
  try {
    const kind = String(req.query.kind ?? '').trim();
    const query = String(req.query.query ?? '').trim();
    if (!kind || !query) {
      return res.json({ data: [] });
    }

    const url = `${PLAN_SUGGEST_BASE}?kind=${encodeURIComponent(kind)}&query=${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'ZUTnik-PWA-Proxy/1.0' },
    });

    if (!response.ok) {
      return res.json({ data: [] });
    }

    const data = await passthroughJson(response);
    return res.json({ data: Array.isArray(data) ? data : [] });
  } catch {
    return res.json({ data: [] });
  }
});

app.get('/api/proxy/image', async (req, res) => {
  try {
    const userId = String(req.query.userId ?? '').trim();
    const tokenJpg = String(req.query.tokenJpg ?? '').trim();
    if (!userId || !tokenJpg) {
      return res.status(400).json({ error: 'Missing userId or tokenJpg' });
    }

    const url = `https://www.zut.edu.pl/app-json-proxy/image/?userId=${encodeURIComponent(userId)}&tokenJpg=${encodeURIComponent(tokenJpg)}`;
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'ZUTnik-PWA-Proxy/1.0' },
    });

    if (!response.ok) {
      return res.status(response.status).end();
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length === 0) {
      return res.status(404).end();
    }

    // ZUT returns JPEG with wrong Content-Type (text/html), detect from magic bytes
    let contentType = 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) contentType = 'image/png';
    else if (buffer[0] === 0x47 && buffer[1] === 0x49) contentType = 'image/gif';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  } catch (error) {
    return res.status(502).json({ error: `Image proxy error: ${error.message}` });
  }
});

app.get('/api/usos/image', async (req, res) => {
  try {
    const url = String(req.query.url ?? '').trim();
    if (!url || !url.includes('zut.edu.pl')) {
      return res.status(400).json({ error: 'Invalid USOS image URL' });
    }

    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'ZUTnik-PWA-Proxy/1.0' },
    });

    if (!response.ok) {
      return res.status(response.status).end();
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return res.status(404).end();
    }

    let contentType = 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) contentType = 'image/png';
    else if (buffer[0] === 0x47 && buffer[1] === 0x49) contentType = 'image/gif';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  } catch (error) {
    return res.status(502).end();
  }
});

// ── USOS API Endpoints ──────────────────────────────────────────────────────

app.get('/api/usos/request-token', async (req, res) => {
  try {
    const scopes = String(req.query.scopes || 'studies|grades|personal|photo|email|mobile_numbers|payments|cards');
    const callbackUrl = String(req.query.callbackUrl || '');

    const url = `${USOS_BASE_URL}services/oauth/request_token`;
    const oauthParams = {
      ...baseOAuthParams(),
      oauth_callback: callbackUrl
    };

    const allParams = { ...oauthParams, scopes };
    const sig = signOAuth1('POST', url, allParams, USOS_CONSUMER_SECRET);
    const authHeader = getAuthHeader(oauthParams, sig);

    const body = new URLSearchParams();
    body.set('scopes', scopes);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'ZUTnik-PWA-Proxy/1.0',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: `USOS Request Token error: ${text}` });
    }

    const result = Object.fromEntries(new URLSearchParams(text));
    statsService.recordSuccessfulLogin(req, 'usos');
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/usos/access-token', async (req, res) => {
  try {
    const { oauth_token, oauth_token_secret, oauth_verifier } = req.body;
    if (!oauth_token || !oauth_token_secret || !oauth_verifier) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    const url = `${USOS_BASE_URL}services/oauth/access_token`;
    const oauthParams = {
      ...baseOAuthParams(),
      oauth_token,
      oauth_verifier
    };

    const sig = signOAuth1('POST', url, oauthParams, USOS_CONSUMER_SECRET, oauth_token_secret);
    const authHeader = getAuthHeader(oauthParams, sig);

    const body = new URLSearchParams();
    body.set('oauth_verifier', oauth_verifier);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'ZUTnik-PWA-Proxy/1.0',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: `USOS Access Token error: ${text}` });
    }

    const result = Object.fromEntries(new URLSearchParams(text));
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/usos/proxy', async (req, res) => {
  try {
    const { endpoint, token, secret, params = {} } = req.body;
    if (!endpoint || !token || !secret) {
      return res.status(400).json({ error: 'Missing endpoint or credentials' });
    }

    const baseUrl = `${USOS_BASE_URL}${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`;

    const oauthParams = {
      ...baseOAuthParams(),
      oauth_token: token
    };

    const allForSig = { ...oauthParams, ...params };
    const sig = signOAuth1('GET', baseUrl, allForSig, USOS_CONSUMER_SECRET, secret);
    const authHeader = getAuthHeader(oauthParams, sig);

    // USOS quirk: query parameters should NOT be percent encoded for commas etc.
    // but the parameters in the signature base string SHOULD be.
    // fetch URL builder will encode them, so we build it manually or use a trick.
    let fullUrl = baseUrl;
    if (Object.keys(params).length > 0) {
      const query = Object.entries(params)
        .map(([k, v]) => `${k}=${v}`) // No encoding here, just like in Android buildUrl()
        .join('&');
      fullUrl += `?${query}`;
    }

    const response = await fetchWithTimeout(fullUrl, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'ZUTnik-PWA-Proxy/1.0'
      }
    });

    const body = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: `USOS API error: ${body}` });
    }

    try {
      return res.json(JSON.parse(body));
    } catch {
      return res.send(body);
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ── Academic calendar (session periods) ─────────────────────────────────────
const CALENDAR_URLS = (() => {
  const year = new Date().getFullYear();
  return [
    'https://www.zut.edu.pl/zut-studenci/organizacja-roku-akademickiego.html',
    `https://www.zut.edu.pl/zut-studenci/organizacja-roku-akademickiego-${year}${year + 1}.html`,
    `https://www.zut.edu.pl/zut-studenci/organizacja-roku-akademickiego-${year - 1}${year}.html`,
    `https://www.zut.edu.pl/zut-studenci/organizacja-roku-akademickiego-${year + 1}${year + 2}.html`,
  ];
})();

const CALENDAR_PERIODS = [
  { key: 'sesja_zimowa', pattern: /sesja\s+zimowa/i },
  { key: 'sesja_letnia', pattern: /sesja\s+letnia/i },
  { key: 'sesja_poprawkowa', pattern: /sesja\s+poprawkowa/i },
  { key: 'przerwa_dydaktyczna_zimowa', pattern: /przerwa\s+od\s+zaj[eęE]\w*\s+dydaktycznych\s+w\s+semestrze\s+zimowym/i },
  { key: 'przerwa_dydaktyczna_letnia', pattern: /przerwa\s+od\s+zaj[eęE]\w*\s+dydaktycznych\s+w\s+semestrze\s+letnim/i },
  { key: 'przerwa_dydaktyczna', pattern: /przerwa\s+od\s+zaj[eęE]\w*\s+dydaktycznych/i },
  { key: 'wakacje_zimowe', pattern: /(wakacje|ferie)\s+zimowe/i },
  { key: 'wakacje_letnie', pattern: /wakacje\s+letnie/i },
];

function stripHtmlTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');
}

function parseCalendarHtml(html) {
  const text = stripHtmlTags(html);
  const dateRe = /(\d{2})\.(\d{2})\.(\d{4})/g;
  const results = [];
  const seen = new Set();

  // Check if specific break found (to avoid adding generic one if specific exists)
  let hasSpecificBreak = false;

  for (const period of CALENDAR_PERIODS) {
    const matches = [];
    let idx = 0;
    let m;
    // Reset lastIndex if using global
    const re = new RegExp(period.pattern.source, 'gi');
    while ((m = re.exec(text)) !== null) {
      // Find next two dates after this match
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 120);
      const dates = [...after.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)];
      if (dates.length >= 2) {
        const start = `${dates[0][3]}-${dates[0][2]}-${dates[0][1]}`;
        const end = `${dates[1][3]}-${dates[1][2]}-${dates[1][1]}`;
        if (start <= end) {
          const dedup = `${period.key}|${start}|${end}`;
          if (!seen.has(dedup)) {
            seen.add(dedup);
            results.push({ key: period.key, start, end });
            if (period.key.startsWith('przerwa_dydaktyczna_') && period.key !== 'przerwa_dydaktyczna') {
              hasSpecificBreak = true;
            }
          }
        }
      }
    }
  }

  // Remove generic break if specific ones found
  const filtered = hasSpecificBreak
    ? results.filter(r => r.key !== 'przerwa_dydaktyczna')
    : results;

  return filtered.sort((a, b) => a.start.localeCompare(b.start));
}

let calendarCache = null;
let calendarCacheTs = 0;
const CALENDAR_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h

app.get('/api/proxy/calendar', async (_req, res) => {
  try {
    const now = Date.now();
    if (calendarCache && (now - calendarCacheTs) < CALENDAR_CACHE_TTL) {
      return res.json({ periods: calendarCache });
    }

    for (const url of CALENDAR_URLS) {
      try {
        const response = await fetchWithTimeout(url, {
          headers: { 'User-Agent': 'ZUTnik-PWA-Proxy/1.0' },
        });
        if (!response.ok) continue;
        const html = await response.text();
        if (!html) continue;
        const periods = parseCalendarHtml(html);
        if (periods.length > 0) {
          calendarCache = periods;
          calendarCacheTs = now;
          return res.json({ periods });
        }
      } catch { /* try next URL */ }
    }

    return res.json({ periods: calendarCache ?? [] });
  } catch (error) {
    return res.status(502).json({ error: `Calendar proxy error: ${error.message}`, periods: [] });
  }
});

app.get('/api/proxy/rss', async (_req, res) => {
  try {
    const response = await fetchWithTimeout(RSS_URL, {
      headers: { 'User-Agent': 'ZUTnik-PWA-Proxy/1.0' },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream RSS HTTP ${response.status}` });
    }

    const xml = await response.text();
    return res.json({ xml });
  } catch (error) {
    return res.status(502).json({ error: `Proxy RSS error: ${error.message}` });
  }
});

app.get([STATS_ROUTE_PATH, `${STATS_ROUTE_PATH}/`], statsAccessLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const authState = getStatsAuthState(req);
  if (authState === 'missing') {
    return sendStatsBasicAuthPrompt(res);
  }
  if (authState === 'invalid') {
    return redirectToAppHome(res);
  }

  return res.type('html').send(renderStatsPage({
    snapshot: statsService.getSnapshot(),
    appHomePath: APP_HOME_PATH,
  }));
});

const distPath = path.resolve(process.cwd(), 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`ZUTnik proxy listening on http://localhost:${port}`);
});
