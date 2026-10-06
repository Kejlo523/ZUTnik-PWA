import crypto from 'node:crypto';

export const ACTIVITY_FIELDS = 'type|start_time|end_time|name|course_id|course_name|classtype_id|classtype_name|group_number|unit_id|building_name|room_number|frequency';
const GROUP_FIELDS = 'course_unit_id|group_number|class_type|class_type_id|course_name|lecturers|term_id';
const HOUR = 3_600_000;
const localized = (value) => typeof value === 'string' ? value : value?.pl || value?.en || '';
const termRows = (value) => Object.entries(value || {}).map(([id, row]) => ({ ...row, id: row?.id || id }));
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const identifier = (value) => {
  const text = String(value ?? '').trim();
  if (!text || text.length > 160 || /[\s\[\]|]/.test(text)) throw failure('Nieprawidłowy identyfikator planu.');
  return text;
};

export function mapActivities(rows, group = null) {
  if (!Array.isArray(rows)) throw failure('Nieprawidłowa odpowiedź planu USOS.', 502);
  const result = new Map();
  for (const row of rows) {
    if (!row || !row.start_time || !row.end_time) continue;
    if (row.type === 'classgroup' && ['other', 'once'].includes(row.frequency)) continue;
    const start = String(row.start_time).replace(' ', 'T');
    const end = String(row.end_time).replace(' ', 'T');
    if (!Number.isFinite(Date.parse(start)) || Date.parse(end) <= Date.parse(start)) continue;
    const classgroup = ['classgroup', 'classgroup2'].includes(row.type);
    const metadata = classgroup && (!row.unit_id || String(row.unit_id) === String(group?.course_unit_id)) && (!row.group_number || String(row.group_number) === String(group?.group_number)) ? group : null;
    const form = localized(row.classtype_name) || localized(metadata?.class_type) || String(row.classtype_id || metadata?.class_type_id || '');
    const short = /wyk|lecture/i.test(form) ? 'W' : /lab/i.test(form) ? 'L' : /ćw|cw|aud/i.test(form) ? 'A' : /projekt/i.test(form) ? 'P' : '';
    const title = localized(row.course_name) || localized(metadata?.course_name) || localized(row.name);
    const name = localized(row.name);
    const unit = String(row.unit_id || metadata?.course_unit_id || '');
    const number = String(row.group_number || metadata?.group_number || '');
    const key = classgroup && unit && number ? `class:${unit}:${number}:${start}:${end}` : JSON.stringify([row.type, row.course_id, start, end, title, name, row.room_number]);
    const event = { title, subject: title, description: name, start, end,
      worker: (metadata?.lecturers || []).map((person) => `${person.first_name || ''} ${person.last_name || ''}`.trim()).filter(Boolean).join(', '), workerTitle: '',
      lessonForm: form, lessonFormShort: short, groupName: number, tokName: '',
      room: [localized(row.building_name), row.room_number].filter(Boolean).join(', '),
      lessonStatus: row.type === 'exam' ? 'Egzamin' : '', lessonStatusShort: row.type === 'exam' ? 'E' : '',
      sourceId: key,
    };
    if (!result.has(key) || row.type === 'classgroup2') result.set(key, event);
  }
  return [...result.values()];
}

export function mapCatalog(body) {
  if (!body || !Array.isArray(body.terms) || !body.groups || typeof body.groups !== 'object') throw failure('Nieprawidłowy katalog grup USOS.', 502);
  return body.terms.map((term) => ({
    id: String(term.id), start: String(term.start_date), end: String(term.finish_date),
    groups: (body.groups[term.id] || []).map((group) => ({ ...group, course_unit_id: identifier(group.course_unit_id), group_number: identifier(group.group_number), term_id: String(term.id) })),
  })).filter((term) => /^\d{4}-\d{2}-\d{2}$/.test(term.start) && /^\d{4}-\d{2}-\d{2}$/.test(term.end));
}

