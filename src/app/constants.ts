import type { ScreenKey } from '../types';

const APP_BASE = import.meta.env.BASE_URL;

export const LOGO_SRC = `${APP_BASE}icons/zutnik-logo.png`;

export const SCREEN_I18N_KEY: Record<ScreenKey, string> = {
  login: 'screen.home',
  home: 'screen.home',
  plan: 'screen.plan',
  grades: 'screen.grades',
  finance: 'screen.finance',
  info: 'screen.info',
  news: 'screen.news',
  'news-detail': 'screen.newsDetail',
  links: 'screen.links',
  settings: 'screen.settings',
  about: 'screen.about',
};

export const MONTH_WEEKDAY_KEYS = ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun'];
