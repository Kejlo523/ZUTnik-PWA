import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimetableGateway, mapActivities, mapCatalog } from './timetable.mjs';

const credentials = { token: 'fixture', secret: 'fixture' };
const row = { type: 'classgroup', unit_id: '1', group_number: '2', start_time: '2026-10-05 10:15:00', end_time: '2026-10-05 11:45:00', course_name: { pl: 'Statystyka' }, classtype_name: { pl: 'Wykład' }, room_number: '216' };
test('merges duplicate classgroup2, retains distinct exam, enriches matched group only', () => {
  const result = mapActivities([row, { ...row, type: 'classgroup2' }, { ...row, type: 'exam' }], { course_unit_id: '1', group_number: '2', lecturers: [{ first_name: 'Jan', last_name: 'Nowak' }] });
  assert.equal(result.length, 2); assert.equal(result[0].worker, 'Jan Nowak'); assert.equal(result[1].worker, '');
});
test('catalog preserves term dates and class group identifiers', () => {
  assert.equal(mapCatalog({ terms: [{ id: 'Z', start_date: '2026-10-01', finish_date: '2027-02-28' }], groups: { Z: [{ course_unit_id: 1, group_number: 2 }] } })[0].groups[0].group_number, '2');
});
test('deduplicates concurrent requests and limits manual refreshes to five minutes', async () => {
  let calls = 0, now = 1_000_000;
  const gateway = createTimetableGateway(async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 10)); return [row]; }, { spacing: 0, now: () => now });
  const payload = { start: '2026-10-05' };
  await Promise.all([gateway.week(credentials, payload), gateway.week(credentials, payload)]); assert.equal(calls, 1);
  await gateway.week(credentials, { ...payload, force: true }); assert.equal(calls, 1);
  now += 301_000; await gateway.week(credentials, { ...payload, force: true }); assert.equal(calls, 2);
});
test('keeps cache isolated between OAuth owners', async () => {
  let calls = 0;
  const gateway = createTimetableGateway(async () => { calls++; return [row]; }, { spacing: 0 });
  await gateway.week(credentials, { start: '2026-10-05' }); await gateway.week({ ...credentials, token: 'other' }, { start: '2026-10-05' }); assert.equal(calls, 2);
});
test('does not treat a failed first response as cached success or hammer on retry', async () => {
  let calls = 0;
  const gateway = createTimetableGateway(async () => { calls++; throw Object.assign(new Error('offline'), { status: 503 }); }, { spacing: 0 });
  await assert.rejects(gateway.week(credentials, { start: '2026-10-05' }));
  await assert.rejects(gateway.week(credentials, { start: '2026-10-05' })); assert.equal(calls, 1);
});
test('uses term dictionary keys when USOS omits an id in the row', async () => {
  const gateway = createTimetableGateway(async (path, { params }) => {
    if (path.endsWith('/course')) return { terms: ['Z'] };
    if (path.endsWith('/terms')) return { Z: { start_date: '2026-10-01', finish_date: '2027-02-28' } };
    assert.equal(params.term_id, 'Z'); return [row];
  }, { spacing: 0 });
  assert.equal((await gateway.week(credentials, { start: '2026-10-05', category: 'subject', query: 'Statystyka [COURSE]' })).length, 1);
});
test('resolves the room text from an event without fetching individual room pages', async () => {
  const paths = [];
  const gateway = createTimetableGateway(async (path) => {
    paths.push(path);
    return path.endsWith('/building_index') ? [{ id: 'WI', name: { pl: 'WI WI2' } }]
      : { id: 'WI', name: { pl: 'WI WI2' }, rooms: [{ id: 'room-1', number: '216' }, { id: 'room-2', number: '100' }] };
  }, { spacing: 0 });
  assert.deepEqual(await gateway.suggest(credentials, { category: 'room', query: 'WI WI2, 216' }), ['WI WI2, 216 [room-1]']);
  assert.equal(paths.length, 2);
  await gateway.suggest(credentials, { category: 'room', query: 'WI WI2, 216' }); assert.equal(paths.length, 2);
});
