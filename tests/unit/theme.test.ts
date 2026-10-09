import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyThemePreference, contrastRatio, DEFAULT_PALETTE, isValidPalette, normalizePalette, paletteTokens, PINK_PALETTE } from '../../src/services/theme';
import { loadSettings, saveSettings } from '../../src/services/storage';
import { parseSettingsBackup } from '../../src/services/settingsBackup';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('style'); });

describe('light-based palettes', () => {
  it('accepts only complete hex colors and whitelisted palette fields', () => {
    expect(normalizePalette({ accent: '#ABC123', background: 'url(https://example.org)', text: '#000', secret: 'no' }))
      .toEqual({ ...DEFAULT_PALETTE, accent: '#abc123' });
    for (const value of [null, [], 'pink', { accent: '#ffffff' }, { ...DEFAULT_PALETTE, text: 'red' }]) expect(isValidPalette(value)).toBe(false);
    expect(isValidPalette(PINK_PALETTE)).toBe(true);
  });

  it('keeps vivid accent fills but derives readable labels and event text', () => {
    for (const palette of [PINK_PALETTE, DEFAULT_PALETTE, { ...DEFAULT_PALETTE, accent: '#ffff00', text: '#ffffff', lecture: '#000000' },
      { ...DEFAULT_PALETTE, background: '#ffffff', surface: '#000000', text: '#ffffff', accent: '#ff00ff' }]) {
      const tokens = paletteTokens(palette);
      expect(tokens['--mz-accent']).toBe(palette.accent);
      expect(contrastRatio(tokens['--mz-on-primary'], palette.accent)).toBeGreaterThanOrEqual(4.5);
      for (const name of ['text', 'text-soft', 'muted', 'primary', 'success', 'danger']) {
        expect(contrastRatio(tokens[`--mz-${name}`], palette.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(tokens[`--palette-surface-${name}`], palette.surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(tokens['--ev-lecture-text'], palette.lecture)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps separate preset and custom settings across reloads', () => {
    const settings = loadSettings();
    saveSettings({ ...settings, theme: 'pink', customPalette: { ...DEFAULT_PALETTE, accent: '#d01040' } });
    expect(loadSettings()).toMatchObject({ theme: 'pink', customPalette: { accent: '#d01040' } });
    saveSettings({ ...loadSettings(), theme: 'custom' });
    expect(loadSettings()).toMatchObject({ theme: 'custom', customPalette: { accent: '#d01040' } });
    localStorage.setItem('zutnik_pwa_settings', JSON.stringify({ theme: 'unknown', customPalette: { accent: 'url(bad)' } }));
    expect(loadSettings()).toMatchObject({ theme: 'system', customPalette: DEFAULT_PALETTE });
  });

  it('imports old backups, exports new palettes, and rejects unsafe colors', () => {
    const settings = { language: 'pl', theme: 'light', compactPlan: false, gradesGrouping: true };
    expect(parseSettingsBackup(JSON.stringify({ version: 1, settings })).settings.customPalette).toEqual(DEFAULT_PALETTE);
    const backup = parseSettingsBackup(JSON.stringify({ version: 1, settings: { ...settings, theme: 'custom', customPalette: { ...PINK_PALETTE, accessToken: 'no' } } }));
    expect(backup.settings).toMatchObject({ theme: 'custom', customPalette: PINK_PALETTE });
    expect(backup.settings.customPalette).not.toHaveProperty('accessToken');
    expect(() => parseSettingsBackup(JSON.stringify({ version: 1, settings: { ...settings, theme: 'pink', customPalette: { ...PINK_PALETTE, accent: 'url(bad)' } } }))).toThrow();
  });

  it('uses light scheme for Pink and Custom even with a dark OS, without leaking overrides into default themes', () => {
    const query = vi.spyOn(window, 'matchMedia');
    document.head.innerHTML = '<meta name="theme-color"><meta name="color-scheme">';
    try {
      applyThemePreference('pink');
      expect(document.documentElement.dataset).toMatchObject({ theme: 'light', themeVariant: 'pink' });
      expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe(PINK_PALETTE.background);
      expect(document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content).toBe('light');
      applyThemePreference('custom', { ...DEFAULT_PALETTE, background: '#eef4ff' });
      expect(document.documentElement.style.getPropertyValue('--mz-bg')).toBe('#eef4ff');
      applyThemePreference('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.dataset.themeVariant).toBeUndefined();
      expect(document.documentElement.style.getPropertyValue('--mz-bg')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--mz-accent')).toBe('');
      expect(query).not.toHaveBeenCalled();
    } finally { query.mockRestore(); }
  });
});
