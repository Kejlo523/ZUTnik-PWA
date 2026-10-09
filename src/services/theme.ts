export const THEME_OPTIONS = ['system', 'light', 'dark', 'pink', 'custom'] as const;
export type ThemePreference = typeof THEME_OPTIONS[number];

export interface CustomPalette {
  accent: string;
  background: string;
  surface: string;
  text: string;
  lecture: string;
  laboratory: string;
  exercises: string;
}

export const DEFAULT_PALETTE: Readonly<CustomPalette> = {
  accent: '#087f73', background: '#f4f6f7', surface: '#ffffff', text: '#172026',
  lecture: '#b9c8e8', laboratory: '#d7bce2', exercises: '#a9ddd5',
};
export const PINK_PALETTE: Readonly<CustomPalette> = {
  accent: '#ff008c', background: '#ffd6eb', surface: '#fff6fb', text: '#381225',
  lecture: '#ffc5e3', laboratory: '#d9b6ff', exercises: '#a7e3d6',
};
export const PALETTE_PRESETS = [
  { id: 'light', colors: DEFAULT_PALETTE },
  { id: 'pink', colors: PINK_PALETTE },
  { id: 'mint', colors: { ...DEFAULT_PALETTE, accent: '#008565', background: '#edf9f4', surface: '#fafffd', text: '#163a30' } },
  { id: 'blue', colors: { ...DEFAULT_PALETTE, accent: '#2161e8', background: '#eef4ff', surface: '#ffffff', text: '#182943' } },
] as const;

const HEX_COLOR = /^#[\da-f]{6}$/i;
const paletteKeys = Object.keys(DEFAULT_PALETTE) as Array<keyof CustomPalette>;
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_OPTIONS.some((theme) => theme === value);
}
export function isValidPalette(value: unknown): value is CustomPalette {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const palette = value as Record<string, unknown>;
  return paletteKeys.every((key) => typeof palette[key] === 'string' && HEX_COLOR.test(palette[key]));
}
export function normalizePalette(value: unknown): CustomPalette {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(paletteKeys.map((key) => [key,
    typeof source[key] === 'string' && HEX_COLOR.test(source[key]) ? source[key].toLowerCase() : DEFAULT_PALETTE[key],
  ])) as unknown as CustomPalette;
}

function rgb(color: string): number[] {
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
}
function mix(from: string, to: string, amount: number): string {
  const target = rgb(to);
  return '#' + rgb(from).map((channel, index) => Math.round(channel + (target[index] - channel) * amount).toString(16).padStart(2, '0')).join('');
}
function luminance(color: string): number {
  return rgb(color).reduce((sum, channel, index) => {
    const srgb = channel / 255;
    return sum + (srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index];
  }, 0);
}
export function contrastRatio(first: string, second: string): number {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

// Preserve the chosen hue when possible, but keep labels readable on their actual surface.
function readableColor(preferred: string, backgrounds: string[], minimum = 4.5): string {
  const contrast = (color: string) => Math.min(...backgrounds.map((background) => contrastRatio(color, background)));
  if (contrast(preferred) >= minimum) return preferred;
  const target = contrast('#000000') >= contrast('#ffffff') ? '#000000' : '#ffffff';
  for (let step = 1; step <= 20; step++) {
    const color = mix(preferred, target, step / 20);
    if (contrast(color) >= minimum) return color;
  }
  return target;
}

function foregroundTokens(palette: CustomPalette, background: string, soft: string): Record<string, string> {
  const backgrounds = [background, soft];
  const text = readableColor(palette.text, backgrounds, 7);
  return {
    text, 'text-soft': readableColor(mix(text, background, .18), backgrounds),
    muted: readableColor(mix(text, background, .4), backgrounds),
    primary: readableColor(palette.accent, backgrounds),
    'primary-dark': readableColor(mix(palette.accent, '#000000', .2), backgrounds),
    border: mix(background, text, .3), 'border-soft': mix(background, text, .14),
    success: readableColor('#24855f', backgrounds), danger: readableColor('#c94444', backgrounds),
    warning: readableColor('#956812', backgrounds),
  };
}

export function paletteTokens(value: CustomPalette): Record<string, string> {
  const palette = normalizePalette(value);
  const backgroundSoft = mix(palette.background, palette.accent, .04);
  const surfaceSoft = mix(palette.surface, palette.accent, .08);
  const tokens: Record<string, string> = {
    '--mz-bg': palette.background, '--mz-bg-soft': backgroundSoft,
    '--mz-card': palette.surface, '--mz-surface': palette.surface, '--mz-card-soft': surfaceSoft,
    '--mz-accent': palette.accent, '--mz-on-primary': readableColor('#ffffff', [palette.accent]),
    '--mz-primary-10': palette.accent + '1a', '--mz-primary-20': palette.accent + '33',
    '--mz-danger-10': '#c944441a', '--mz-now': '#d73244',
    '--ev-lecture': palette.lecture, '--ev-lab': palette.laboratory, '--ev-auditory': palette.exercises,
    '--ev-lecture-text': readableColor(palette.text, [palette.lecture], 7),
    '--ev-lab-text': readableColor(palette.text, [palette.laboratory], 7),
    '--ev-auditory-text': readableColor(palette.text, [palette.exercises], 7),
  };
  for (const [name, color] of Object.entries(foregroundTokens(palette, palette.background, backgroundSoft))) tokens[`--mz-${name}`] = color;
  for (const [name, color] of Object.entries(foregroundTokens(palette, palette.surface, surfaceSoft))) tokens[`--palette-surface-${name}`] = color;
  tokens['--stats-new'] = readableColor('#956812', [palette.background]);
  tokens['--stats-logins'] = readableColor('#586e9b', [palette.background]);
  return tokens;
}

const ownedTokens = Object.keys(paletteTokens(DEFAULT_PALETTE));
export function applyThemePreference(theme: ThemePreference, customPalette?: CustomPalette): void {
  const root = document.documentElement;
  const variant = theme === 'pink' || theme === 'custom';
  const resolvedTheme = theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    : theme === 'dark' ? 'dark' : 'light';
  root.dataset.theme = resolvedTheme;
  if (variant) {
    root.dataset.themeVariant = theme;
    const tokens = paletteTokens(theme === 'pink' ? PINK_PALETTE : normalizePalette(customPalette));
    for (const [name, color] of Object.entries(tokens)) root.style.setProperty(name, color);
  } else {
    delete root.dataset.themeVariant;
    for (const name of ownedTokens) root.style.removeProperty(name);
  }
  // Page metadata overrides the manifest's launch color in supported browsers.
  const chromeColor = getComputedStyle(root).getPropertyValue('--mz-bg').trim();
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor && chromeColor && themeColor.content !== chromeColor) themeColor.content = chromeColor;
  const colorScheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (colorScheme && colorScheme.content !== resolvedTheme) colorScheme.content = resolvedTheme;
}
