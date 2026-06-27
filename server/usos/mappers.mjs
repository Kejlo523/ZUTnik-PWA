export const REQUIRED_USOS_SCOPES = [
  'studies',
  'grades',
  'payments',
  'cards',
  'photo',
  'crstests',
  'surveys_filling',
  'offline_access',
];

export function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

export function normalizeScopeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(/[|,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function missingRequiredScopes(value) {
  const granted = new Set(normalizeScopeList(value));
  return REQUIRED_USOS_SCOPES.filter((scope) => !granted.has(scope));
}

export function localized(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return firstNonEmpty(value.pl, value.en, value.name);
  }
  return firstNonEmpty(value);
}

export function localizedField(obj, key) {
  if (!obj || typeof obj !== 'object') return '';
  return localized(obj[key]);
}

function normalizeStudyMode(value) {
  const text = localized(value);
  if (text) return text;
  const num = Number(value);
  if (num === 1) return 'Stacjonarne';
  if (num === 2) return 'Niestacjonarne';
  return '';
}

export function mapStudyStatus(status) {
  switch (String(status || '')) {
    case 'active': return 'Aktywny';
    case 'cancelled': return 'Anulowany';
    case 'graduated_diploma': return 'Absolwent';
    case 'graduated_end_of_study':
    case 'graduated_before_diploma':
      return 'Absolwent (ukończone)';
    default:
      return firstNonEmpty(status);
  }
}

export function mapStudentProgramme(row) {
  const programme = row?.programme && typeof row.programme === 'object' ? row.programme : {};
  const faculty = programme.faculty && typeof programme.faculty === 'object' ? programme.faculty : {};
  const name = localizedField(programme, 'name') || localizedField(programme, 'description') || firstNonEmpty(programme.id, row?.id);
  const mode = normalizeStudyMode(programme.mode_of_studies);
  const level = localizedField(programme, 'level_of_studies') || firstNonEmpty(programme.level);

  return {
    studentProgrammeId: firstNonEmpty(row?.id, programme.id),
    programmeId: firstNonEmpty(programme.id),
    name,
    facultyId: firstNonEmpty(faculty.id),
    facultyName: localizedField(faculty, 'name'),
    mode,
    level,
    status: firstNonEmpty(row?.status),
    statusLabel: mapStudyStatus(row?.status),
    admissionDate: firstNonEmpty(row?.admission_date),
    isPrimary: row?.is_primary === true,
    stages: asArray(row?.stages).map((stage) => ({
      id: firstNonEmpty(stage?.id),
      name: localizedField(stage, 'name') || firstNonEmpty(stage?.id),
    })).filter((stage) => stage.id || stage.name),
  };
}

export function mapUserProfile(user, programmes, scopes = []) {
  const mappedProgrammes = asArray(programmes)
    .map(mapStudentProgramme)
    .filter((programme) => programme.studentProgrammeId || programme.programmeId || programme.name);

  const firstName = firstNonEmpty(user?.first_name);
  const lastName = firstNonEmpty(user?.last_name);
  return {
    user: {
      id: firstNonEmpty(user?.id),
      firstName,
      lastName,
      name: firstNonEmpty(`${firstName} ${lastName}`.trim(), user?.id, 'Użytkownik USOS'),
      studentNumber: firstNonEmpty(user?.student_number),
      studentStatus: user?.student_status ?? null,
    },
    programmes: mappedProgrammes,
    scopes: normalizeScopeList(scopes),
  };
}

function termSeason(term) {
  const id = firstNonEmpty(term?.id).toUpperCase();
  const name = localizedField(term, 'name').toLowerCase();
  if (id.endsWith('L') || name.includes('letni') || name.includes('summer')) return 'Lato';
  if (id.endsWith('Z') || name.includes('zimowy') || name.includes('winter')) return 'Zima';
  return '';
}

function academicYearFromTerm(term) {
  const name = localizedField(term, 'name');
  const nameYear = name.match(/20\d{2}\s*[/\\-]\s*(?:20)?\d{2}/);
  if (nameYear) return nameYear[0].replace(/\s+/g, '');

  const id = firstNonEmpty(term?.id);
  const idYear = id.match(/(20\d{2})\D?(\d{2})?/);
  if (idYear) {
    const start = idYear[1];
    const end = idYear[2] ? `20${idYear[2]}` : String(Number(start) + 1);
    return `${start}/${end}`;
  }
  return name || id;
}

export function mapSemesters(coursesResponse) {
  const terms = new Map();
  for (const term of asArray(coursesResponse?.terms)) {
    const id = firstNonEmpty(term?.id);
    if (id) terms.set(id, term);
  }

  const editions = coursesResponse?.course_editions && typeof coursesResponse.course_editions === 'object'
    ? coursesResponse.course_editions
    : {};
  for (const termId of Object.keys(editions)) {
    if (!terms.has(termId)) terms.set(termId, { id: termId });
  }

  return [...terms.values()]
    .sort((left, right) => (
      firstNonEmpty(left.start_date, left.id).localeCompare(firstNonEmpty(right.start_date, right.id), 'pl')
    ))
    .map((term, index) => ({
      listaSemestrowId: firstNonEmpty(term.id),
      nrSemestru: String(index + 1),
      pora: termSeason(term),
      rokAkademicki: academicYearFromTerm(term),
      status: term.is_active ? 'Aktywny' : 'Zakończony',
    }));
}

function parseFlexibleNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = firstNonEmpty(value).replace(/\s+/g, '').replace(',', '.').replace(/zł|pln/gi, '');
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatIsoDate(value) {
  const raw = firstNonEmpty(value);
  if (!raw) return '';
  return raw.split(/[T\s]/)[0];
}

function courseName(course) {
  return localizedField(course, 'name') || localizedField(course, 'course_name') || firstNonEmpty(course?.id, course?.course_id);
}

function courseActivityLabel(courseId) {
  const match = firstNonEmpty(courseId).match(/-([A-Z]{2})$/i);
  const suffix = match?.[1]?.toUpperCase();
  switch (suffix) {
    case 'CW': return 'Ćwiczenia';
    case 'LB': return 'Laboratorium';
    case 'WK': return 'Wykład';
    default: return '';
  }
}

function buildCourseMapForTerm(coursesResponse, termId) {
  const editions = coursesResponse?.course_editions?.[termId] ?? [];
  const map = new Map();
  for (const edition of asArray(editions)) {
    const course = edition?.course && typeof edition.course === 'object' ? edition.course : edition;
    const id = firstNonEmpty(course?.id, edition?.course_id, edition?.id);
    if (!id) continue;
    map.set(id, {
      id,
      name: courseName(course),
      activityType: courseActivityLabel(id),
      ects: parseFlexibleNumber(edition?.ects_credits_simplified ?? course?.ects_credits_simplified),
      grades: asArray(edition?.grades).filter(Boolean),
    });
  }
  return map;
}

function collectCourseTermIds(coursesResponse, gradesResponse) {
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
  if (gradesResponse && typeof gradesResponse === 'object') {
    for (const id of Object.keys(gradesResponse)) {
      if (id) ids.add(id);
    }
  }

  return [...ids].sort((left, right) => left.localeCompare(right, 'pl'));
}

function gradeValue(entry) {
  return firstNonEmpty(
    entry?.value_symbol,
    localizedField(entry, 'value_description'),
    entry?.value_description,
    entry?.value,
    entry?.symbol,
    entry?.grade?.value_symbol,
    localizedField(entry?.grade, 'value_description'),
    entry?.grade?.value_description,
    entry?.grade?.value,
    entry?.grade?.symbol,
  );
}

function gradeTypeLabel(entry, fallback) {
  const raw = firstNonEmpty(localizedField(entry, 'grade_type_id'), entry?.grade_type_id);
  const normalized = raw.toLowerCase();
  if (normalized.includes('course') || normalized.includes('final') || normalized.includes('konc')) {
    return 'Ocena końcowa';
  }
  return fallback;
}

function isGradeEntryLike(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return Boolean(gradeValue(entry))
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

function mapSingleGrade(entry, course, type, ects) {
  return {
    subjectName: course.name || course.id,
    grade: gradeValue(entry),
    weight: ects,
    type: course.activityType || gradeTypeLabel(entry, type),
    teacher: '',
    date: formatIsoDate(entry?.date_acquisition || entry?.date_modified),
  };
}

function latestGradeCourse(entry) {
  const edition = entry?.course_edition && typeof entry.course_edition === 'object' ? entry.course_edition : {};
  const course = edition?.course && typeof edition.course === 'object' ? edition.course : edition;
  const id = firstNonEmpty(course?.id, edition?.course_id, entry?.course_id, entry?.course?.id);
  return {
    id,
    termId: firstNonEmpty(edition?.term_id, entry?.term_id),
    name: courseName(course) || courseName(edition) || id,
    activityType: courseActivityLabel(id),
    ects: parseFlexibleNumber(edition?.ects_credits_simplified ?? course?.ects_credits_simplified),
  };
}

function gradeDedupeKey(grade) {
  return [
    grade.subjectName,
    grade.grade,
    grade.type,
    grade.date,
    grade.weight,
  ].join('|').toLowerCase();
}

export function mapGrades({ termId = '', termIds: scopedTermIds = null, coursesResponse, ectsResponse, gradesResponse, latestGrades = [] }) {
  const termIds = termId
    ? [termId]
    : (Array.isArray(scopedTermIds) && scopedTermIds.length
        ? [...new Set(scopedTermIds.filter(Boolean))]
        : collectCourseTermIds(coursesResponse, gradesResponse));
  const includeEmptyCourses = true;
  const out = [];
  const seen = new Set();

  const pushGrade = (grade) => {
    if (!grade?.grade?.trim()) return false;
    const key = gradeDedupeKey(grade);
    if (seen.has(key)) return false;
    seen.add(key);
    out.push(grade);
    return true;
  };

  for (const currentTermId of termIds) {
    const courses = buildCourseMapForTerm(coursesResponse, currentTermId);
    const termGrades = gradesResponse?.[currentTermId] && typeof gradesResponse[currentTermId] === 'object' ? gradesResponse[currentTermId] : {};
    for (const courseId of Object.keys(termGrades)) {
      if (!courses.has(courseId)) {
        courses.set(courseId, { id: courseId, name: courseId, activityType: courseActivityLabel(courseId), ects: 0 });
      }
    }

    for (const courseId of [...courses.keys()].sort((a, b) => (courses.get(a)?.name || a).localeCompare(courses.get(b)?.name || b, 'pl'))) {
      const course = courses.get(courseId);
      const ects = parseFlexibleNumber(ectsResponse?.[currentTermId]?.[courseId]) || course.ects || 0;
      const courseGradeData = termGrades?.[courseId] && typeof termGrades[courseId] === 'object' ? termGrades[courseId] : {};
      let hasAnyGrade = false;

      for (const entry of flattenGradeEntries(courseGradeData.course_grades)) {
        hasAnyGrade = pushGrade(mapSingleGrade(entry, course, course.activityType || 'Ocena końcowa', ects)) || hasAnyGrade;
      }

      const unitGrades = courseGradeData.course_units_grades && typeof courseGradeData.course_units_grades === 'object'
        ? courseGradeData.course_units_grades
        : {};
      for (const entries of Object.values(unitGrades)) {
        for (const entry of flattenGradeEntries(entries)) {
          hasAnyGrade = pushGrade(mapSingleGrade(entry, course, 'Zaliczenie', ects)) || hasAnyGrade;
        }
      }

      if (!hasAnyGrade && course.grades?.length) {
        for (const entry of flattenGradeEntries(course.grades)) {
          hasAnyGrade = pushGrade(mapSingleGrade(entry, course, course.activityType || 'Ocena końcowa', ects)) || hasAnyGrade;
        }
      }

      if (!hasAnyGrade && includeEmptyCourses) {
        out.push({
          subjectName: course.name || course.id,
          grade: '',
          weight: ects,
          type: course.activityType || '',
          teacher: '',
          date: '',
        });
      }
    }
  }

  for (const entry of asArray(latestGrades).filter(Boolean)) {
    const course = latestGradeCourse(entry);
    if (!course.id && !course.name) continue;
    const ects = parseFlexibleNumber(ectsResponse?.[course.termId]?.[course.id]) || course.ects || 0;
    pushGrade(mapSingleGrade(entry, course, 'Ocena końcowa', ects));
  }

  if (!termId) {
    return out.sort((left, right) => {
      const subjectOrder = left.subjectName.localeCompare(right.subjectName, 'pl');
      if (subjectOrder !== 0) return subjectOrder;
      const leftFinal = gradeTypeLabel(left, left.type) === 'Ocena końcowa' ? 0 : 1;
      const rightFinal = gradeTypeLabel(right, right.type) === 'Ocena końcowa' ? 0 : 1;
      if (leftFinal !== rightFinal) return leftFinal - rightFinal;
      return left.type.localeCompare(right.type, 'pl');
    });
  }

  return out;
}

function moneyText(value, currency = 'PLN') {
  const num = parseFlexibleNumber(value);
  if (!Number.isFinite(num)) return null;
  return `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num)} ${currency || 'PLN'}`;
}

function normalizePaymentBalance(row) {
  const saldo = parseFlexibleNumber(row?.saldo_amount);
  const state = firstNonEmpty(row?.state?.symbol, row?.state).toLowerCase();
  if (Math.abs(saldo) <= 0.0001) return 0;
  if (state.includes('overpaid') || state.includes('nadp')) return Math.abs(saldo);
  if (state.includes('paid') || state.includes('settled') || state.includes('closed') || state.includes('rozlic')) return 0;
  return saldo < 0 ? saldo : -saldo;
}

export function mapFinanceRecords(payments) {
  return asArray(payments).map((row) => {
    const currency = firstNonEmpty(row?.currency, 'PLN');
    const amountValue = parseFlexibleNumber(row?.total_amount || row?.amount || row?.saldo_amount);
    const balanceValue = normalizePaymentBalance(row);
    const paidValue = balanceValue < 0 ? Math.max(0, amountValue - Math.abs(balanceValue)) : amountValue;
    const title = localizedField(row, 'description') || firstNonEmpty(row?.type, row?.debt_type, row?.id, 'Pozycja finansowa');

    return {
      title,
      amountText: amountValue ? moneyText(amountValue, currency) : null,
      paidText: paidValue ? moneyText(paidValue, currency) : null,
      dueDateText: firstNonEmpty(row?.payment_deadline) || null,
      paidDateText: null,
      balanceText: moneyText(balanceValue, currency),
      accountText: firstNonEmpty(row?.account_number) || null,
      amountValue,
      paidValue,
      balanceValue,
    };
  });
}

export function mapInfoPayload({ user, selectedProgramme, programmes, cards, calendarEvents, activeTerm }) {
  const programme = selectedProgramme || asArray(programmes)[0] || null;
  const details = {
    album: firstNonEmpty(user?.studentNumber, user?.student_number, user?.id),
    wydzial: programme?.facultyName || '',
    kierunek: programme?.name || '',
    forma: programme?.mode || '',
    poziom: programme?.level || '',
    specjalnosc: '',
    specjalizacja: '',
    status: programme ? (programme.statusLabel || mapStudyStatus(programme.status)) : '',
    rokAkademicki: activeTerm ? academicYearFromTerm(activeTerm) : '',
    semestrLabel: activeTerm ? termSeason(activeTerm).toLowerCase() : '',
  };

  const history = asArray(programmes).map((item) => ({
    label: item.name || item.programmeId || item.studentProgrammeId,
    status: item.statusLabel || mapStudyStatus(item.status),
  })).filter((item) => item.label);

  const today = new Date().toISOString().slice(0, 10);
  const elsRaw = asArray(cards).find((card) => ['student', 'phd'].includes(String(card?.type || '').toLowerCase())) ?? asArray(cards)[0];
  const els = elsRaw ? {
    id: firstNonEmpty(elsRaw.id, elsRaw.barcode_number),
    expirationDate: firstNonEmpty(elsRaw.expiration_date),
    isActive: !firstNonEmpty(elsRaw.expiration_date) || firstNonEmpty(elsRaw.expiration_date) >= today,
  } : null;

  return {
    details,
    history,
    els,
    calendarEvents: mapCalendarEvents(calendarEvents),
  };
}

export function mapCalendarEvents(events) {
  return asArray(events).map((event) => ({
    id: firstNonEmpty(event?.id),
    name: localizedField(event, 'name') || firstNonEmpty(event?.id),
    startDate: formatIsoDate(event?.start_date),
    endDate: formatIsoDate(event?.end_date),
    type: firstNonEmpty(event?.type),
    isDayOff: event?.is_day_off === true,
  })).filter((event) => event.id || event.name);
}

export function mapCreditSummary({ studentProgrammeId, programmeUsed, overallUsed }) {
  const normalize = (value) => {
    const parsed = parseFlexibleNumber(value);
    return Number.isFinite(parsed) && Math.abs(parsed) > 0.0001 ? parsed : (firstNonEmpty(value) === '0' ? 0 : null);
  };

  return {
    studentProgrammeId: firstNonEmpty(studentProgrammeId),
    programmeUsed: normalize(programmeUsed),
    overallUsed: normalize(overallUsed),
  };
}

function userName(user) {
  return firstNonEmpty(
    user?.name,
    `${firstNonEmpty(user?.first_name)} ${firstNonEmpty(user?.last_name)}`.trim(),
    user?.id,
  );
}

function surveyTypeLabel(type) {
  switch (String(type || '').toLowerCase()) {
    case 'course': return 'Kurs';
    case 'general': return 'Ogólna';
    default: return firstNonEmpty(type);
  }
}

export function mapSurveyItems(surveys) {
  return asArray(surveys).map((survey) => {
    const group = survey?.group && typeof survey.group === 'object' ? survey.group : {};
    const courseUnit = group.course_unit && typeof group.course_unit === 'object' ? group.course_unit : {};
    const course = courseUnit.course && typeof courseUnit.course === 'object' ? courseUnit.course : {};
    const lecturer = survey?.lecturer && typeof survey.lecturer === 'object' ? survey.lecturer : {};
    const faculty = survey?.faculty && typeof survey.faculty === 'object' ? survey.faculty : {};
    const programme = survey?.programme && typeof survey.programme === 'object' ? survey.programme : {};

    return {
      id: firstNonEmpty(survey?.id),
      title: localizedField(survey, 'name') || firstNonEmpty(survey?.id, 'Ankieta'),
      type: surveyTypeLabel(survey?.survey_type),
      startDate: formatIsoDate(survey?.start_date),
      endDate: formatIsoDate(survey?.end_date),
      canFillOut: survey?.can_i_fill_out === true,
      didFillOut: survey?.did_i_fill_out === true,
      headlineHtml: sanitizeHtml(localizedField(survey, 'headline_html')),
      courseName: localizedField(course, 'name') || localizedField(courseUnit, 'course_name') || firstNonEmpty(courseUnit?.course_id),
      lecturerName: userName(lecturer),
      facultyName: localizedField(faculty, 'name'),
      programmeName: localizedField(programme, 'name'),
    };
  }).filter((survey) => survey.id || survey.title);
}

function courseEditionTermId(courseEdition) {
  return firstNonEmpty(courseEdition?.term_id, courseEdition?.term?.id);
}

function courseEditionCourseId(courseEdition) {
  const course = courseEdition?.course && typeof courseEdition.course === 'object' ? courseEdition.course : {};
  return firstNonEmpty(courseEdition?.course_id, course?.id);
}

function courseEditionName(courseEdition) {
  const course = courseEdition?.course && typeof courseEdition.course === 'object' ? courseEdition.course : {};
  return localizedField(course, 'name')
    || localizedField(courseEdition, 'course_name')
    || firstNonEmpty(courseEdition?.course_name, courseEditionCourseId(courseEdition));
}

function nodeId(node) {
  return firstNonEmpty(node?.node_id, node?.id);
}

function nodeType(node) {
  return firstNonEmpty(node?.type).toLowerCase();
}

function nodeDisplayName(node) {
  return localizedField(node, 'name') || firstNonEmpty(nodeId(node), 'Pozycja');
}

function flattenNodeTree(node, path = []) {
  if (!node || typeof node !== 'object') return [];
  const currentPath = [...path, parseFlexibleNumber(node.order)];
  const current = { ...node, __orderPath: currentPath };
  const children = asArray(node.subnodes).flatMap((child) => flattenNodeTree(child, currentPath));
  return [current, ...children];
}

function courseTestGradeValue(entry) {
  const grade = entry?.grade && typeof entry.grade === 'object' ? entry.grade : entry;
  return firstNonEmpty(
    grade?.value_symbol,
    localizedField(grade, 'value_description'),
    grade?.symbol,
    grade?.order,
  );
}

function compareOrderPath(left, right) {
  const a = Array.isArray(left.__orderPath) ? left.__orderPath : [];
  const b = Array.isArray(right.__orderPath) ? right.__orderPath : [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const av = Number.isFinite(a[i]) ? a[i] : 0;
    const bv = Number.isFinite(b[i]) ? b[i] : 0;
    if (av !== bv) return av - bv;
  }
  return nodeDisplayName(left).localeCompare(nodeDisplayName(right), 'pl');
}

export function mapCourseTests({ tests, nodeTreesByRootId = {}, pointsByRootId = {}, gradesByRootId = {}, termId = '' }) {
  return asArray(tests).map((test, index) => {
    const courseEdition = test?.course_edition && typeof test.course_edition === 'object' ? test.course_edition : {};
    const root = test?.root && typeof test.root === 'object' ? test.root : {};
    const rootId = nodeId(root);
    const courseTermId = courseEditionTermId(courseEdition);
    if (termId && courseTermId && courseTermId !== termId) return null;

    const tree = nodeTreesByRootId[rootId] || root;
    const nodes = flattenNodeTree(tree).filter((node) => nodeId(node));
    const pointsByNode = new Map(asArray(pointsByRootId[rootId]).map((point) => [firstNonEmpty(point?.node_id), point]));
    const gradesByNode = new Map(asArray(gradesByRootId[rootId]).map((grade) => [firstNonEmpty(grade?.node_id), grade]));

    const scores = nodes
      .filter((node) => {
        const type = nodeType(node);
        return type === 'task' || type === 'grade';
      })
      .map((node) => {
        const id = nodeId(node);
        const type = nodeType(node);
        if (type === 'task') {
          const point = pointsByNode.get(id);
          if (!point) return null;
          const points = parseFlexibleNumber(point?.points);
          const maxPoints = firstNonEmpty(node?.points_max) ? parseFlexibleNumber(node.points_max) : null;
          return {
            id,
            name: nodeDisplayName(node),
            type: 'points',
            value: firstNonEmpty(point?.points),
            points: Number.isFinite(points) ? points : null,
            maxPoints: Number.isFinite(maxPoints) ? maxPoints : null,
            date: formatIsoDate(point?.last_changed),
            comment: firstNonEmpty(point?.comment, point?.public_comment),
            __orderPath: node.__orderPath,
          };
        }

        const grade = gradesByNode.get(id);
        const value = grade ? courseTestGradeValue(grade) : '';
        if (!value) return null;
        return {
          id,
          name: nodeDisplayName(node),
          type: 'grade',
          value,
          points: null,
          maxPoints: null,
          date: formatIsoDate(grade?.last_changed),
          comment: firstNonEmpty(grade?.public_comment),
          __orderPath: node.__orderPath,
        };
      })
      .filter(Boolean)
      .sort(compareOrderPath)
      .map(({ __orderPath, ...score }) => score);

    if (scores.length === 0) return null;

    return {
      id: firstNonEmpty(test?.id, rootId, index),
      rootId,
      courseId: courseEditionCourseId(courseEdition),
      termId: courseTermId,
      courseName: courseEditionName(courseEdition),
      testName: nodeDisplayName(tree) || nodeDisplayName(root),
      scores,
    };
  }).filter(Boolean).sort((left, right) => (
    firstNonEmpty(left.courseName, left.testName).localeCompare(firstNonEmpty(right.courseName, right.testName), 'pl')
  ));
}

const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'h2', 'h3', 'h4']);
const VOID_TAGS = new Set(['br', 'img']);

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeUrl(value, allowImage = false) {
  const raw = firstNonEmpty(value);
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://usosapi.zut.edu.pl/');
    if (url.protocol === 'http:' || url.protocol === 'https:' || (!allowImage && url.protocol === 'mailto:')) {
      return url.href;
    }
  } catch {
    return '';
  }
  return '';
}

