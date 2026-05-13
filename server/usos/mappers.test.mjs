import assert from 'node:assert/strict';
import {
  mapFinanceRecords,
  mapGrades,
  mapInfoPayload,
  mapNewsItems,
  mapSemesters,
  mapStudentProgramme,
  missingRequiredScopes,
  sanitizeHtml,
} from './mappers.mjs';

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('validates required OAuth scopes exactly', () => {
  assert.deepEqual(missingRequiredScopes('studies|grades|payments|cards|photo'), []);
  assert.deepEqual(missingRequiredScopes('studies|grades|photo'), ['payments', 'cards']);
});

test('maps student programme id separately from programme id', () => {
  const programme = mapStudentProgramme({
    id: 'SP-123',
    programme: {
      id: 'PRG-456',
      name: { pl: 'Informatyka' },
      faculty: { id: 'WI', name: { pl: 'Wydzial Informatyki' } },
      mode_of_studies: { pl: 'Stacjonarne' },
      level_of_studies: { pl: 'I stopien' },
    },
    status: 'active',
    admission_date: '2024-10-01',
    is_primary: true,
  });

  assert.equal(programme.studentProgrammeId, 'SP-123');
  assert.equal(programme.programmeId, 'PRG-456');
  assert.equal(programme.name, 'Informatyka');
  assert.equal(programme.facultyId, 'WI');
  assert.equal(programme.statusLabel, 'Aktywny');
});

test('sorts semesters chronologically with newest last', () => {
  const semesters = mapSemesters({
    terms: [
      { id: '2024Z', name: { pl: 'Semestr zimowy 2024/25' }, start_date: '2024-10-01' },
      { id: '2023L', name: { pl: 'Semestr letni 2023/24' }, start_date: '2024-02-19' },
      { id: '2024L', name: { pl: 'Semestr letni 2024/25' }, start_date: '2025-02-17', is_active: true },
    ],
  });

  assert.deepEqual(semesters.map((semester) => semester.listaSemestrowId), ['2023L', '2024Z', '2024L']);
  assert.equal(semesters.at(-1)?.status, 'Aktywny');
});

test('maps grades and keeps courses without grades visible', () => {
  const grades = mapGrades({
    termId: '2024Z',
    coursesResponse: {
      course_editions: {
        '2024Z': [
          { course_id: 'ALG', course_name: { pl: 'Algebra' }, term_id: '2024Z' },
          { course_id: 'PHY', course_name: { pl: 'Fizyka' }, term_id: '2024Z' },
        ],
      },
    },
    ectsResponse: {
      '2024Z': { ALG: '5', PHY: '3' },
    },
    gradesResponse: {
      '2024Z': {
        ALG: {
          course_grades: [{ value_symbol: '4.5', date_acquisition: '2025-01-30 10:00:00' }],
          course_units_grades: {
            ALG_C: [{ value_symbol: 'zal' }],
          },
        },
      },
    },
  });

  assert.equal(grades.length, 3);
  assert.deepEqual(grades.map((grade) => grade.subjectName), ['Algebra', 'Algebra', 'Fizyka']);
  assert.equal(grades[0].type, 'Ocena końcowa');
  assert.equal(grades[1].type, 'Zaliczenie');
  assert.equal(grades[2].grade, '');
  assert.equal(grades[2].weight, 3);
});

test('maps course-user grade fallback when terms2 has no grade rows', () => {
  const grades = mapGrades({
    termId: '2024Z',
    coursesResponse: {
      course_editions: {
        '2024Z': [
          {
            course_id: 'ALG',
            course_name: { pl: 'Algebra' },
            grades: [{ value_symbol: '5.0', date_acquisition: '2025-01-30 10:00:00' }],
          },
        ],
      },
    },
    ectsResponse: {},
    gradesResponse: { '2024Z': {} },
  });

  assert.equal(grades.length, 1);
  assert.equal(grades[0].subjectName, 'Algebra');
  assert.equal(grades[0].grade, '5.0');
  assert.equal(grades[0].type, 'Ocena końcowa');
});

test('normalizes finance balance signs', () => {
  const records = mapFinanceRecords([
    {
      id: '1',
      description: { pl: 'Czesne' },
      saldo_amount: '250.00',
      total_amount: '500.00',
      currency: 'PLN',
      payment_deadline: '2026-05-31',
      account_number: '1234567890',
    },
    {
      id: '2',
      description: { pl: 'Nadplata' },
      saldo_amount: '20.00',
      state: 'overpaid',
      total_amount: '20.00',
    },
    {
      id: '3',
      description: { pl: 'Rozliczone' },
      saldo_amount: '10.00',
      state: 'paid',
      total_amount: '10.00',
    },
  ]);

  assert.equal(records[0].balanceValue, -250);
  assert.equal(records[1].balanceValue, 20);
  assert.equal(records[2].balanceValue, 0);
});

test('keeps fallback student details visible without programme data', () => {
  const payload = mapInfoPayload({
    user: { studentNumber: '57796' },
    selectedProgramme: null,
    programmes: [],
    cards: [],
    calendarEvents: [],
    activeTerm: null,
  });

  assert.equal(payload.details.album, '57796');
  assert.equal(payload.details.kierunek, '');
  assert.deepEqual(payload.history, []);
});

test('sanitizes dangerous news HTML', () => {
  const html = sanitizeHtml('<p onclick="x()">Hej <a href="javascript:alert(1)">link</a><script>alert(1)</script><img src="https://usosapi.zut.edu.pl/a.jpg" onerror="x()"></p>');

  assert.equal(html.includes('onclick'), false);
  assert.equal(html.includes('javascript:'), false);
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('onerror'), false);
  assert.equal(html.includes('https://usosapi.zut.edu.pl/a.jpg'), true);
});

test('maps and sanitizes USOS news items', () => {
  const items = mapNewsItems({
    items: [
      {
        article: {
          id: 42,
          publication_date: '2026-05-13 12:00:00',
          title: { pl: 'Komunikat' },
          headline_html: { pl: '<p>Krótki <strong>opis</strong></p>' },
          content_html: { pl: '<p>Treść</p><script>alert(1)</script>' },
          image_urls: { '720x405': 'https://usosapi.zut.edu.pl/news.jpg' },
        },
      },
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 42);
  assert.equal(items[0].title, 'Komunikat');
  assert.equal(items[0].contentHtml.includes('<script'), false);
  assert.equal(items[0].thumbUrl, 'https://usosapi.zut.edu.pl/news.jpg');
});
