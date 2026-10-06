import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUsosReadCache } from './read-cache.mjs';

const credentials = { token: 'fixture', secret: 'fixture-secret', params: { fields: 'id' } };
const endpoint = 'services/courses/user';

test('twenty simultaneous reads produce one upstream request; cache and manual floor reuse it', async () => {
  let calls = 0; let time = 1_000_000;
  const cache = createUsosReadCache(async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 5)); return { count: calls }; }, { now: () => time, spacing: 0 });
  const rows = await Promise.all(Array.from({ length: 20 }, () => cache.read(endpoint, credentials)));
  assert.equal(calls, 1); assert.ok(rows.every((row) => row.count === 1));
  rows[0].count = 99;
  assert.equal((await cache.read(endpoint, { ...credentials, force: true })).count, 1);
  assert.equal(cache.snapshot().coalesced, 19);
  time += 5 * 60_000;
  await cache.read(endpoint, { ...credentials, force: true });
  assert.equal(calls, 2);
  await cache.read(endpoint, credentials);
  assert.equal(calls, 2);
});

test('keys separate tokens, secrets and request parameters; parameter order is irrelevant', async () => {
  let calls = 0;
  const cache = createUsosReadCache(async () => ({ count: ++calls }), { spacing: 0 });
  await cache.read(endpoint, { ...credentials, params: { fields: 'id', term: 'Z' } });
  await cache.read(endpoint, { ...credentials, params: { term: 'Z', fields: 'id' } });
  assert.equal(calls, 1);
  await cache.read(endpoint, { ...credentials, secret: 'wrong-secret', params: { fields: 'id', term: 'Z' } });
  await cache.read(endpoint, { ...credentials, token: 'another-user' });
  await cache.read(endpoint, { ...credentials, params: { fields: 'name' } });
  assert.equal(calls, 4);
  assert.ok(!JSON.stringify(cache.snapshot()).includes('fixture-secret'));
});

test('errors back off exponentially without serving a stale authenticated response', async () => {
  let calls = 0; let time = 1_000_000; let fail = false;
  const cache = createUsosReadCache(async () => { calls++; if (fail) throw Object.assign(new Error('Revoked'), { status: 401 }); return { private: 'data' }; }, { now: () => time, spacing: 0 });
  await cache.read(endpoint, credentials);
  time += 5 * 60_000; fail = true;
  await assert.rejects(cache.read(endpoint, { ...credentials, force: true }), { status: 401 });
  for (let i = 0; i < 20; i++) await assert.rejects(cache.read(endpoint, credentials), { status: 401 });
  assert.equal(calls, 2); assert.equal(cache.snapshot().backoffSkips, 20);
  time += 5 * 60_000;
  await assert.rejects(cache.read(endpoint, credentials));
  time += 5 * 60_000;
  await assert.rejects(cache.read(endpoint, credentials));
  assert.equal(calls, 3);
});

test('cache expires and respects entry and byte limits', async () => {
  let time = 1_000_000; let calls = 0;
  const cache = createUsosReadCache(async () => ({ data: 'x'.repeat(60), count: ++calls }), { now: () => time, spacing: 0, maxEntries: 2, maxBytes: 180 });
  await cache.read(endpoint, credentials);
  time += 6 * 3_600_000;
  await cache.read(endpoint, credentials);
  assert.equal(calls, 2);
  for (let i = 0; i < 5; i++) await cache.read(endpoint, { ...credentials, params: { term: i } });
  assert.ok(cache.snapshot().entries <= 2); assert.ok(cache.snapshot().bytes <= 180);
});

test('limits parallel upstream reads to two', async () => {
  let busy = 0; let peak = 0;
  const cache = createUsosReadCache(async () => {
    peak = Math.max(peak, ++busy);
    await new Promise((resolve) => setTimeout(resolve, 5)); busy--; return {};
  }, { spacing: 0 });
  await Promise.all(Array.from({ length: 12 }, (_, i) => cache.read(endpoint, { ...credentials, params: { term: i } })));
  assert.equal(peak, 2); assert.equal(cache.snapshot().pending, 0);
});

test('unknown endpoints are not retained as fresh cache', async () => {
  let calls = 0;
  const cache = createUsosReadCache(async () => ++calls, { spacing: 0 });
  await cache.read('services/unknown/read', credentials); await cache.read('services/unknown/read', credentials);
  assert.equal(calls, 2);
});

test('stats authorization identity expires after five minutes', async () => {
  let calls = 0; let time = 1_000_000;
  const cache = createUsosReadCache(async () => ({ id: ++calls }), { now: () => time, spacing: 0 });
  const options = { ...credentials, params: { fields: 'id|student_number' } };
  await cache.read('services/users/user', options);
  time += 4 * 60_000; await cache.read('services/users/user', options);
  assert.equal(calls, 1);
  time += 60_000; await cache.read('services/users/user', options);
  assert.equal(calls, 2);
});

test('expires queued reads before hitting USOS instead of creating an endless backlog', async () => {
  let calls = 0;
  const cache = createUsosReadCache(async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 30)); return {}; }, { spacing: 0, maxWait: 5 });
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => cache.read(endpoint, { ...credentials, params: { term: i } })));
  assert.equal(calls, 2);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 6);
  assert.equal(cache.snapshot().errors, 0);
  assert.equal(cache.snapshot().pending, 0);
  assert.equal(cache.snapshot().backoffSkips, 6);
});
