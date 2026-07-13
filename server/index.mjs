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
import { createStatsService } from './stats/service.mjs';
import { createUpstreamHeaders, runWithBrowserUserAgent } from './upstream-browser.mjs';
import {
  REQUIRED_USOS_SCOPES,
  asArray,
  firstNonEmpty,
  mapCourseTests,
  mapCreditSummary,
  mapFinanceRecords,
  mapGrades,
  mapInfoPayload,
  mapNewsItems,
  mapSemesters,
  mapStudentProgramme,
  mapSurveyItems,
  mapUserProfile,
  missingRequiredScopes,
  normalizeScopeList,
} from './usos/mappers.mjs';

const app = express();
const port = Number(process.env.PORT || 8787);

const USOS_CONSUMER_KEY = process.env.USOS_CONSUMER_KEY || '';
const USOS_CONSUMER_SECRET = process.env.USOS_CONSUMER_SECRET || '';
const USOS_BASE_URL = (process.env.USOS_BASE_URL || 'https://usosapi.zut.edu.pl/').replace(/\/+$/, '') + '/';

const PLAN_STUDENT_BASE = 'https://plan.zut.edu.pl/schedule_student.php';
const PLAN_SUGGEST_BASE = 'https://plan.zut.edu.pl/schedule.php';
const RSS_URL = 'https://www.zut.edu.pl/rssfeed-studenci';
const USOS_LOGIN_SCOPES = REQUIRED_USOS_SCOPES.join('|');
const USOS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const USOS_LONG_LIVED_SCOPE = 'offline_access';
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
const STATS_ALLOWED_ALBUM = '57796';
const STATS_ACCESS_COOKIE = 'zutnik_stats_access';
const STATS_ACCESS_TTL_MS = 60 * 60_000;
const STATS_ACCESS_SECRET = process.env.STATS_ACCESS_SECRET || USOS_CONSUMER_SECRET || 'zutnik-local-stats-access';

const statsAccessLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 400 && hasValidStatsAccess(req),
});
const statsService = createStatsService({ storePath: STATS_STORE_PATH, locale: 'pl-PL' });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.set('trust proxy', 1);
app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  runWithBrowserUserAgent(req.headers['user-agent'], next);
});
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/') && req.path !== '/api/health') {
    statsService.recordDeviceActivity(req);
  }
  next();
});

function normalizeAlbumKey(value) {
  const album = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{3,32}$/.test(album) ? album : '';
}

function normalizePlanFilterTypeKey(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd');

  if (!normalized) return '';
  if (normalized === 'lec' || normalized === 'lecture' || normalized.endsWith('-lecture')) return 'lec';
  if (normalized === 'aud' || normalized === 'cw' || normalized === 'auditory' || normalized.endsWith('-auditory')) return 'aud';
  if (normalized === 'lab' || normalized.endsWith('-lab')) return 'lab';
  if (normalized === 'le' || normalized === 'lek' || normalized === 'lk' || normalized === 'lectorate' || normalized.endsWith('-lectorate')) return 'lek';
  return '';
}

function normalizePlanFilterKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const separator = raw.lastIndexOf('||');
  if (separator < 0 || separator >= raw.length - 2) return raw;

  const subject = raw.slice(0, separator).trim();
  const suffix = raw.slice(separator + 2).trim();
  if (!subject || !suffix) return raw;

  const mappedType = normalizePlanFilterTypeKey(suffix);
  return `${subject}||${mappedType || suffix}`;
}

function normalizePlanHiddenSubjectKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item) => typeof item === 'string')
      .map((item) => normalizePlanFilterKey(item))
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

function normalizeStatsAlbum(value) {
  const match = String(value || '').trim().match(/^s?(\d{4,6})$/i);
  return match?.[1] || '';
}

function getCookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.trim().split('=');
    if (rawKey !== name) continue;
    try {
      return decodeURIComponent(rawValue.join('='));
    } catch {
      return rawValue.join('=');
    }
  }
  return '';
}

function signStatsAccessPayload(payload) {
  return crypto
    .createHmac('sha256', STATS_ACCESS_SECRET)
    .update(payload)
    .digest('base64url');
}

