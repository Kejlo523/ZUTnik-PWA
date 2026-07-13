import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FALLBACK_BROWSER_USER_AGENT,
  createUpstreamHeaders,
  normalizeBrowserUserAgent,
  runWithBrowserUserAgent,
} from './upstream-browser.mjs';

const chromeUserAgent =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';
const safariUserAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1';

test('preserves genuine browser user agents', () => {
  assert.equal(normalizeBrowserUserAgent(chromeUserAgent), chromeUserAgent);
  assert.equal(normalizeBrowserUserAgent(safariUserAgent), safariUserAgent);
});

test('uses a browser fallback for non-browser clients and invalid headers', () => {
  assert.equal(normalizeBrowserUserAgent('ZUTnik-PWA-Proxy/1.0'), FALLBACK_BROWSER_USER_AGENT);
  assert.equal(normalizeBrowserUserAgent('curl/8.10.0'), FALLBACK_BROWSER_USER_AGENT);
  assert.equal(
    normalizeBrowserUserAgent(`${chromeUserAgent}\r\nX-Injected: yes`),
    FALLBACK_BROWSER_USER_AGENT,
  );
});

test('applies the request browser user agent to upstream headers', () => {
  runWithBrowserUserAgent(chromeUserAgent, () => {
    const headers = createUpstreamHeaders({ Authorization: 'OAuth test' });
    assert.equal(headers.get('User-Agent'), chromeUserAgent);
    assert.equal(headers.get('Authorization'), 'OAuth test');
  });
});

test('uses the fallback outside a browser request context', () => {
  assert.equal(createUpstreamHeaders().get('User-Agent'), FALLBACK_BROWSER_USER_AGENT);
});
