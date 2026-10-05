import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { defaults, loadHomeTiles, type HomeTile } from '../../services/homeTiles';
import { Sheet } from '../components/Sheet';
import type { SessionData } from '../../types';
import type { DrawerScreenKey, TranslateFn } from '../viewTypes';
import { LOGO_SRC } from '../constants';
import { Ic } from '../ui';

interface LoginScreenProps {
  t: TranslateFn;
  loginLoading: boolean;
  onUsosLogin: () => Promise<void> | void;
}

export function LoginScreen({
  t,
  loginLoading,
  onUsosLogin,
}: LoginScreenProps) {
  return (
    <section className={`screen login-screen${loginLoading ? ' is-loading' : ''}`} aria-busy={loginLoading}>
      <div className="login-header">
        <img src={LOGO_SRC} alt="ZUTnik" className="login-logo" />
        <h1 className="login-title">ZUTnik</h1>
      </div>

      <div className="login-card">
        <div className="login-card-title">{t('login.cardTitle')}</div>

        <div className="login-form">
          <button
            type="button"
            className={`login-usos-btn${loginLoading ? ' is-loading' : ''}`}
            onClick={() => void onUsosLogin()}
            disabled={loginLoading}
          >
            <div className="login-usos-icon">U</div>
            {loginLoading ? t('login.loggingIn') : (t('login.usosBtn') || 'Zaloguj przez USOS')}
          </button>

          <p className="login-info-text" style={{ whiteSpace: 'pre-line' }}>
            {t('login.infoText')}
          </p>
        </div>
      </div>
    </section>
  );
}

interface HomeScreenProps {
  session: SessionData | null; studyLabel: string; isOnline: boolean; t: TranslateFn;
  openScreen: (screen: DrawerScreenKey) => void;
  editing: boolean; onEditing: (value: boolean) => void;
  onSearch: (query: string) => void;
}
const colors = ['', '#596e9e', '#63845b', '#526971', '#875157', '#765481', '#34796c'];