function createStatsAccessToken(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${signStatsAccessPayload(encodedPayload)}`;
}

function verifyStatsAccessToken(token) {
  const [encodedPayload, signature] = String(token || '').split('.');
  if (!encodedPayload || !signature) return null;
  if (!safeTextEqual(signature, signStatsAccessPayload(encodedPayload))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (normalizeStatsAlbum(payload.album) !== STATS_ALLOWED_ALBUM) return null;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function hasValidStatsAccess(req) {
  return Boolean(verifyStatsAccessToken(getCookieValue(req, STATS_ACCESS_COOKIE)));
}

function isSecureRequest(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function setStatsAccessCookie(req, res, value, maxAge = STATS_ACCESS_TTL_MS) {
  res.cookie(STATS_ACCESS_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: STATS_ROUTE_PATH,
    maxAge,
  });
}

function clearStatsAccessCookie(req, res) {
  setStatsAccessCookie(req, res, '', 0);
}

function redirectToAppHome(res) {
  return res.redirect(APP_HOME_PATH);
}

function setPrivateNoStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      ...options,
      headers: createUpstreamHeaders(options.headers),
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

app.get('/api/proxy/plan-student', async (req, res) => {
  try {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (!/^[a-zA-Z0-9_]+$/.test(key)) continue;
      query.set(key, String(value ?? ''));
    }

    const url = `${PLAN_STUDENT_BASE}?${query.toString()}`;
    const response = await fetchWithTimeout(url);

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
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      return res.json({ data: [] });
    }

    const data = await passthroughJson(response);
    return res.json({ data: Array.isArray(data) ? data : [] });
  } catch {
    return res.json({ data: [] });
  }
});

// ── USOS API Endpoints ──────────────────────────────────────────────────────

function assertUsosConfigured() {
  if (!USOS_CONSUMER_KEY || !USOS_CONSUMER_SECRET) {
    const error = new Error('Brak konfiguracji USOS_CONSUMER_KEY/USOS_CONSUMER_SECRET.');
    error.status = 500;
    throw error;
  }
}

function getUsosCredentials(req) {
  const token = firstNonEmpty(req.body?.token);
  const secret = firstNonEmpty(req.body?.secret);
  if (!token || !secret) {
    const error = new Error('Missing USOS credentials');
    error.status = 400;
    throw error;
  }
  return { token, secret };
}

function cleanQueryParams(params = {}) {
  const cleanParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      cleanParams[key] = value.map((item) => String(item ?? '')).join('|');
    } else {
      cleanParams[key] = String(value);
    }
  }
  return cleanParams;
}

function encodeUsosQueryValue(value) {
  return encodeURIComponent(String(value))
    .replace(/%7C/gi, '|')
    .replace(/%5B/gi, '[')
    .replace(/%5D/gi, ']')
    .replace(/%2C/gi, ',')
    .replace(/%3E/gi, '>');
}

function buildUsosQuery(params = {}) {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeUsosQueryValue(value)}`)
    .join('&');
}

