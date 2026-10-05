import { test, type Page } from '@playwright/test';

export const grades = [
  { subjectName: 'Transmisja danych', courseId: 'TD', grade: '3', weight: 3, type: 'Laboratorium', teacher: 'Jan Nowak', date: '2026-06-19' },
  { subjectName: 'Transmisja danych', courseId: 'TD', grade: '2', weight: 3, type: 'Wykład', teacher: 'Jan Nowak', date: '2026-06-26' },
  { subjectName: 'Transmisja danych', courseId: 'TD', grade: '3', weight: 3, type: 'Wykład', teacher: 'Jan Nowak', date: '2026-07-07' },
  { subjectName: 'Matematyka stosowana ze statystyką 2', courseId: 'MA', grade: '4.5', weight: 6, type: 'Ćwiczenia', teacher: 'Jan Nowak', date: '2026-07-08' },
];
export function activePlan(page: Page) { return page.locator('.timetable-page[data-active="true"]'); }
export function rows(start: string) {
  const date = new Date(`${start}T12:00:00Z`);
  return Array.from({ length: 5 }, (_, day) => {
    const current = new Date(date); current.setUTCDate(current.getUTCDate() + day); const ymd = current.toISOString().slice(0, 10);
    return { title: day % 2 ? 'Transmisja danych' : 'Matematyka stosowana ze statystyką 2', subject: day % 2 ? 'Transmisja danych' : 'Matematyka stosowana ze statystyką 2', start: `${ymd}T10:15:00`, end: `${ymd}T12:00:00`, worker: 'Piotr Klęsk', workerTitle: 'dr', lessonForm: 'Wykład', lessonFormShort: 'W', groupName: 'S1_EK_I_W1', tokName: '', room: 'WI WI2, 216', lessonStatus: '', lessonStatusShort: '', sourceId: `event-${ymd}` };
  });
}
export async function fixture(page: Page, routeApi = true) {
  const requests: string[] = [];
  const origin = new URL(String(test.info().project.use.baseURL)).origin;
  await page.context().route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
  await page.addInitScript(() => {
    if (localStorage.getItem('__fixture_initialized')) return;
    localStorage.setItem('__fixture_initialized', 'yes');
    localStorage.setItem('zutnik_install_tip_v1', '1');
    localStorage.setItem('zutnik_pwa_settings', JSON.stringify({ language: 'pl', theme: 'dark', compactPlan: false, gradesGrouping: true, notificationsEnabled: false, refreshMinutes: 30 }));
    localStorage.setItem('zutnik_pwa_session', JSON.stringify({ userId: '99999', username: 'Student Testowy', authKey: '', imageUrl: '', activeStudyId: 'study-1', persistedAt: Date.now(), usos: { accessToken: 'fixture-token', accessTokenSecret: 'fixture-secret', scopes: ['offline_access', 'studies', 'grades', 'payments', 'photo'] } }));
  });
  if (routeApi) await page.context().route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/v2/, ''); requests.push(path);
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    let data: unknown = {};
    if (path.endsWith('/usos/me')) data = { user: { name: 'Student Testowy', studentNumber: '99999' }, programmes: [{ studentProgrammeId: 'study-1', name: 'Informatyka', statusLabel: 'Aktywny' }] };
    else if (path.endsWith('/timetable/week')) data = { data: rows(body.start) };
    else if (path.endsWith('/timetable/catalog')) data = { data: [{ id: '2026/2027-Z', start: '2026-09-28', end: '2027-02-28', groups: [] }] };
    else if (path.endsWith('/timetable/suggest')) data = { data: ['Piotr Klęsk [teacher-1]'] };
    else if (path.endsWith('/usos/grades')) data = { grades };
    else if (path.endsWith('/usos/credits')) data = { summary: { studentProgrammeId: 'study-1', programmeUsed: 92, overallUsed: 92 } };
    else if (path.endsWith('/usos/finance')) data = { records: [{ title: 'Opłata za legitymację', amountText: '22,00 zł', paidText: '0,00 zł', dueDateText: '2026-10-15', paidDateText: null, balanceText: '-22,00 zł', accountText: '00 1234 5678', amountValue: 22, paidValue: 0, balanceValue: -22 }] };
    else if (path.endsWith('/usos/info')) data = { details: { album: '99999', wydzial: 'Wydział Informatyki', kierunek: 'Informatyka', forma: 'Stacjonarne', poziom: 'Pierwszego stopnia', specjalnosc: '', specjalizacja: '', status: 'Aktywny', rokAkademicki: '2026/2027', semestrLabel: '3' }, history: [{ label: 'Semestr 2', status: 'Zaliczony' }], els: { id: 'ELS123', expirationDate: '2027-03-31', isActive: true }, calendarEvents: [] };
    else if (path.endsWith('/proxy/calendar')) data = { periods: [{ key: 'sesja_zimowa', start: '2027-01-25', end: '2027-02-14' }] };
    else if (path.endsWith('/proxy/rss')) data = { xml: '<rss version="2.0"><channel><item><title>Rozpoczęcie nowego semestru</title><link>https://example.edu/news</link><pubDate>Mon, 05 Oct 2026 12:00:00 GMT</pubDate><description>Informacje dla studentów.</description></item></channel></rss>' };
    else if (path.includes('/photo')) { await route.fulfill({ status: 404, body: '' }); return; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  return requests;
}
