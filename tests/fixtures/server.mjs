import express from 'express';
import { rows, grades } from '../browser/fixtures.ts';

// Real local responses cover service-worker fetches which WebKit cannot route.
// This server has no upstream client or credentials and cannot contact a university.
const app = express();
app.use(express.json());
let disconnected = false;
app.post('/__test/connection', (req, res) => { disconnected = req.body.offline === true; res.json({ disconnected }); });
app.use((req, _res, next) => { if (disconnected) req.socket.destroy(); else next(); });
app.use('/v2/api', (req, res) => {
  const path = req.path;
  if (path.endsWith('/usos/me')) return res.json({ user: { name: 'Student Testowy', studentNumber: '99999' }, programmes: [{ studentProgrammeId: 'study-1', name: 'Informatyka', statusLabel: 'Aktywny' }] });
  if (path.endsWith('/usos/grades')) return res.json({ grades });
  if (path.endsWith('/usos/credits')) return res.json({ summary: { studentProgrammeId: 'study-1', programmeUsed: 92, overallUsed: 92 } });
  if (path.endsWith('/usos/finance')) return res.json({ records: [{ title: 'Opłata za legitymację', amountText: '22,00 zł', paidText: '0,00 zł', dueDateText: '2026-10-15', paidDateText: null, balanceText: '-22,00 zł', accountText: '00 1234 5678', amountValue: 22, paidValue: 0, balanceValue: -22 }] });
  if (path.endsWith('/usos/info')) return res.json({ details: { album: '99999', wydzial: 'Wydział Informatyki', kierunek: 'Informatyka', forma: 'Stacjonarne', poziom: 'Pierwszego stopnia', specjalnosc: '', specjalizacja: '', status: 'Aktywny', rokAkademicki: '2026/2027', semestrLabel: '3' }, history: [], els: { id: 'ELS123', expirationDate: '2027-03-31', isActive: true }, calendarEvents: [] });
  if (path.endsWith('/usos/photo')) return res.sendStatus(404);
  if (path.endsWith('/timetable/week')) return res.json({ data: rows(req.body.start) });
  if (path.endsWith('/timetable/catalog')) return res.json({ data: [{ id: '2026/2027-Z', start: '2026-09-28', end: '2027-02-28', groups: [] }] });
  if (path.endsWith('/proxy/calendar')) return res.json({ periods: [] });
  return res.json({});
});
app.use('/v2', express.static('dist'));
app.get('/v2/', (_req, res) => res.sendFile(`${process.cwd()}/dist/index.html`));
app.listen(8879, '127.0.0.1');