export function createTimetableGateway(fetchUsos, { now = Date.now, spacing = 500 } = {}) {
  const entries = new Map();
  const requests = new Map();
  let queue = Promise.resolve();
  let previousStart = 0;
  async function read(credentials, endpoint, params, ttl = 6 * HOUR, force = false) {
    const owner = crypto.createHash('sha256').update(JSON.stringify([credentials.token, credentials.secret])).digest('hex');
    const key = `${owner}:${endpoint}:${JSON.stringify(params)}`;
    const cached = entries.get(key);
    if (cached?.data !== undefined && now() - cached.ts < (force ? 5 * 60_000 : ttl)) return cached.data;
    if (requests.has(key)) return requests.get(key);
    if (requests.size >= 64) throw failure('Synchronizacja jest zajęta. Spróbuj ponownie za kilka minut.', 503);
    if (cached?.retryAt > now()) {
      if (cached.data !== undefined) return cached.data;
      throw failure('USOS jest niedostępny. Spróbuj ponownie za kilka minut.', 503);
    }
    const operation = queue.catch(() => {}).then(async () => {
      const wait = Math.max(0, spacing - (now() - previousStart));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      previousStart = now();
      try {
        const data = await fetchUsos(endpoint, { ...credentials, params, force });
        entries.delete(key); entries.set(key, { data, ts: now() });
        while (entries.size > 1500) entries.delete(entries.keys().next().value);
        return data;
      } catch (error) {
        entries.set(key, { ...cached, retryAt: now() + 5 * 60_000 });
        while (entries.size > 1500) entries.delete(entries.keys().next().value);
        if (cached?.data !== undefined && ![401, 403].includes(error.status)) return cached.data;
        throw error;
      }
    });
    queue = operation.then(() => {}, () => {});
    requests.set(key, operation);
    try { return await operation; } finally { requests.delete(key); }
  }

  function selected(query) {
    const match = String(query).match(/^(.*?)\s*\[([^\[\]]+)\]\s*$/);
    if (!match) throw failure('Wybierz konkretną pozycję z wyników wyszukiwania.');
    return identifier(match[2]);
  }

  async function week(credentials, { start, category = 'album', query = '', album = '', force = false }) {
    query = String(query || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))) throw failure('Nieprawidłowa data planu.');
    const params = { start, days: '7', fields: ACTIVITY_FIELDS };
    let endpoint = 'services/tt/student';
    if (query.trim()) {
      if (category === 'album') {
        if (query.replace(/^s/i, '') !== String(album)) throw failure('USOS udostępnia tylko plan zalogowanego studenta.');
      } else if (category === 'teacher') { endpoint = 'services/tt/staff'; params.user_id = selected(query); }
      else if (category === 'room') { endpoint = 'services/tt/room'; params.room_id = selected(query); }
      else if (category === 'subject') {
        endpoint = 'services/tt/course_edition'; params.course_id = selected(query);
        const course = await read(credentials, 'services/courses/course', { course_id: params.course_id, fields: 'id|name|terms' }, 7 * 24 * HOUR);
        const ids = (course.terms || []).map((term) => typeof term === 'string' ? term : term.id).filter(Boolean);
        const terms = ids.length ? await read(credentials, 'services/terms/terms', { term_ids: ids.join('|'), fields: 'id|start_date|finish_date' }, 7 * 24 * HOUR) : {};
        const term = termRows(terms).find((item) => item?.start_date <= start && item?.finish_date >= start);
        if (!term) throw failure('Brak tego przedmiotu w wybranym semestrze.');
        params.term_id = term.id;
      } else if (category === 'group') {
        const match = query.match(/\[(\d+):(\d+)\]$/);
        if (!match) throw failure('Wybierz grupę przedmiotu z wyników.');
        return group(credentials, { unit: match[1], number: match[2] });
      } else throw failure('Nieobsługiwana kategoria wyszukiwania.');
    }
    return mapActivities(await read(credentials, endpoint, params, 6 * HOUR, force === true));
  }

  async function catalog(credentials) { return mapCatalog(await read(credentials, 'services/groups/participant', { active_terms: 'false', fields: GROUP_FIELDS }, 7 * 24 * HOUR)); }
  async function group(credentials, { unit, number, metadata = null }) {
    return mapActivities(await read(credentials, 'services/tt/classgroup_dates2', { unit_id: identifier(unit), group_number: identifier(number), fields: ACTIVITY_FIELDS }, 7 * 24 * HOUR), metadata);
  }

  async function suggest(credentials, { category, query }) {
    query = String(query || '').trim();
    if (query.length < 2 || query.length > 200) return [];
    const ttl = 7 * 24 * HOUR;
    if (category === 'teacher') {
      const data = await read(credentials, 'services/users/search2', { lang: 'pl', query, among: 'current_teachers', num: '12', fields: 'items[user[id|first_name|last_name]|match]|next_page' }, ttl);
      return (data.items || []).map(({ user }) => `${user.first_name} ${user.last_name} [${user.id}]`);
    }
    if (category === 'room') {
      const match = query.match(/\[([^\]]+)\]\s*\/\s*(.*)$/);
      const rawRoom = !match && query.match(/^(.+),\s*([^,]+)$/);
      let buildingId = match?.[1];
      let roomNumber = match?.[2] ?? '';
      if (!buildingId) {
        const data = await read(credentials, 'services/geo/building_index', { fields: 'id|name' }, 30 * 24 * HOUR);
        const rows = Array.isArray(data) ? data : Object.values(data || {});
        const named = rawRoom && rows.find((row) => [String(row.id), localized(row.name)].some((name) => name.toLowerCase() === rawRoom[1].trim().toLowerCase()));
        if (!named) return rows.filter((row) => `${row.id} ${localized(row.name)}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12).map((row) => `${localized(row.name)} [${row.id}] / `);
        buildingId = String(named.id); roomNumber = rawRoom[2].trim();
      }
      const building = await read(credentials, 'services/geo/building2', { building_id: identifier(buildingId), fields: 'id|name|rooms[id|number]' }, ttl);
      return (building.rooms || []).filter((room) => String(room.number).toLowerCase().includes(roomNumber.toLowerCase())).slice(0, 20).map((room) => `${localized(building.name)}, ${room.number} [${room.id}]`);
    }
    if (category === 'subject' || category === 'group') {
      const selection = query.match(/^.*\[([^\]]+)\]\s*\/\s*$/);
      if (category === 'group' && selection) {
        const courseId = identifier(selection[1]);
        const course = await read(credentials, 'services/courses/course', { course_id: courseId, fields: 'id|name|terms' }, ttl);
        const ids = (course.terms || []).map((term) => typeof term === 'string' ? term : term.id).filter(Boolean);
        const terms = ids.length ? await read(credentials, 'services/terms/terms', { term_ids: ids.join('|'), fields: 'id|start_date|finish_date' }, ttl) : {};
        const day = new Date(now()).toISOString().slice(0, 10);
        const term = termRows(terms).find((row) => row?.start_date <= day && row?.finish_date >= day);
        if (!term) return [];
        const edition = await read(credentials, 'services/courses/course_edition', { course_id: courseId, term_id: term.id, fields: 'course_units_ids' }, ttl);
        const items = [];
        for (const unit of (edition.course_units_ids || []).slice(0, 20)) {
          const data = await read(credentials, 'services/courses/unit', { unit_id: String(unit), fields: 'id|classtype_id|groups[group_number|course_unit_id|class_type|course_name|term_id|lecturers]' }, ttl);
          for (const row of data.groups || []) items.push(`${localized(course.name)} · ${localized(row.class_type) || data.classtype_id} · gr. ${row.group_number} [${unit}:${row.group_number}]`);
        }
        return items.slice(0, 40);
      }
      const data = await read(credentials, 'services/courses/search', { lang: 'pl', name: query, num: '12', fields: 'id|name|terms' }, ttl);
      return (data.items || []).map((course) => `${localized(course.name)} [${course.id}]${category === 'group' ? ' / ' : ''}`);
    }
    return [];
  }
  return { week, catalog, group, suggest };
}