function cleanErrorText(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function getFriendlyUsosErrorMessage(status, value = '') {
  const rawNormalized = String(value).toLowerCase();
  const cleaned = cleanErrorText(value);
  const normalized = cleaned.toLowerCase();

  if (
    status === 502
    || status === 503
    || status === 504
    || normalized.includes('bad gateway')
    || normalized.includes('service unavailable')
    || normalized.includes('temporarily overloading')
    || normalized.includes('server is temporarily')
  ) {
    return 'USOS jest teraz chwilowo niedostępny. Spróbuj ponownie za chwilę.';
  }
  if (rawNormalized.includes('doctype html') || rawNormalized.includes('<!doctype') || rawNormalized.includes('<html')) {
    return 'USOS zwrócił nieczytelną odpowiedź. Spróbuj ponownie za chwilę.';
  }
  if (cleaned.length > 220) {
    return `${cleaned.slice(0, 217).trim()}...`;
  }

  return cleaned || 'USOS API error';
}

function sendUsosError(res, error) {
  const status = Number(error?.status) || 500;
  return res.status(status).json({ error: getFriendlyUsosErrorMessage(status, error?.message || 'USOS API error') });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isUsosGatewayError(error) {
  const status = Number(error?.status) || 0;
  const message = String(error?.message || '').toLowerCase();
  return [500, 502, 503, 504].includes(status)
    || message.includes('bad gateway')
    || message.includes('service unavailable')
    || message.includes('temporarily overloading')
    || message.includes('server is temporarily');
}

async function fetchUsosJson(endpoint, {
  token = '',
  secret = '',
  tokenMode = 'required',
  params = {},
} = {}) {
  assertUsosConfigured();

  if (tokenMode === 'required' && (!token || !secret)) {
    const error = new Error('Missing USOS credentials');
    error.status = 400;
    throw error;
  }

  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const baseUrl = `${USOS_BASE_URL}${normalizedEndpoint}`;
  const oauthParams = {
    ...baseOAuthParams(),
  };

  const shouldUseToken = tokenMode !== 'none' && token;
  if (shouldUseToken) {
    oauthParams.oauth_token = token;
  }

  const cleanParams = cleanQueryParams(params);
  const sig = signOAuth1('GET', baseUrl, { ...oauthParams, ...cleanParams }, USOS_CONSUMER_SECRET, shouldUseToken ? secret : '');
  const authHeader = getAuthHeader(oauthParams, sig);
  const query = buildUsosQuery(cleanParams);
  const fullUrl = query ? `${baseUrl}?${query}` : baseUrl;

  const response = await fetchWithTimeout(fullUrl, {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    const error = new Error(getFriendlyUsosErrorMessage(response.status, body || response.statusText));
    error.status = response.status;
    throw error;
  }

  if (!body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error(getFriendlyUsosErrorMessage(502, body || 'Niepoprawny JSON z USOS API.'));
    error.status = 502;
    throw error;
  }
}

async function fetchUsosTokenScopes(token, secret) {
  const response = await fetchUsosJson('services/apisrv/consumer', {
    token,
    secret,
    tokenMode: 'required',
    params: { fields: 'token_scopes' },
  });
  return normalizeScopeList(response?.token_scopes);
}

const USER_FIELDS = 'id|first_name|last_name|student_number|student_status';
const USER_FIELDS_WITH_PHOTO = `${USER_FIELDS}|photo_urls`;
const PROGRAMME_FIELDS = [
  'id',
  'programme[id|name|description|faculty[id|name]|mode_of_studies|level_of_studies|level]',
  'status',
  'admission_date',
  'is_primary',
  'stages[id|name]',
].join('|');
const PROGRAMME_FALLBACK_FIELDS = 'id|programme[id|name|description|mode_of_studies|level_of_studies|level]|status|admission_date|is_primary|stages[id|name]';
const PROGRAMME_MIN_FIELDS = 'id|programme|status|admission_date|is_primary|stages';
const GRADE_FIELDS = 'value_symbol|passes|value_description|exam_id|exam_session_number|date_modified|date_acquisition|counts_into_average|grade_type_id';
const COURSE_FIELDS = 'course_editions[course_id|course_name|term_id]|terms';
const COURSE_WITH_GRADES_FIELDS = `course_editions[course_id|course_name|term_id|grades[${GRADE_FIELDS}]]|terms`;
const GRADE_WITH_CONTEXT_FIELDS = `${GRADE_FIELDS}|course_edition[course_id|term_id|course[id|name|ects_credits_simplified]|ects_credits_simplified]|course[id|name|ects_credits_simplified]`;
const PAYMENT_FIELDS = 'id|name|title|amount|due_date|status|is_paid|saldo_amount|description|state|account_number|payment_deadline|total_amount|currency|debt_type|type|paid_date';
const CALENDAR_FIELDS = 'id|name|start_date|end_date|type|is_day_off';
const NEWS_FIELDS = 'items[article[id|publication_date|title|headline_html|content_html|image_urls[720x405|360x203|original]]]|next_page|total';
const SURVEY_FIELDS = 'id|survey_type|name|headline_html|start_date|end_date|can_i_fill_out|did_i_fill_out|group[course_unit[course_id|course_name|course[id|name]]]|lecturer[id|first_name|last_name]|faculty[id|name]|programme[id|name]';
const CRSTEST_PARTICIPANT_FIELDS = 'course_edition[course_id|course_name|term_id|course[id|name]]|root[node_id|name|type]';
const CRSTEST_NODE_FIELDS = 'node_id|root_id|parent_id|order|name|visible_for_students|type|points_min|points_max|points_precision|grade_type|subnodes';
const CRSTEST_NODE_FALLBACK_FIELDS = 'node_id|root_id|parent_id|order|name|visible_for_students|type|subnodes';

function hasGradeValue(entry) {
  const rawValue = firstNonEmpty(
    entry?.value_symbol,
    entry?.value,
    entry?.value_description?.pl,
    entry?.value_description?.en,
    entry?.value_description,
    entry?.symbol,
    entry?.grade?.value_symbol,
    entry?.grade?.value,
    entry?.grade?.value_description?.pl,
    entry?.grade?.value_description?.en,
    entry?.grade?.value_description,
    entry?.grade?.symbol,
  );
  return Boolean(rawValue.trim());
}

function isGradeEntryLike(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return hasGradeValue(entry)
    || 'passes' in entry
    || 'exam_id' in entry
    || 'exam_session_number' in entry
    || 'date_acquisition' in entry
    || 'date_modified' in entry
    || 'grade_type_id' in entry
    || ('grade' in entry && typeof entry.grade === 'object');
}

function flattenGradeEntries(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenGradeEntries(entry));
  }
  if (!value || typeof value !== 'object') return [];
  if (isGradeEntryLike(value)) return [value];
  return Object.values(value).flatMap((entry) => flattenGradeEntries(entry));
}

async function fetchStudentProgrammesRaw(token, secret) {
  const baseParams = {
    active_only: 'false',
    old_programs: 'false',
  };

  for (const fields of [PROGRAMME_FIELDS, PROGRAMME_FALLBACK_FIELDS, PROGRAMME_MIN_FIELDS]) {
    try {
      const programmes = await fetchUsosJson('services/progs/student', {
        token,
        secret,
        tokenMode: 'required',
        params: {
          ...baseParams,
          fields,
        },
      });
      return asArray(programmes);
    } catch {
      // Try a simpler selector. Some USOS installations reject subfields here.
    }
  }

  return [];
}

async function fetchUsosUserAndProgrammes(token, secret, scopes = []) {
  const [user, programmesRaw] = await Promise.all([
    fetchUsosJson('services/users/user', {
      token,
      secret,
      tokenMode: 'required',
      params: { fields: USER_FIELDS },
    }),
    fetchStudentProgrammesRaw(token, secret),
  ]);

  return mapUserProfile(user, asArray(programmesRaw), scopes);
}

function getCourseIdsForTerm(coursesResponse, termId) {
  const editions = coursesResponse?.course_editions?.[termId] ?? [];
  return [...new Set(asArray(editions)
    .map((edition) => firstNonEmpty(edition?.course?.id, edition?.course_id, edition?.id))
    .filter(Boolean))];
}

function getCourseIdsForTerms(coursesResponse, termIds) {
  return [...new Set(termIds.flatMap((termId) => getCourseIdsForTerm(coursesResponse, termId)))];
}

function getTermIdsForCourses(coursesResponse) {
  const ids = new Set();
  for (const term of asArray(coursesResponse?.terms)) {
    const id = firstNonEmpty(term?.id);
    if (id) ids.add(id);
  }
  const editions = coursesResponse?.course_editions && typeof coursesResponse.course_editions === 'object'
    ? coursesResponse.course_editions
    : {};
  for (const id of Object.keys(editions)) {
    if (id) ids.add(id);
  }
  return [...ids].sort((left, right) => left.localeCompare(right, 'pl'));
}

function latestGradeTermId(entry) {
  const edition = entry?.course_edition && typeof entry.course_edition === 'object' ? entry.course_edition : {};
  return firstNonEmpty(edition?.term_id, entry?.term_id);
}

function countGradesForTerm(gradesResponse, termId) {
  const termGrades = gradesResponse?.[termId] && typeof gradesResponse[termId] === 'object' ? gradesResponse[termId] : {};
  let count = 0;

  for (const courseGradeData of Object.values(termGrades)) {
    if (!courseGradeData || typeof courseGradeData !== 'object') continue;
    count += flattenGradeEntries(courseGradeData.course_grades).filter(hasGradeValue).length;
    const unitGrades = courseGradeData.course_units_grades && typeof courseGradeData.course_units_grades === 'object'
      ? courseGradeData.course_units_grades
      : {};
    for (const entries of Object.values(unitGrades)) {
      count += flattenGradeEntries(entries).filter(hasGradeValue).length;
    }
  }

  return count;
}

function countGradesForTerms(gradesResponse, termIds) {
  return termIds.reduce((total, termId) => total + countGradesForTerm(gradesResponse, termId), 0);
}

async function fetchGradesTerms2(token, secret, termIds, courseIds) {
  const termIdsParam = Array.isArray(termIds) ? termIds.join('|') : firstNonEmpty(termIds);
  const courseIdsParam = Array.isArray(courseIds) ? courseIds.join('|') : firstNonEmpty(courseIds);
  return fetchUsosJson('services/grades/terms2', {
    token,
    secret,
    tokenMode: 'required',
    params: {
      term_ids: termIdsParam,
      ...(courseIdsParam ? { course_ids: courseIdsParam } : {}),
      fields: GRADE_FIELDS,
    },
  });
}

async function tryFetchGradesTerms2(token, secret, termIds, courseIds) {
  const fetchWithGatewayRetries = async (scopedCourseIds) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await fetchGradesTerms2(token, secret, termIds, scopedCourseIds);
      } catch (error) {
        if (!isUsosGatewayError(error)) throw error;
        if (attempt === 0) await sleep(750);
      }
    }
    return null;
  };

  const scoped = await fetchWithGatewayRetries(courseIds);
  if (scoped) return scoped;

  if (Array.isArray(courseIds) && courseIds.length > 0) {
    const unscoped = await fetchWithGatewayRetries([]);
    if (unscoped) return unscoped;
  }

  return {};
}

