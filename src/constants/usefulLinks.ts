import type { Study, UsefulLink } from '../types';

export const USEFUL_LINKS: UsefulLink[] = [
  { id: 'wi_students', title: 'WI - Strefa Studenta', url: 'https://www.wi.zut.edu.pl/pl/dla-studenta', description: 'Plany studiów, dyplomowanie i druki.', scope: 'FACULTY', facultyCode: 'WI' },
  { id: 'wi_home', title: 'Wydział Informatyki (WI)', url: 'https://www.wi.zut.edu.pl', description: 'Strona wydziału i ogłoszenia dziekanatu.', scope: 'FACULTY', facultyCode: 'WI' },
  { id: 'wi_quiz', title: 'Quizy z informatyki', url: 'https://quiz.endozero.pl', description: 'Quizy i powtórki z informatyki.', scope: 'FACULTY', facultyCode: 'WI' },
  { id: 'global_plan', title: 'Plan zajęć', url: 'https://plan.zut.edu.pl', description: 'Aktualny rozkład zajęć dla studentów.', scope: 'GLOBAL' },
  { id: 'global_usos', title: 'USOSweb / e-dziekanat', url: 'https://usosweb.zut.edu.pl', description: 'Oceny, zapisy i administracja studiów.', scope: 'GLOBAL' },
  { id: 'global_news', title: 'Aktualności ZUT', url: 'https://www.zut.edu.pl', description: 'Komunikaty i ogłoszenia uczelni.', scope: 'GLOBAL' },
  { id: 'global_library', title: 'Biblioteka Główna', url: 'https://bg.zut.edu.pl', description: 'Katalog książek oraz bazy publikacji.', scope: 'GLOBAL' },
  { id: 'global_osiedle', title: 'Akademiki', url: 'https://osiedlestudenckie.zut.edu.pl', description: 'Opłaty, kwaterowanie i regulaminy DS.', scope: 'GLOBAL' },
  { id: 'global_career', title: 'Biuro Karier', url: 'https://biurokarier.zut.edu.pl', description: 'Oferty pracy, staże i targi.', scope: 'GLOBAL' },
  { id: 'global_moodle', title: 'E-learning ZUT (Moodle)', url: 'https://e-edukacja.zut.edu.pl', description: 'Kursy online i materiały wykładowe.', scope: 'GLOBAL' },
  { id: 'global_mleg', title: 'mLegitymacja', url: 'https://mlegitymacja.zut.edu.pl', description: 'Aktywacja i przedłużanie mLegitymacji.', scope: 'GLOBAL' },
];

function detectFacultyCodes(studies: Study[]): Set<string> {
  const labels = studies.map((s) => s.label.toLowerCase());
  const codes = new Set<string>();

  for (const label of labels) {
    if (label.includes('informatyka')) codes.add('WI');
    if (label.includes('ekonomia')) codes.add('WNEIZ');
    if (label.includes('mechanika')) codes.add('WIMIM');
    if (label.includes('elektrotechnika') || label.includes('automatyka')) codes.add('WE');
    if (label.includes('budownictwo') || label.includes('architektura')) codes.add('WBIA');
  }

  return codes;
}

export function sortUsefulLinks(studies: Study[]): UsefulLink[] {
  const faculties = detectFacultyCodes(studies);
  return [...USEFUL_LINKS].sort((a, b) => {
    const aScore = a.scope === 'FACULTY' ? (faculties.has(a.facultyCode ?? '') ? 0 : 3) : 1;
    const bScore = b.scope === 'FACULTY' ? (faculties.has(b.facultyCode ?? '') ? 0 : 3) : 1;
    if (aScore !== bScore) return aScore - bScore;
    return a.title.localeCompare(b.title, 'pl');
  });
}
