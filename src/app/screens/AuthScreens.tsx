import { useMemo } from 'react';
import { loadHomeTiles, type HomeTile } from '../../services/homeTiles';
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
  session: SessionData | null; studyLabel: string; t: TranslateFn;
  openScreen: (screen: DrawerScreenKey) => void;
  onSearch: (query: string) => void;
}
export function HomeScreen({ session, studyLabel, t, openScreen, onSearch }: HomeScreenProps) {
  const account = session?.userId || '';
  const tiles = useMemo(() => loadHomeTiles(account), [account]);
  const firstName = session?.username?.split(' ')[0] ?? 'Student';

  const open = (tile: HomeTile) => {
    if (tile.action === 'search') { if (tile.value?.trim()) onSearch(tile.value.trim()); }
    else if (tile.action === 'url') {
      try { const url = new URL(tile.value || ''); if (url.protocol === 'https:') window.open(url.href, '_blank', 'noopener,noreferrer'); } catch { /* Invalid imported links never execute. */ }
    } else openScreen(tile.action);
  };

  return <section className="screen home-screen">
    <div className="home-scroll-content">
      <div className="home-hero-card">
        <span className="home-hero-rail" aria-hidden />
        <img src={LOGO_SRC} alt="" className="home-hero-logo" />
        <div className="home-hero-copy"><div className="home-hero-hello">{t('home.hello')}</div>
          <div className="home-hero-name">{firstName}</div>{studyLabel && <div className="home-hero-study">{studyLabel}</div>}
        </div>
      </div>
      <div className="home-section-heading"><div className="home-tiles-label">{t('home.quickAccess')}</div><span aria-hidden /></div>
      <div className="tile-grid">
        {tiles.map((tile) => <article key={tile.id} data-tile-id={tile.id}
          className={`tile${tile.color ? ' tile-custom' : ''}${tile.wide ? ' tile-wide' : ''}`}
          style={tile.color ? { background: tile.color } : undefined}>
          <button className="tile-face" onClick={() => open(tile)} aria-label={tile.title}>
            {!tile.color && <div className="tile-icon"><Ic n={tile.icon} /></div>}
            <span className="tile-label">{tile.title}</span>
            {!!tile.description && <span className="tile-desc">{tile.description}</span>}
          </button>
        </article>)}
      </div>
      <p className="home-footer">Dane są pobierane z systemów uczelni i zapisywane lokalnie. Ważne informacje sprawdzaj także w oficjalnych panelach.</p>
    </div>
  </section>;
}