async function fetchCourseEditionGradesByCourse(token, secret, termId, courseIds) {
  const pairs = await Promise.all(courseIds.map(async (courseId) => {
    try {
      const data = await fetchUsosJson('services/grades/course_edition2', {
        token,
        secret,
        tokenMode: 'required',
        params: {
          course_id: courseId,
          term_id: termId,
          fields: GRADE_FIELDS,
        },
      });
      return [courseId, data];
    } catch {
      return [courseId, null];
    }
  }));

  return {
    [termId]: Object.fromEntries(pairs.filter(([, data]) => data)),
  };
}

async function fetchGradesCoursesResponse(token, secret, activeTermsOnly) {
  const fieldSelectors = [COURSE_WITH_GRADES_FIELDS, COURSE_FIELDS];
  let gatewayError = null;

  for (let index = 0; index < fieldSelectors.length; index += 1) {
    try {
      return await fetchUsosJson('services/courses/user', {
        token,
        secret,
        tokenMode: 'required',
        params: {
          fields: fieldSelectors[index],
          active_terms_only: activeTermsOnly,
        },
      });
    } catch (error) {
      if (isUsosGatewayError(error)) {
        gatewayError = error;
        continue;
      }
      if (index === 0) continue;
      throw error;
    }
  }

  if (gatewayError) return null;
  return null;
}

