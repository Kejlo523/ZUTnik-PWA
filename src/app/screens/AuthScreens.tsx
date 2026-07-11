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
    <section className="screen login-screen">
      <div className="login-header">
        <img src={LOGO_SRC} alt="ZUTnik" className="login-logo" />
        <h1 className="login-title">ZUTnik</h1>
      </div>

      <div className="login-card">
        <div className="login-card-title">{t('login.cardTitle')}</div>

        <div className="login-form">
          <button
            type="button"
            className="login-usos-btn"
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
  session: SessionData | null;
  studyLabel: string;
  isOnline: boolean;
  t: TranslateFn;
  openScreen: (screen: DrawerScreenKey) => void;
}

export function HomeScreen({ session, studyLabel, isOnline, t, openScreen }: HomeScreenProps) {
  const firstName = session?.username?.split(' ')[0] ?? 'Student';

  return (
    <section className="screen home-screen">
      <div className="home-scroll-content">
        <div className="home-hero-card">
          <span className="home-hero-rail" aria-hidden />
          <img src={LOGO_SRC} alt="" className="home-hero-logo" />
          <div className="home-hero-greeting-row">
            <div className="home-hero-copy">
              <div className="home-hero-hello">{t('home.hello')}</div>
              {' '}
              <div className="home-hero-name">{firstName}</div>
              {studyLabel && <div className="home-hero-study">{studyLabel}</div>}
            </div>
          </div>

          {!isOnline && (
            <span className="offline-badge"><Ic n="wifi-off" />{t('home.offlineMode')}</span>
          )}
        </div>

        <div className="home-section-heading">
          <div className="home-tiles-label">{t('home.quickAccess')}</div>
          <span aria-hidden />
        </div>
        <div className="tile-grid">
          {([
            { key: 'plan' as const, label: t('home.tilePlan'), desc: t('home.tilePlanDesc'), icon: 'calendar' },
            { key: 'grades' as const, label: t('home.tileGrades'), desc: t('home.tileGradesDesc'), icon: 'grade' },
            { key: 'info' as const, label: t('home.tileInfo'), desc: t('home.tileInfoDesc'), icon: 'user' },
            { key: 'news' as const, label: t('home.tileNews'), desc: t('home.tileNewsDesc'), icon: 'news' },
          ] satisfies Array<{ key: DrawerScreenKey; label: string; desc: string; icon: string }>).map((tile) => (
            <button key={tile.key} type="button" className="tile" onClick={() => openScreen(tile.key)}>
              <div className="tile-icon"><Ic n={tile.icon} /></div>
              <span className="tile-label">{tile.label}</span>
              <span className="tile-desc">{tile.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
