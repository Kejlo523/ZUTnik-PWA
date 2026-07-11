import type { ScreenKey } from '../types';
import { Ic } from './ui';
import type { DrawerScreenKey, TranslateFn } from './viewTypes';

interface AppNavigationProps {
  screen: ScreenKey;
  t: TranslateFn;
  openScreen: (screen: DrawerScreenKey) => void;
  onMore: () => void;
}

const PRIMARY_ITEMS = [
  { key: 'home' as const, icon: 'home', labelKey: 'nav.home' },
  { key: 'plan' as const, icon: 'calendar', labelKey: 'nav.plan' },
  { key: 'info' as const, icon: 'user', labelKey: 'nav.info' },
  { key: 'grades' as const, icon: 'grade', labelKey: 'nav.grades' },
];

export function AppNavigation({ screen, t, openScreen, onMore }: AppNavigationProps) {
  const primaryActive = PRIMARY_ITEMS.some((item) => item.key === screen);

  return (
    <nav className="primary-navigation" aria-label={t('nav.label')}>
      {PRIMARY_ITEMS.map((item) => {
        const active = screen === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={`primary-navigation-item${active ? ' is-active' : ''}`}
            onClick={() => openScreen(item.key)}
            aria-current={active ? 'page' : undefined}
            title={t(item.labelKey)}
          >
            <span className="primary-navigation-icon"><Ic n={item.icon} /></span>
            <span className="primary-navigation-label">{t(item.labelKey)}</span>
          </button>
        );
      })}

      <button
        type="button"
        className={`primary-navigation-item${primaryActive ? '' : ' is-active'}`}
        onClick={onMore}
        aria-expanded={undefined}
        title={t('nav.more')}
      >
        <span className="primary-navigation-icon"><Ic n="more" /></span>
        <span className="primary-navigation-label">{t('nav.more')}</span>
      </button>
    </nav>
  );
}