export function HomeScreen({ session, studyLabel, t, openScreen, editing, onEditing, onSearch }: HomeScreenProps) {
  const account = session?.userId || '';
  const [tiles, setTiles] = useState(() => loadHomeTiles(account));
  const saved = useRef(tiles);
  const [selected, setSelected] = useState<HomeTile | null>(null);
  const [saveError, setSaveError] = useState('');
  const drag = useRef<{ id: string; x: number; y: number; element: HTMLElement; frame: number } | null>(null);
  const firstName = session?.username?.split(' ')[0] ?? 'Student';

  useEffect(() => () => { if (drag.current?.frame) cancelAnimationFrame(drag.current.frame); }, []);
  const save = () => {
    try {
      localStorage.setItem(`zutnik_home:${account}`, JSON.stringify(tiles));
      saved.current = tiles; onEditing(false); setSaveError('');
    } catch { setSaveError('Brak miejsca na zapisanie kafelków.'); }
  };
  const move = (id: string, offset: number) => setTiles((current) => {
    const from = current.findIndex((tile) => tile.id === id);
    const to = Math.max(0, Math.min(current.length - 1, from + offset));
    const next = [...current]; const [tile] = next.splice(from, 1); next.splice(to, 0, tile); return next;
  });
  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = event.currentTarget.closest<HTMLElement>('[data-tile-id]')!;
    drag.current = { id, x: event.clientX, y: event.clientY, element, frame: 0 };
    element.classList.add('tile-dragging');
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current; if (!active) return;
    cancelAnimationFrame(active.frame);
    const x = event.clientX - active.x, y = event.clientY - active.y;
    active.frame = requestAnimationFrame(() => { active.element.style.transform = `translate3d(${x}px,${y}px,0)`; });
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const active = drag.current; if (!active) return;
    cancelAnimationFrame(active.frame); active.element.style.transform = '';
    active.element.style.pointerEvents = 'none';
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-tile-id]')?.dataset.tileId;
    active.element.style.pointerEvents = ''; active.element.classList.remove('tile-dragging'); drag.current = null;
    if (!cancelled && target && target !== active.id) setTiles((current) => {
      const next = [...current]; const from = next.findIndex((tile) => tile.id === active.id);
      const to = next.findIndex((tile) => tile.id === target);
      const [tile] = next.splice(from, 1); next.splice(to, 0, tile); return next;
    });
  };
  const open = (tile: HomeTile) => {
    if (editing) { setSelected({ ...tile }); return; }
    if (tile.action === 'search') { if (tile.value?.trim()) onSearch(tile.value.trim()); }
    else if (tile.action === 'url') {
      try { const url = new URL(tile.value || ''); if (url.protocol === 'https:') window.open(url.href, '_blank', 'noopener,noreferrer'); } catch { /* Invalid imported links never execute. */ }
    } else openScreen(tile.action);
  };
  const commitTile = () => {
    if (!selected?.title.trim()) return;
    if (selected.action === 'url') { try { if (new URL(selected.value || '').protocol !== 'https:') return; } catch { return; } }
    setTiles((current) => current.some((tile) => tile.id === selected.id) ? current.map((tile) => tile.id === selected.id ? selected : tile) : [...current, selected]);
    setSelected(null);
  };

  return <section className="screen home-screen">
    <div className="home-scroll-content">
      {!editing && <div className="home-hero-card">
        <span className="home-hero-rail" aria-hidden />
        <img src={LOGO_SRC} alt="" className="home-hero-logo" />
        <div className="home-hero-copy"><div className="home-hero-hello">{t('home.hello')}</div>
          <div className="home-hero-name">{firstName}</div>{studyLabel && <div className="home-hero-study">{studyLabel}</div>}
        </div>
      </div>}
      {editing ? <div className="tile-edit-dock">
        <button className="icon-btn" title="Przywróć domyślne kafelki" aria-label="Przywróć domyślne kafelki" onClick={() => setTiles(defaults)}><Ic n="refresh" /></button>
        <button className="icon-btn" title="Dodaj kafelek" aria-label="Dodaj kafelek" disabled={tiles.length >= 24} onClick={() => setSelected({ id: crypto.randomUUID(), title: '', description: '', icon: 'search', action: 'search' })}><Ic n="plus" /></button>
        <button className="text-btn" onClick={() => { setTiles(saved.current); onEditing(false); }}>Anuluj</button>
        <button className="primary-btn" onClick={save}>Zapisz</button>
      </div> : <div className="home-section-heading"><div className="home-tiles-label">{t('home.quickAccess')}</div><span aria-hidden /></div>}
      {saveError && <p role="alert">{saveError}</p>}
      <div className="tile-grid">
        {tiles.map((tile, index) => <article key={tile.id} data-tile-id={tile.id}
          className={`tile${editing ? ' tile-editing' : ''}${tile.color ? ' tile-custom' : ''}${tile.wide ? ' tile-wide' : ''}`}
          style={tile.color ? { background: tile.color } : undefined}>
          <button className="tile-face" onClick={() => open(tile)} aria-label={tile.title || 'Edytuj kafelek'}>
            {!tile.color && <div className="tile-icon"><Ic n={tile.icon} /></div>}
            <span className="tile-label">{tile.title}</span>
            {!!tile.description && <span className="tile-desc">{tile.description}</span>}
          </button>
          {editing && <div className="tile-edit-tools">
            <button className="icon-btn tile-grip" aria-label={`Przenieś ${tile.title}`} title="Przenieś" onPointerDown={(event) => startDrag(event, tile.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={(event) => endDrag(event, true)}><Ic n="grip" /></button>
            <button className="icon-btn" aria-label={`Przesuń wcześniej: ${tile.title}`} title="Wcześniej" disabled={index === 0} onClick={() => move(tile.id, -1)}><Ic n="chevL" /></button>
            <button className="icon-btn" aria-label={`Przesuń później: ${tile.title}`} title="Później" disabled={index === tiles.length - 1} onClick={() => move(tile.id, 1)}><Ic n="chevR" /></button>
            <button className="icon-btn" aria-label={`Zmień rozmiar: ${tile.title}`} title="Zmień rozmiar" aria-pressed={!!tile.wide} onClick={() => setTiles((current) => current.map((item) => item.id === tile.id ? { ...item, wide: !item.wide } : item))}><Ic n="expand" /></button>
          </div>}
        </article>)}
      </div>
      {!editing && <p className="home-footer">Dane są pobierane z systemów uczelni i zapisywane lokalnie. Ważne informacje sprawdzaj także w oficjalnych panelach.</p>}
    </div>
    {selected && <Sheet title={tiles.some((tile) => tile.id === selected.id) ? 'Edytuj kafelek' : 'Nowy kafelek'} onClose={() => setSelected(null)}>
      <div className="tile-preview" style={{ background: selected.color || undefined }}><Ic n={selected.icon} /><strong>{selected.title || 'Nowy kafelek'}</strong><small>{selected.description}</small></div>
      <label className="field-label">Tytuł<input maxLength={40} value={selected.title} onChange={(event) => setSelected({ ...selected, title: event.target.value })} /></label>
      <label className="field-label">Krótki opis<input maxLength={90} value={selected.description} onChange={(event) => setSelected({ ...selected, description: event.target.value })} /></label>
      <label className="field-label">Akcja<select value={selected.action} onChange={(event) => setSelected({ ...selected, action: event.target.value as HomeTile['action'], icon: event.target.value === 'search' ? 'search' : event.target.value === 'url' ? 'link' : 'calendar' })}>
        <option value="plan">Plan zajęć</option><option value="grades">Oceny</option><option value="info">Studia</option><option value="news">Aktualności</option><option value="finance">Finanse</option><option value="search">Wyszukaj w planie</option><option value="url">Otwórz stronę</option>
      </select></label>
      {(selected.action === 'search' || selected.action === 'url') && <label className="field-label">{selected.action === 'search' ? 'Prowadzący / zapytanie' : 'Adres HTTPS'}<input value={selected.value || ''} onChange={(event) => setSelected({ ...selected, value: event.target.value })} /></label>}
      <div className="swatch-row">{colors.map((color) => <button key={color} className={`swatch${(selected.color || '') === color ? ' is-active' : ''}`} style={{ background: color || 'var(--mz-card-soft)' }} aria-label={color || 'Kolor motywu'} aria-pressed={(selected.color || '') === color} onClick={() => setSelected({ ...selected, color })} />)}</div>
      <div className="search-actions">
        {tiles.some((tile) => tile.id === selected.id) && <button className="icon-btn" aria-label="Usuń kafelek" title="Usuń kafelek" onClick={() => { setTiles((current) => current.filter((tile) => tile.id !== selected.id)); setSelected(null); }}><Ic n="trash" /></button>}
        <button className="text-btn" onClick={() => setSelected(null)}>Anuluj</button><button className="primary-btn" disabled={!selected.title.trim() || ((selected.action === 'search' || selected.action === 'url') && !selected.value?.trim())} onClick={commitTile}>Gotowe</button>
      </div>
    </Sheet>}
  </section>;
}