export function sanitizeHtml(html) {
  const withoutDangerousBlocks = firstNonEmpty(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(iframe|object|embed|form|input|button|svg|math)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|object|embed|form|input|button|svg|math)\b[^>]*>/gi, '');

  return withoutDangerousBlocks.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, rawTag, rawAttrs) => {
    const tag = String(rawTag).toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    const isClosing = match.startsWith('</');
    if (isClosing) return VOID_TAGS.has(tag) ? '' : `</${tag}>`;

    if (tag === 'a') {
      const href = safeUrl((rawAttrs.match(/\bhref\s*=\s*(['"])(.*?)\1/i) || [])[2]);
      const title = (rawAttrs.match(/\btitle\s*=\s*(['"])(.*?)\1/i) || [])[2];
      const attrs = [];
      if (href) attrs.push(`href="${escapeAttr(href)}"`, 'target="_blank"', 'rel="noreferrer"');
      if (title) attrs.push(`title="${escapeAttr(title)}"`);
      return `<a${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
    }

    if (tag === 'img') {
      const src = safeUrl((rawAttrs.match(/\bsrc\s*=\s*(['"])(.*?)\1/i) || [])[2], true);
      if (!src) return '';
      const alt = (rawAttrs.match(/\balt\s*=\s*(['"])(.*?)\1/i) || [])[2] || '';
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async">`;
    }

    return `<${tag}>`;
  });
}

export function htmlToText(html) {
  return sanitizeHtml(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function formatNewsDate(value) {
  const raw = firstNonEmpty(value);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function mapNewsItems(searchResponse) {
  return asArray(searchResponse?.items).map((item, index) => {
    const article = item?.article && typeof item.article === 'object' ? item.article : item;
    const idText = firstNonEmpty(article?.id, index);
    const descriptionHtml = sanitizeHtml(localizedField(article, 'headline_html'));
    const contentHtml = sanitizeHtml(localizedField(article, 'content_html'));
    const descriptionText = htmlToText(descriptionHtml || contentHtml);
    const imageUrls = article?.image_urls && typeof article.image_urls === 'object' ? article.image_urls : {};
    const thumbUrl = firstNonEmpty(imageUrls['720x405'], imageUrls['360x203'], imageUrls.original);

    return {
      id: Number.isFinite(Number(article?.id)) ? Number(article.id) : index,
      title: localizedField(article, 'title') || `Aktualność ${idText}`,
      date: formatNewsDate(article?.publication_date),
      pubDateRaw: firstNonEmpty(article?.publication_date),
      snippet: descriptionText.length > 220 ? `${descriptionText.slice(0, 217)}...` : descriptionText,
      link: `https://usosweb.zut.edu.pl/kontroler.php?_action=news/default&article_id=${encodeURIComponent(idText)}`,
      descriptionHtml,
      descriptionText,
      contentHtml,
      thumbUrl,
    };
  });
}
