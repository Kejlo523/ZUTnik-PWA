import { AsyncLocalStorage } from 'node:async_hooks';

export const FALLBACK_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const browserRequestContext = new AsyncLocalStorage();
const browserProductPattern = /\b(?:Chrome|CriOS|Firefox|FxiOS|Edg|EdgA|EdgiOS|OPR|SamsungBrowser|Version)\/\d/i;

export function normalizeBrowserUserAgent(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 512 || /[\u0000-\u001f\u007f]/.test(raw)) {
    return FALLBACK_BROWSER_USER_AGENT;
  }

  if (!raw.startsWith('Mozilla/5.0') || !browserProductPattern.test(raw)) {
    return FALLBACK_BROWSER_USER_AGENT;
  }

  return raw;
}

export function runWithBrowserUserAgent(value, callback) {
  return browserRequestContext.run(
    { userAgent: normalizeBrowserUserAgent(value) },
    callback,
  );
}

export function createUpstreamHeaders(initialHeaders) {
  const headers = new Headers(initialHeaders);
  const userAgent = browserRequestContext.getStore()?.userAgent || FALLBACK_BROWSER_USER_AGENT;
  headers.set('User-Agent', userAgent);
  return headers;
}
