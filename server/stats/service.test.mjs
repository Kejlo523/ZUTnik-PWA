import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createStatsService } from './service.mjs';

test('reports only USOS login sources and does not attribute mixed historical days to USOS', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zutnik-stats-test-'));
  const storePath = path.join(dir, 'stats.json');
  try {
    writeFileSync(storePath, JSON.stringify({ devices: {}, dailyActive: {}, successfulLoginsTotal: 17, successfulLoginsByMethod: { usos: 7, mzut: 8, other: 2 }, successfulLoginsByDay: { '2026-10-05': 17 } }));
    const service = createStatsService({ storePath });
    const snapshot = service.getSnapshot(new Date('2026-10-06T12:00:00'));
    assert.deepEqual(snapshot.loginMethods, [{ key: 'usos', label: 'USOS OAuth', count: 7, share: 100 }]);
    assert.equal(snapshot.kpis.successfulLoginsTotal, 7);
    assert.equal(snapshot.series.find((day) => day.key === '2026-10-05').successfulLogins, 0);
    assert.ok(snapshot.meta.usosTrackingSince);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('keeps historical daily counts when all recorded logins are known to be USOS', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zutnik-stats-test-'));
  try {
    const storePath = path.join(dir, 'stats.json');
    writeFileSync(storePath, JSON.stringify({ successfulLoginsTotal: 7, successfulLoginsByMethod: { usos: 7 }, successfulLoginsByDay: { '2026-10-05': 7 } }));
    const snapshot = createStatsService({ storePath }).getSnapshot(new Date('2026-10-06T12:00:00'));
    assert.equal(snapshot.series.find((day) => day.key === '2026-10-05').successfulLogins, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
