import { DEFAULT_PALETTE, normalizePalette, PALETTE_PRESETS, type CustomPalette } from '../../services/theme';
import type { TranslateFn } from '../viewTypes';
import { Ic } from '../ui';

export function CustomPaletteEditor({ value, onChange, t }: {
  value?: CustomPalette; onChange: (palette: CustomPalette) => void; t: TranslateFn;
}) {
  const palette = normalizePalette(value);
  const colorField = (key: keyof CustomPalette) => <label className="palette-color-field" key={key}>
    <span>{t(`settings.color${key[0].toUpperCase()}${key.slice(1)}`)}<small>{palette[key].toUpperCase()}</small></span>
    <input type="color" value={palette[key]} aria-label={t(`settings.color${key[0].toUpperCase()}${key.slice(1)}`)}
      onChange={(event) => onChange({ ...palette, [key]: event.target.value })} />
  </label>;
  return <div className="custom-palette" role="group" aria-label={t('settings.palette')}>
    <div className="palette-heading"><h3>{t('settings.palette')}</h3>
      <button type="button" className="icon-btn" aria-label={t('settings.paletteReset')} title={t('settings.paletteReset')}
        onClick={() => onChange({ ...DEFAULT_PALETTE })}><Ic n="refresh" /></button>
    </div>
    <div className="palette-presets" role="group" aria-label={t('settings.palettePresets')}>
      {PALETTE_PRESETS.map((preset) => {
        const selected = Object.keys(palette).every((key) => palette[key as keyof CustomPalette] === preset.colors[key as keyof CustomPalette]);
        return <button type="button" key={preset.id} aria-pressed={selected} aria-label={t(`settings.palette${preset.id[0].toUpperCase()}${preset.id.slice(1)}`)}
          title={t(`settings.palette${preset.id[0].toUpperCase()}${preset.id.slice(1)}`)} onClick={() => onChange({ ...preset.colors })}>
          {[preset.colors.accent, preset.colors.background, preset.colors.text].map((color, index) => <i key={index} style={{ backgroundColor: color }} />)}
          {selected && <span className="palette-preset-check"><Ic n="check" /></span>}
        </button>;
      })}
    </div>
    <fieldset className="palette-fields"><legend>{t('settings.paletteInterface')}</legend>
      {(['accent', 'background', 'surface', 'text'] as const).map(colorField)}
    </fieldset>
    <fieldset className="palette-fields"><legend>{t('settings.paletteTimetable')}</legend>
      {(['lecture', 'laboratory', 'exercises'] as const).map(colorField)}
    </fieldset>
  </div>;
}