function mergeGradesResponse(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const [termId, termData] of Object.entries(source)) {
    if (!termId || !termData || typeof termData !== 'object') continue;
    target[termId] = {
      ...(target[termId] && typeof target[termId] === 'object' ? target[termId] : {}),
      ...termData,
    };
  }
  return target;
}

async function resolveGradesForTerms(token, secret, termIds, coursesResponse) {
  const courseIds = getCourseIdsForTerms(coursesResponse, termIds);
  const gradesResponse = await tryFetchGradesTerms2(token, secret, termIds.join('|'), courseIds);
  if (countGradesForTerms(gradesResponse, termIds) > 0) {
    return gradesResponse;
  }

  const merged = {};
  await Promise.all(termIds.map(async (termId) => {
    const termCourseIds = getCourseIdsForTerm(coursesResponse, termId);
    if (!termCourseIds.length) return;
    const data = await fetchCourseEditionGradesByCourse(token, secret, termId, termCourseIds);
    mergeGradesResponse(merged, data);
  }));

  if (countGradesForTerms(merged, termIds) > 0) {
    return merged;
  }

  return Object.keys(gradesResponse || {}).length ? gradesResponse : merged;
}

function hasUsosScope(scopes, scope) {
  return normalizeScopeList(scopes).includes(scope);
}

async function fetchParticipantCourseTests(token, secret) {
  for (const fields of [CRSTEST_PARTICIPANT_FIELDS, 'course_edition|is_limited_to_groups|class_groups|root']) {
    try {
      return await fetchUsosJson('services/crstests/participant2', {
        token,
        secret,
        tokenMode: 'required',
        params: {
          active_terms_only: 'false',
          fields,
        },
      });
    } catch {
      // ZUT may reject nested selectors in this module; fall back to the default shape.
    }
  }
  return [];
}

function rootNodeId(test) {
  const root = test?.root && typeof test.root === 'object' ? test.root : {};
  return firstNonEmpty(root?.node_id, root?.id);
}

function collectCourseTestNodeIds(tree) {
  const taskNodeIds = [];
  const gradeNodeIds = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const id = firstNonEmpty(node.node_id, node.id);
    const type = firstNonEmpty(node.type).toLowerCase();
    if (id && type === 'task') taskNodeIds.push(id);
    if (id && type === 'grade') gradeNodeIds.push(id);
    for (const child of asArray(node.subnodes)) visit(child);
  };
  visit(tree);
  return { taskNodeIds, gradeNodeIds };
}

async function fetchCourseTestNodeTree(token, secret, rootId) {
  for (const fields of [CRSTEST_NODE_FIELDS, CRSTEST_NODE_FALLBACK_FIELDS]) {
    try {
      return await fetchUsosJson('services/crstests/node2', {
        token,
        secret,
        tokenMode: 'required',
        params: {
          node_id: rootId,
          recursive: 'true',
          fields,
        },
      });
    } catch {
      // Retry with a smaller selector.
    }
  }
  return null;
}

async function fetchCourseTestResultsForRoot(token, secret, rootId, tree) {
  const { taskNodeIds, gradeNodeIds } = collectCourseTestNodeIds(tree);
  const [points, grades] = await Promise.all([
    taskNodeIds.length
      ? fetchUsosJson('services/crstests/user_points', {
          token,
          secret,
          tokenMode: 'required',
          params: { node_ids: taskNodeIds.join('|') },
        }).catch(() => [])
      : [],
    gradeNodeIds.length
      ? fetchUsosJson('services/crstests/user_grades', {
          token,
          secret,
          tokenMode: 'required',
          params: { node_ids: gradeNodeIds.join('|') },
        }).catch(() => [])
      : [],
  ]);

  return [rootId, { points, grades }];
}

