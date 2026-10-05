import type { AppSettings } from './storage';
import { validHomeTiles, type HomeTile } from './homeTiles';

export interface SettingsBackup { version: 1; settings: AppSettings; tiles?: HomeTile[]; filters?: string[]; }
export function parseSettingsBackup(raw: string): SettingsBackup {
  if (raw.length > 100_000) throw new Error('Plik ustawień jest zbyt duży.');
  const value = JSON.parse(raw);
  const settings = value?.settings;
  if (value?.version !== 1 || !settings || !['pl', 'en'].includes(settings.language) || !['system', 'dark', 'light'].includes(settings.theme)
    || typeof settings.compactPlan !== 'boolean' || typeof settings.gradesGrouping !== 'boolean') throw new Error('Nieprawidłowy plik ustawień ZUTnika.');
  if (value.tiles !== undefined && !validHomeTiles(value.tiles)) throw new Error('Nieprawidłowe kafelki w pliku ustawień.');
  if (value.filters !== undefined && (!Array.isArray(value.filters) || value.filters.length > 200 || value.filters.some((key: unknown) => typeof key !== 'string' || key.length > 200))) throw new Error('Nieprawidłowe filtry.');
  return { version: 1, settings: { language: settings.language, theme: settings.theme, compactPlan: settings.compactPlan, gradesGrouping: settings.gradesGrouping, notificationsEnabled: settings.notificationsEnabled === true, refreshMinutes: 30 },
    tiles: value.tiles, filters: value.filters };
}
