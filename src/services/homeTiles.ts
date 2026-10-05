import type { DrawerScreenKey } from '../app/viewTypes';
export interface HomeTile {
  id: string; title: string; description: string; icon: string;
  action: DrawerScreenKey | 'search' | 'url'; value?: string; color?: string; wide?: boolean;
}
export const defaults: HomeTile[] = [
  { id: 'plan', title: 'Plan zajęć', description: 'Dzień, tydzień i miesiąc.', icon: 'calendar', action: 'plan' },
  { id: 'grades', title: 'Oceny', description: 'Średnia, ECTS i zaliczenia.', icon: 'grade', action: 'grades' },
  { id: 'info', title: 'Informacje o studiach', description: 'Status i przebieg studiów.', icon: 'layers', action: 'info' },
  { id: 'news', title: 'Aktualności uczelni', description: 'Komunikaty z uczelni.', icon: 'news', action: 'news' },
];
const actions = new Set(['home', 'plan', 'grades', 'finance', 'info', 'news', 'links', 'settings', 'about', 'search', 'url']);
export function validHomeTiles(value: unknown): value is HomeTile[] {
  if (!Array.isArray(value) || value.length > 24) return false;
  const ids = new Set<string>();
  return value.every((tile) => {
    if (!tile || typeof tile !== 'object' || typeof tile.id !== 'string' || !tile.id.trim() || tile.id.length > 80 || ids.has(tile.id)
      || typeof tile.title !== 'string' || !tile.title.trim() || tile.title.length > 40 || typeof tile.description !== 'string' || tile.description.length > 90
      || typeof tile.icon !== 'string' || tile.icon.length > 40 || !actions.has(tile.action)
      || (tile.color !== undefined && (typeof tile.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(tile.color)))
      || (tile.value !== undefined && (typeof tile.value !== 'string' || tile.value.length > 300))
      || (tile.wide !== undefined && typeof tile.wide !== 'boolean')) return false;
    if (tile.action === 'url' && !/^https:\/\//i.test(tile.value || '')) return false;
    ids.add(tile.id); return true;
  });
}
export function loadHomeTiles(userId: string): HomeTile[] {
  try {
    const stored = JSON.parse(localStorage.getItem(`zutnik_home:${userId}`) || 'null');
    return validHomeTiles(stored) ? stored : defaults;
  } catch { return defaults; }
}