async function fetchCourseTestsPayload(token, secret, termId) {
  const tests = asArray(await fetchParticipantCourseTests(token, secret));
  const rootIds = [...new Set(tests.map(rootNodeId).filter(Boolean))];
  const treePairs = await Promise.all(rootIds.map(async (rootId) => {
    const tree = await fetchCourseTestNodeTree(token, secret, rootId);
    return [rootId, tree];
  }));
  const nodeTreesByRootId = Object.fromEntries(treePairs.filter(([, tree]) => tree));

  const resultPairs = await Promise.all(Object.entries(nodeTreesByRootId).map(([rootId, tree]) => (
    fetchCourseTestResultsForRoot(token, secret, rootId, tree)
  )));

  const pointsByRootId = {};
  const gradesByRootId = {};
  for (const [rootId, result] of resultPairs) {
    pointsByRootId[rootId] = result.points;
    gradesByRootId[rootId] = result.grades;
  }

  return mapCourseTests({ tests, nodeTreesByRootId, pointsByRootId, gradesByRootId, termId });
}

function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function pickSelectedProgramme(programmes, studyId) {
  const normalizedId = firstNonEmpty(studyId);
  const mapped = asArray(programmes);
  return mapped.find((programme) => programme.studentProgrammeId === normalizedId)
    || mapped.find((programme) => programme.programmeId === normalizedId)
    || mapped[0]
    || null;
}

function pickPhotoUrl(photoUrls) {
  const urls = photoUrls && typeof photoUrls === 'object' ? photoUrls : {};
  return firstNonEmpty(urls['200x200'], urls['100x100'], urls['50x50'], urls.original);
}

function normalizeUsosAssetUrl(rawUrl) {
  const raw = firstNonEmpty(rawUrl);
  if (!raw) return '';

  try {
    const url = new URL(raw, USOS_BASE_URL);
    const host = url.hostname.toLowerCase();
    if (host === 'zut.edu.pl' || host.endsWith('.zut.edu.pl')) {
      return url.href;
    }
  } catch {
    return '';
  }
  return '';
}

