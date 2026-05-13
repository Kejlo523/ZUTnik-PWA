import type { Dispatch, SetStateAction } from 'react';

import type { NewsItem, UsefulLink } from '../../types';
import type { AppSettings } from '../../services/storage';
import type { TranslateFn } from '../viewTypes';
import { LOGO_SRC } from '../constants';
import { Ic, Skeleton, Toggle } from '../ui';

const NEWS_HTML_ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'h2', 'h3', 'h4']);
const NEWS_HTML_TEXTLESS_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math']);

function isSafeNewsUrl(value: string, image = false): string {
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === 'http:' || url.protocol === 'https:' || (!image && url.protocol === 'mailto:')) {
      return url.href;
    }
  } catch {
    return '';
  }
  return '';
}

function sanitizeNewsHtml(html: string): string {
  if (!html.trim()) return '';

  const template = document.createElement('template');
  template.innerHTML = html;

  const sanitizeNode = (node: Node) => {
    if (!(node instanceof Element)) return;

    for (const child of Array.from(node.childNodes)) {
      sanitizeNode(child);
    }

    const tag = node.tagName.toLowerCase();
    if (NEWS_HTML_TEXTLESS_TAGS.has(tag)) {
      node.remove();
      return;
    }

    if (!NEWS_HTML_ALLOWED_TAGS.has(tag)) {
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }

    const previous = new Map(Array.from(node.attributes).map((attr) => [attr.name.toLowerCase(), attr.value]));
    for (const attr of Array.from(node.attributes)) {
      node.removeAttribute(attr.name);
    }

    if (tag === 'a') {
      const href = isSafeNewsUrl(previous.get('href') || '');
      if (href) {
        node.setAttribute('href', href);
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noreferrer');
      }
      const title = previous.get('title');
      if (title) node.setAttribute('title', title);
    }

    if (tag === 'img') {
      const src = isSafeNewsUrl(previous.get('src') || '', true);
      if (!src) {
        node.remove();
        return;
      }
      node.setAttribute('src', src);
      node.setAttribute('alt', previous.get('alt') || '');
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
    }
  };

  for (const child of Array.from(template.content.childNodes)) {
    sanitizeNode(child);
  }

  return template.innerHTML;
}