app.get('/api/usos/request-token', async (req, res) => {
  try {
    assertUsosConfigured();
    const requestedScopes = normalizeScopeList(req.query.scopes);
    const unknownScopes = requestedScopes.filter((scope) => !REQUIRED_USOS_SCOPES.includes(scope));
    const scopes = unknownScopes.length || missingRequiredScopes(requestedScopes).length
      ? USOS_LOGIN_SCOPES
      : requestedScopes.join('|') || USOS_LOGIN_SCOPES;
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
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: getFriendlyUsosErrorMessage(response.status, text) });
    }

    const result = Object.fromEntries(new URLSearchParams(text));
    return res.json(result);
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/usos/access-token', async (req, res) => {
  try {
    assertUsosConfigured();
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
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: getFriendlyUsosErrorMessage(response.status, text) });
    }

    const result = Object.fromEntries(new URLSearchParams(text));
    const scopes = await fetchUsosTokenScopes(result.oauth_token, result.oauth_token_secret);
    const missingScopes = missingRequiredScopes(scopes);
    if (missingScopes.length > 0) {
      return res.status(403).json({
        error: `Brakuje wymaganych uprawnień USOS: ${missingScopes.join(', ')}.`,
        scopes,
        missingScopes,
      });
    }

    const authorizedAt = Date.now();
    const hasLongLivedAccess = normalizeScopeList(scopes).includes(USOS_LONG_LIVED_SCOPE);
    statsService.recordSuccessfulLogin(req, 'usos');
    return res.json({
      ...result,
      scopes,
      authorizedAt,
      ...(hasLongLivedAccess ? {} : { expiresAt: authorizedAt + USOS_TOKEN_TTL_MS }),
    });
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/usos/me', async (req, res) => {
  try {
    const { token, secret } = getUsosCredentials(req);
    const scopes = await fetchUsosTokenScopes(token, secret);
    const profile = await fetchUsosUserAndProgrammes(token, secret, scopes);
    return res.json(profile);
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/stats/access', async (req, res) => {
  setPrivateNoStore(res);
  try {
    const { token, secret } = getUsosCredentials(req);
    const user = await fetchUsosJson('services/users/user', {
      token,
      secret,
      tokenMode: 'required',
      params: { fields: 'id|student_number' },
    });

    const album = normalizeStatsAlbum(firstNonEmpty(user?.student_number, user?.id));
    if (album !== STATS_ALLOWED_ALBUM) {
      return res.status(403).json({ error: 'Brak dostępu do statystyk.' });
    }

    const now = Date.now();
    const accessToken = createStatsAccessToken({
      album,
      iat: now,
      exp: now + STATS_ACCESS_TTL_MS,
    });

    setStatsAccessCookie(req, res, accessToken);
    return res.json({ ok: true, url: STATS_ROUTE_PATH });
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/stats/snapshot', async (req, res) => {
  try {
    const { token, secret } = getUsosCredentials(req);
    const user = await fetchUsosJson('services/users/user', {
      token,
      secret,
      tokenMode: 'required',
      params: { fields: 'id|student_number' },
    });

    const album = normalizeStatsAlbum(firstNonEmpty(user?.student_number, user?.id));
    if (album !== STATS_ALLOWED_ALBUM) {
      return res.status(403).json({ error: 'Brak dostępu do statystyk.' });
    }

    setPrivateNoStore(res);
    return res.json({ ok: true, snapshot: statsService.getSnapshot() });
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/usos/semesters', async (req, res) => {
  try {
    const { token, secret } = getUsosCredentials(req);
    const coursesResponse = await fetchUsosJson('services/courses/user', {
      token,
      secret,
      tokenMode: 'required',
      params: {
        fields: COURSE_FIELDS,
        active_terms_only: 'false',
      },
    });
    return res.json({ semesters: mapSemesters(coursesResponse) });
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/usos/grades', async (req, res) => {
  try {
    const { token, secret } = getUsosCredentials(req);
    const termId = firstNonEmpty(req.body?.termId);
    const activeTermsOnly = termId ? 'false' : 'true';

    const coursesResponse = await fetchGradesCoursesResponse(token, secret, activeTermsOnly);
    if (!coursesResponse) {
      return res.json({
        grades: [],
        temporaryUnavailable: true,
        error: 'USOS jest teraz chwilowo niedostępny. Spróbuj ponownie za chwilę.',
      });
    }

    const termIds = termId ? [termId] : getTermIdsForCourses(coursesResponse);
    if (!termIds.length) {
      return res.json({ grades: [] });
    }
    const [ectsResponse, gradesTermsResponse] = await Promise.all([
      fetchUsosJson('services/courses/user_ects_points', {
        token,
        secret,
        tokenMode: 'required',
      }).catch(() => ({})),
      resolveGradesForTerms(token, secret, termIds, coursesResponse),
    ]);
    const latestGrades = termId || countGradesForTerms(gradesTermsResponse, termIds) > 0
      ? []
      : await fetchUsosJson('services/grades/latest', {
          token,
          secret,
          tokenMode: 'required',
          params: {
            days: '4000',
            fields: GRADE_WITH_CONTEXT_FIELDS,
          },
        }).then((items) => asArray(items).filter((entry) => termIds.includes(latestGradeTermId(entry)))).catch(() => []);
    const grades = mapGrades({ termId, termIds, coursesResponse, ectsResponse, gradesResponse: gradesTermsResponse, latestGrades });

    return res.json({
      grades,
    });
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/usos/credits', async (req, res) => {
  try {
    const { token, secret } = getUsosCredentials(req);
    const studentProgrammeId = firstNonEmpty(req.body?.studyId);
    const [programmeUsed, overallUsed] = await Promise.all([
      studentProgrammeId && studentProgrammeId !== 'usos-profile'
        ? fetchUsosJson('services/credits/used_sum', {
            token,
            secret,
            tokenMode: 'required',
            params: { students_programme_id: studentProgrammeId },
          }).catch(() => null)
        : null,
      fetchUsosJson('services/credits/used_sum', {
        token,
        secret,
        tokenMode: 'required',
      }).catch(() => null),
    ]);

    return res.json({
      summary: mapCreditSummary({ studentProgrammeId, programmeUsed, overallUsed }),
    });
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/usos/course-tests', async (req, res) => {
  try {
    const scopes = normalizeScopeList(req.body?.scopes);
    if (!hasUsosScope(scopes, 'crstests')) {
      return res.json({ tests: [], missingScopes: ['crstests'] });
    }

    const { token, secret } = getUsosCredentials(req);
    const termId = firstNonEmpty(req.body?.termId);
    const tests = await fetchCourseTestsPayload(token, secret, termId);
    return res.json({ tests, missingScopes: [] });
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/usos/finance', async (req, res) => {
  try {
    const { token, secret } = getUsosCredentials(req);
    const payments = await fetchUsosJson('services/payments/user_payments', {
      token,
      secret,
      tokenMode: 'required',
      params: { fields: PAYMENT_FIELDS },
    });
    return res.json({ records: mapFinanceRecords(payments) });
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/usos/info', async (req, res) => {
  try {
    const { token, secret } = getUsosCredentials(req);
    const scopes = normalizeScopeList(req.body?.scopes);
    const profile = await fetchUsosUserAndProgrammes(token, secret, scopes);
    const selectedProgramme = pickSelectedProgramme(profile.programmes, req.body?.studyId);

    let detailedProgramme = selectedProgramme;
    if (selectedProgramme?.studentProgrammeId) {
      const rawProgramme = await fetchUsosJson('services/progs/student_programme', {
        token,
        secret,
        tokenMode: 'required',
        params: {
          student_programme_id: selectedProgramme.studentProgrammeId,
          fields: PROGRAMME_FIELDS,
        },
      }).catch(() => null);
      if (rawProgramme) {
        detailedProgramme = mapStudentProgramme(rawProgramme);
      }
    }

    const [cards, activeCourses] = await Promise.all([
      fetchUsosJson('services/cards/user', {
        token,
        secret,
        tokenMode: 'required',
      }).catch(() => []),
      fetchUsosJson('services/courses/user', {
        token,
        secret,
        tokenMode: 'required',
        params: {
          fields: 'terms',
          active_terms_only: 'true',
        },
      }).catch(() => null),
    ]);

    const facultyId = firstNonEmpty(detailedProgramme?.facultyId);
    const activeTerm = asArray(activeCourses?.terms)[0] ?? null;
    const calendarEvents = facultyId
      ? await fetchUsosJson('services/calendar/search', {
          token,
          secret,
          tokenMode: 'optional',
          params: {
            faculty_id: facultyId,
            start_date: addDaysIso(0),
            end_date: addDaysIso(30),
            fields: CALENDAR_FIELDS,
          },
        }).catch(() => [])
      : [];

    return res.json(mapInfoPayload({
      user: profile.user,
      selectedProgramme: detailedProgramme,
      programmes: profile.programmes,
      cards,
      calendarEvents,
      activeTerm,
    }));
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/usos/surveys', async (req, res) => {
  try {
    const scopes = normalizeScopeList(req.body?.scopes);
    if (!hasUsosScope(scopes, 'surveys_filling')) {
      return res.json({ items: [], missingScopes: ['surveys_filling'] });
    }

    const { token, secret } = getUsosCredentials(req);
    let surveys = [];
    try {
      surveys = await fetchUsosJson('services/surveys/surveys_to_fill2', {
        token,
        secret,
        tokenMode: 'required',
        params: {
          include_filled_out: 'false',
          fields: SURVEY_FIELDS,
        },
      });
    } catch {
      surveys = await fetchUsosJson('services/surveys/surveys_to_fill2', {
        token,
        secret,
        tokenMode: 'required',
        params: {
          include_filled_out: 'false',
        },
      });
    }

    return res.json({ items: mapSurveyItems(surveys), missingScopes: [] });
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.post('/api/usos/photo', async (req, res) => {
  try {
    const { token, secret } = getUsosCredentials(req);
    const user = await fetchUsosJson('services/users/user', {
      token,
      secret,
      tokenMode: 'required',
      params: { fields: USER_FIELDS_WITH_PHOTO },
    });

    const photoUrl = normalizeUsosAssetUrl(pickPhotoUrl(user?.photo_urls));
    if (!photoUrl) {
      return res.status(404).json({ error: 'Brak zdjęcia w USOS.' });
    }

    const response = await fetchWithTimeout(photoUrl);
    if (!response.ok) {
      return res.status(response.status).end();
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return res.status(404).end();
    }

    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', response.headers.get('cache-control') || 'private, max-age=300');
    return res.send(buffer);
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.get('/api/usos/news', async (_req, res) => {
  try {
    const newsResponse = await fetchUsosJson('services/news/search', {
      tokenMode: 'none',
      params: {
        num: '30',
        fields: NEWS_FIELDS,
      },
    });
    return res.json({ items: mapNewsItems(newsResponse) });
  } catch (error) {
    return sendUsosError(res, error);
  }
});

app.get('/api/proxy/rss', async (_req, res) => {
  try {
    const response = await fetchWithTimeout(RSS_URL);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream RSS HTTP ${response.status}` });
    }

    const xml = await response.text();
    return res.json({ xml });
  } catch (error) {
    return res.status(502).json({ error: `Proxy RSS error: ${error.message}` });
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
        const response = await fetchWithTimeout(url);
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

app.get([STATS_ROUTE_PATH, `${STATS_ROUTE_PATH}/`], statsAccessLimiter, (req, res) => {
  setPrivateNoStore(res);
  if (!hasValidStatsAccess(req)) {
    clearStatsAccessCookie(req, res);
    return redirectToAppHome(res);
  }

  return res.redirect(`${APP_HOME_PATH}?screen=stats`);
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