function NewsLoadingSkeleton() {
  return (
    <div className="list-stack news-skeleton-grid">
      {Array.from({ length: 6 }).map((_, idx) => (
        <div key={idx} className="news-card news-card-skeleton" aria-hidden>
          <Skeleton className="news-thumb news-thumb-skeleton" />
          <div className="news-content news-content-skeleton">
            <Skeleton className="skeleton-line skeleton-line-md" style={{ width: idx % 2 === 0 ? '82%' : '74%' }} />
            <Skeleton className="skeleton-line skeleton-line-xs" style={{ width: '28%' }} />
            <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '96%' }} />
            <Skeleton className="skeleton-line skeleton-line-sm" style={{ width: '72%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface NewsScreenProps {
  newsLoading: boolean;
  news: NewsItem[];
  t: TranslateFn;
  onOpenDetail: (item: NewsItem) => void;
}

export function NewsScreen({ newsLoading, news, t, onOpenDetail }: NewsScreenProps) {
  const showNewsSkeleton = newsLoading && news.length === 0;

  return (
    <section className="screen news-screen">
      {showNewsSkeleton && <NewsLoadingSkeleton />}
      {!newsLoading && news.length === 0 && (
        <div className="empty-state"><div className="empty-state-icon">📰</div><p>{t('news.empty')}</p></div>
      )}
      {!showNewsSkeleton && (
        <div className="list-stack">
          {news.map((item) => (
            <button key={item.id} type="button" className="news-card" onClick={() => onOpenDetail(item)}>
              {item.thumbUrl ? (
                <img src={item.thumbUrl} alt="" className="news-thumb" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).replaceWith(Object.assign(document.createElement('div'), { className: 'news-thumb-placeholder', innerHTML: '<svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H4a2 2 0 00-2 2v16a2 2 0 002 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2"/><path fill="currentColor" d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/></svg>' })); }} />
              ) : (
                <div className="news-thumb-placeholder"><Ic n="news" /></div>
              )}
              <div className="news-content">
                <div className="news-title">{item.title}</div>
                <div className="news-date">{item.date}</div>
                <div className="news-snippet">{item.snippet}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

interface NewsDetailScreenProps {
  item?: NewsItem;
  t: TranslateFn;
}

export function NewsDetailScreen({ item, t }: NewsDetailScreenProps) {
  if (!item) {
    return <section className="screen news-detail-screen"><div className="empty-state"><p>{t('newsDetail.noContent')}</p></div></section>;
  }

  const fullHtml = sanitizeNewsHtml(item.contentHtml || item.descriptionHtml);

  return (
    <section className="screen news-detail-screen">
      <div className="card">
        <div className="news-detail-title">{item.title}</div>
        <div className="news-detail-date">{item.date}</div>
        {item.thumbUrl && <img src={item.thumbUrl} alt="" className="news-detail-img" loading="lazy" decoding="async" crossOrigin="anonymous" />}
        {fullHtml ? (
          <div className="news-detail-body" dangerouslySetInnerHTML={{ __html: fullHtml }} />
        ) : (
          <div className="news-detail-body">{item.descriptionText || item.snippet}</div>
        )}
      </div>
      {item.link && (
        <a href={item.link} target="_blank" rel="noreferrer" className="news-source-btn">
          {t('newsDetail.openBrowser')} ↗
        </a>
      )}
    </section>
  );
}

interface LinksScreenProps {
  links: UsefulLink[];
  t: TranslateFn;
}

export function LinksScreen({ links, t }: LinksScreenProps) {
  const globals = links.filter((l) => l.scope === 'GLOBAL');
  const faculties = links.filter((l) => l.scope === 'FACULTY');

  return (
    <section className="screen links-screen">
      {faculties.length > 0 && <div className="link-category">{t('links.faculty')}</div>}
      {faculties.map((l) => (
        <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="link-card">
          <div className="link-card-title">{l.title}</div>
          <div className="link-card-desc">{l.description}</div>
        </a>
      ))}
      <div className="link-category">{t('links.university')}</div>
      {globals.map((l) => (
        <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="link-card">
          <div className="link-card-title">{l.title}</div>
          <div className="link-card-desc">{l.description}</div>
        </a>
      ))}
    </section>
  );
}

interface SettingsScreenProps {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  t: TranslateFn;
}

export function SettingsScreen({ settings, setSettings, t }: SettingsScreenProps) {
  const summaryItems = [
    {
      icon: 'user',
      label: t('settings.language'),
      value: settings.language === 'pl' ? 'Polski' : 'English',
    },
    {
      icon: 'clock',
      label: t('settings.refresh'),
      value: `${settings.refreshMinutes} min`,
    },
    {
      icon: 'calendar',
      label: t('settings.compactPlan'),
      value: settings.compactPlan ? t('settings.stateOn') : t('settings.stateOff'),
    },
    {
      icon: 'grade',
      label: t('settings.gradeGroup'),
      value: settings.gradesGrouping ? t('settings.stateOn') : t('settings.stateOff'),
    },
  ] as const;

  return (
    <section className="screen settings-screen">
      <aside className="settings-side-card">
        <div className="settings-side-icon"><Ic n="settings" /></div>
        <div className="settings-side-eyebrow">{t('settings.desktopEyebrow')}</div>
        <div className="settings-side-title">{t('settings.desktopTitle')}</div>
        <div className="settings-side-copy">{t('settings.desktopCopy')}</div>

        <div className="settings-side-grid">
          {summaryItems.map((item) => (
            <div key={item.label} className="settings-side-item">
              <div className="settings-side-item-icon"><Ic n={item.icon} /></div>
              <div className="settings-side-item-copy">
                <div className="settings-side-item-label">{item.label}</div>
                <div className="settings-side-item-value">{item.value}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="settings-main">
        <div className="settings-card settings-section-card">
          <div className="settings-card-head">
            <div className="settings-card-kicker">{t('settings.sectionInterface')}</div>
            <div className="settings-card-title">{t('settings.sectionInterface')}</div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">{t('settings.language')}</div>
              <div className="settings-row-sub">{t('settings.languageSub')}</div>
            </div>
            <select value={settings.language} onChange={(e) => setSettings((p) => ({ ...p, language: e.target.value as 'pl' | 'en' }))}>
              <option value="pl">Polski</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">{t('settings.refresh')}</div>
              <div className="settings-row-sub">{t('settings.refreshSub')}</div>
            </div>
            <select value={settings.refreshMinutes} onChange={(e) => setSettings((p) => ({ ...p, refreshMinutes: Number(e.target.value) as 30 | 60 | 120 }))}>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
              <option value={120}>120 min</option>
            </select>
          </div>
        </div>

        <div className="settings-card settings-section-card">
          <div className="settings-card-head">
            <div className="settings-card-kicker">{t('settings.sectionViews')}</div>
            <div className="settings-card-title">{t('settings.sectionViews')}</div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">{t('settings.compactPlan')}</div>
              <div className="settings-row-sub">{t('settings.compactPlanSub')}</div>
            </div>
            <Toggle checked={settings.compactPlan} onChange={(v) => setSettings((p) => ({ ...p, compactPlan: v }))} />
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">{t('settings.gradeGroup')}</div>
              <div className="settings-row-sub">{t('settings.gradeGroupSub')}</div>
            </div>
            <Toggle checked={settings.gradesGrouping} onChange={(v) => setSettings((p) => ({ ...p, gradesGrouping: v }))} />
          </div>
        </div>
      </div>
    </section>
  );
}

interface AboutScreenProps {
  canOfferInstall: boolean;
  handleInstallPwa: () => Promise<void> | void;
  isIosSafari: boolean;
  t: TranslateFn;
}

export function AboutScreen({ canOfferInstall, handleInstallPwa, isIosSafari, t }: AboutScreenProps) {
  return (
    <section className="screen about-screen">
      <div className="about-overview">
        <div className="about-hero card">
          <div className="about-hero-head">
            <img src={LOGO_SRC} alt="Logo ZUTnik" className="about-logo-img" />
            <div className="about-hero-copy">
              <div className="about-app-name">ZUTnik</div>
              <div className="about-version">2.0 (PWA)</div>
              <div className="about-note">{t('about.pwaNote')}</div>
            </div>
          </div>

          {canOfferInstall && (
            <button type="button" className="about-action-card about-install-card" onClick={() => void handleInstallPwa()}>
              <div className="about-action-icon">📲</div>
              <div className="about-action-content">
                <div className="about-action-title">{t('about.installApp')}</div>
                <div className="about-action-desc">
                  {isIosSafari ? t('about.installIos') : t('about.installAndroid')}
                </div>
              </div>
              <div className="about-action-arrow">→</div>
            </button>
          )}
        </div>

        <div className="about-description card">
          <p>{t('about.description')}</p>
          <p className="about-signoff">Made with ❤️ by Kejlo</p>
        </div>
      </div>

      <div className="about-panels">
        <div className="about-actions">
          <a href="https://github.com/Kejlo523" target="_blank" rel="noreferrer" className="about-action-card">
            <div className="about-action-icon">📝</div>
            <div className="about-action-content">
              <div className="about-action-title">{t('about.sourceCode')}</div>
              <div className="about-action-desc">{t('about.sourceDesc')}</div>
            </div>
            <div className="about-action-arrow">→</div>
          </a>
        </div>

        <div className="about-links">
          <a href="https://endozero.pl" target="_blank" rel="noreferrer" className="about-link-item">
            <span className="about-link-icon">ℹ️</span>
            <span className="about-link-text">{t('about.projectSite')}</span>
            <span className="about-link-arrow">→</span>
          </a>

          <a href="https://endozero.pl" target="_blank" rel="noreferrer" className="about-link-item">
            <span className="about-link-icon">👤</span>
            <span className="about-link-text">{t('about.authorSite')}</span>
            <span className="about-link-arrow">→</span>
          </a>

          <a href="https://endozero.pl" target="_blank" rel="noreferrer" className="about-link-item">
            <span className="about-link-icon">🔒</span>
            <span className="about-link-text">{t('about.privacyPolicy')}</span>
            <span className="about-link-arrow">→</span>
          </a>

          <a href="mailto:kejlo@endozero.pl" className="about-link-item">
            <span className="about-link-icon">📧</span>
            <span className="about-link-text">E-mail: kejlo@endozero.pl</span>
            <span className="about-link-arrow">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}
