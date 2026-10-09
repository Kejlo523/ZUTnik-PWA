import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type MutableRefObject, type SetStateAction, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';

import { useOverscrollLock } from '../../hooks/useOverscrollLock';
import type { BackInterceptResult } from '../../hooks/useAppNavigation';

import type { NewsItem, UsefulLink } from '../../types';
import { loadSession, type AppSettings } from '../../services/storage';
import { parseSettingsBackup } from '../../services/settingsBackup';
import { loadHomeTiles } from '../../services/homeTiles';
import { THEME_OPTIONS } from '../../services/theme';
import { CustomPaletteEditor } from '../components/CustomPaletteEditor';
import type { TranslateFn } from '../viewTypes';
import { LOGO_SRC } from '../constants';
import { Ic, Select, Skeleton, SkeletonRegion, Toggle } from '../ui';

const NEWS_HTML_ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'h2', 'h3', 'h4']);
const NEWS_HTML_TEXTLESS_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math']);

interface NewsDetailImage {
  src: string;
  alt: string;
}

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

function normalizeNewsImageSrc(value: string): string {
  return isSafeNewsUrl(value, true);
}

function sameNewsImage(left: string, right: string): boolean {
  try {
    return new URL(left, window.location.origin).href === new URL(right, window.location.origin).href;
  } catch {
    return left === right;
  }
}


function prepareNewsDetailContent(html: string, fallbackImageUrl = ''): { html: string; images: NewsDetailImage[] } {
  const safeHtml = sanitizeNewsHtml(html);
  const template = document.createElement('template');
  template.innerHTML = safeHtml;

  const images: NewsDetailImage[] = [];
  for (const img of Array.from(template.content.querySelectorAll('img'))) {
    const src = normalizeNewsImageSrc(img.getAttribute('src') || '');
    if (src) {
      images.push({
        src,
        alt: img.getAttribute('alt') || '',
      });
    }
    img.remove();
  }

  for (const element of Array.from(template.content.querySelectorAll('a'))) {
    if (!element.textContent?.trim() && element.children.length === 0) {
      element.remove();
    }
  }

  for (const element of Array.from(template.content.querySelectorAll('p, figure, blockquote'))) {
    if (!element.textContent?.trim() && element.children.length === 0) {
      element.remove();
    }
  }

  const fallbackSrc = normalizeNewsImageSrc(fallbackImageUrl);
  if (fallbackSrc && !images.some((image) => sameNewsImage(image.src, fallbackSrc))) {
    images.unshift({ src: fallbackSrc, alt: '' });
  }

  return {
    html: template.innerHTML.trim(),
    images,
  };
}

function NewsLoadingSkeleton() {
  return (
    <SkeletonRegion className="list-stack news-skeleton-grid" label="Ładowanie aktualności">
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
    </SkeletonRegion>
  );
}

interface NewsScreenProps {
  newsLoading: boolean;
  news: NewsItem[];
  t: TranslateFn;
  onOpenDetail: (item: NewsItem) => void;
}

function NewsThumbnail({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? <img src={src} alt="" className="news-thumb" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <div className="news-thumb-placeholder"><Ic n="news" /></div>;
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
              <NewsThumbnail key={item.thumbUrl} src={item.thumbUrl} />
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
  galleryBackRef: MutableRefObject<(() => BackInterceptResult) | null>;
}

interface NewsGalleryModalProps {
  images: NewsDetailImage[];
  index: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

type GallerySwipePhase = 'idle' | 'dragging' | 'settling';

function NewsGalleryModal({ images, index, onClose, onNext, onPrev }: NewsGalleryModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const image = images[index];
  const [zoom, setZoom] = useState(1);
  const [swipeState, setSwipeState] = useState<{ dx: number; progress: number; phase: GallerySwipePhase; direction: -1 | 0 | 1 }>({
    dx: 0,
    progress: 0,
    phase: 'idle',
    direction: 0,
  });
  const touchStartRef = useRef<{ x: number; y: number; ts: number; width: number; locked: boolean } | null>(null);
  const swipeCommitTimerRef = useRef<number | null>(null);
  const hasMany = images.length > 1;

  const resetSwipe = () => {
    setSwipeState({ dx: 0, progress: 0, phase: 'idle', direction: 0 });
  };

  useOverscrollLock(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' && hasMany) onNext();
      if (event.key === 'ArrowLeft' && hasMany) onPrev();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hasMany, onClose, onNext, onPrev]);

  useEffect(() => () => {
    if (swipeCommitTimerRef.current !== null) {
      window.clearTimeout(swipeCommitTimerRef.current);
    }
  }, []);

  if (!image) return null;

  const toggleZoom = () => {
    setZoom((current) => (current > 1 ? 1 : 2));
  };

  const finishSwipe = (direction: -1 | 1) => {
    if (swipeCommitTimerRef.current !== null) {
      window.clearTimeout(swipeCommitTimerRef.current);
    }

    setSwipeState({ dx: 0, progress: 1, phase: 'settling', direction });
    swipeCommitTimerRef.current = window.setTimeout(() => {
      swipeCommitTimerRef.current = null;
      resetSwipe();
      if (direction > 0) onNext();
      else onPrev();
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  };

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || !hasMany || zoom > 1) return;
    if (swipeCommitTimerRef.current !== null) {
      window.clearTimeout(swipeCommitTimerRef.current);
      swipeCommitTimerRef.current = null;
    }

    const target = event.currentTarget;
    touchStartRef.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
      ts: Date.now(),
      width: Math.max(1, target.clientWidth),
      locked: false,
    };
    setSwipeState({ dx: 0, progress: 0, phase: 'dragging', direction: 0 });
  };

  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    if (!start || !hasMany || zoom > 1 || event.touches.length !== 1) return;

    const rawDx = event.touches[0].clientX - start.x;
    const dy = event.touches[0].clientY - start.y;
    if (!start.locked) {
      if (Math.abs(rawDx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(rawDx) * 1.15) {
        touchStartRef.current = null;
        resetSwipe();
        return;
      }
      start.locked = true;
    }

    event.preventDefault();
    const limit = start.width * 0.92;
    const dx = Math.max(-limit, Math.min(limit, rawDx));
    const progress = Math.min(1, Math.abs(dx) / Math.max(1, start.width * 0.42));
    setSwipeState({ dx, progress, phase: 'dragging', direction: 0 });
  };

  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || !hasMany || zoom > 1 || event.changedTouches.length !== 1) return;

    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    const elapsed = Math.max(1, Date.now() - start.ts);
    const velocity = Math.abs(dx) / elapsed;
    const threshold = Math.min(120, Math.max(56, start.width * 0.18));

    if (!start.locked || Math.abs(dx) < Math.abs(dy) * 1.2 || (Math.abs(dx) < threshold && velocity < 0.45)) {
      resetSwipe();
      return;
    }

    finishSwipe(dx < 0 ? 1 : -1);
  };

  const onTouchCancel = () => {
    touchStartRef.current = null;
    resetSwipe();
  };

  const zoomedStyle = zoom > 1
    ? { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' }
    : undefined;
  const canAnimateSwipe = hasMany && zoom === 1;
  const getRelativeImage = (offset: number) => images[(index + offset + images.length) % images.length];
  const swipeTrackTransform = swipeState.phase === 'settling'
    ? (swipeState.direction > 0 ? 'translate3d(-200%, 0, 0)' : 'translate3d(0, 0, 0)')
    : `translate3d(calc(-100% + ${Math.round(swipeState.dx)}px), 0, 0)`;
  const swipeTrackStyle = {
    '--gallery-active-scale': String(1 - swipeState.progress * 0.035),
    '--gallery-active-opacity': String(1 - swipeState.progress * 0.1),
    '--gallery-side-scale': String(0.96 + swipeState.progress * 0.04),
    '--gallery-side-opacity': String(0.72 + swipeState.progress * 0.28),
    transform: swipeTrackTransform,
  } as CSSProperties;
  const swipeTrackClass = [
    'news-gallery-track',
    swipeState.phase === 'dragging' ? 'is-dragging' : '',
    swipeState.phase === 'settling' ? 'is-settling' : '',
  ].filter(Boolean).join(' ');

  return createPortal(
    <dialog ref={dialogRef} className="news-gallery-modal" aria-label="Galeria zdjęć" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="news-gallery-surface" onClick={(event) => event.stopPropagation()}>
        <div className="news-gallery-topbar">
          <div className="news-gallery-counter">{index + 1} / {images.length}</div>
          <div className="news-gallery-actions">
            <button type="button" className="news-gallery-icon-btn" onClick={toggleZoom} aria-label={zoom > 1 ? 'Pomniejsz zdjęcie' : 'Przybliż zdjęcie'}>
              <Ic n={zoom > 1 ? 'minus' : 'plus'} />
            </button>
            <button type="button" className="news-gallery-icon-btn" onClick={onClose} aria-label="Zamknij galerię">
              <Ic n="x" />
            </button>
          </div>
        </div>

        <div
          className="news-gallery-frame"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          {hasMany ? (
            <button type="button" className="news-gallery-nav news-gallery-nav-prev" onClick={onPrev} aria-label="Poprzednie zdjęcie">
              <Ic n="chevL" />
            </button>
          ) : null}

          <div className={`news-gallery-viewport${zoom > 1 ? ' is-zoomed' : ''}`}>
            {canAnimateSwipe ? (
              <div className={swipeTrackClass} style={swipeTrackStyle}>
                {[-1, 0, 1].map((offset) => {
                  const slideImage = getRelativeImage(offset);
                  return (
                    <div key={`${slideImage.src}-${offset}`} className={`news-gallery-slide${offset === 0 ? ' is-active' : ''}`}>
                      <img
                        src={slideImage.src}
                        alt={slideImage.alt}
                        className="news-gallery-image"
                        draggable={false}
                        onDoubleClick={toggleZoom}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <img
                src={image.src}
                alt={image.alt}
                className={`news-gallery-image${zoom > 1 ? ' is-zoomed' : ''}`}
                style={zoomedStyle}
                draggable={false}
                onDoubleClick={toggleZoom}
              />
            )}
          </div>

          {hasMany ? (
            <button type="button" className="news-gallery-nav news-gallery-nav-next" onClick={onNext} aria-label="Następne zdjęcie">
              <Ic n="chevR" />
            </button>
          ) : null}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

export function NewsDetailScreen({ item, t, galleryBackRef }: NewsDetailScreenProps) {
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const galleryHistoryRef = useRef(false);

  const preparedContent = useMemo(
    () => (item ? prepareNewsDetailContent(item.contentHtml || item.descriptionHtml, item.thumbUrl) : { html: '', images: [] }),
    [item],
  );
  const galleryOpen = galleryIndex !== null && preparedContent.images.length > 0;
  const safeGalleryIndex = galleryOpen
    ? Math.min(Math.max(galleryIndex ?? 0, 0), preparedContent.images.length - 1)
    : 0;

  useEffect(() => {
    if (!galleryOpen) return;

    window.history.pushState({ zutnik: true, overlay: 'news-gallery' }, '', window.location.href);
    galleryHistoryRef.current = true;

    const handler = (): BackInterceptResult => {
      galleryHistoryRef.current = false;
      setGalleryIndex(null);
      return 'consume';
    };

    galleryBackRef.current = handler;
    return () => {
      if (galleryBackRef.current === handler) {
        galleryBackRef.current = null;
      }
    };
  }, [galleryBackRef, galleryOpen]);

  const closeGallery = () => {
    if (galleryHistoryRef.current) {
      window.history.back();
      return;
    }
    setGalleryIndex(null);
  };

  const goToGalleryImage = (direction: -1 | 1) => {
    setGalleryIndex((current) => {
      const count = preparedContent.images.length;
      if (!count) return null;
      const start = current === null ? 0 : current;
      return (start + direction + count) % count;
    });
  };

  if (!item) {
    return <section className="screen news-detail-screen"><div className="empty-state"><p>{t('newsDetail.noContent')}</p></div></section>;
  }

  return (
    <section className="screen news-detail-screen">
      <div className="card news-detail-card">
        <div className="news-detail-title">{item.title}</div>
        <div className="news-detail-date">{item.date}</div>
        {preparedContent.html ? (
          <div className="news-detail-body" dangerouslySetInnerHTML={{ __html: preparedContent.html }} />
        ) : (
          <div className="news-detail-body">{item.descriptionText || item.snippet}</div>
        )}
        {preparedContent.images.length > 0 && (
          <div className={`news-detail-media-grid${preparedContent.images.length === 1 ? ' is-single' : ''}`}>
            {preparedContent.images.map((image, index) => (
              <button
                key={`${image.src}-${index}`}
                type="button"
                className="news-detail-media-item"
                onClick={() => setGalleryIndex(index)}
                aria-label={`Otwórz zdjęcie ${index + 1} z ${preparedContent.images.length}`}
              >
                <img src={image.src} alt={image.alt} loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        )}
      </div>
      {item.link && (
        <a href={item.link} target="_blank" rel="noreferrer" className="news-source-btn">
          {t('newsDetail.openBrowser')} ↗
        </a>
      )}
      {galleryOpen && (
        <NewsGalleryModal
          key={preparedContent.images[safeGalleryIndex]?.src ?? safeGalleryIndex}
          images={preparedContent.images}
          index={safeGalleryIndex}
          onClose={closeGallery}
          onNext={() => goToGalleryImage(1)}
          onPrev={() => goToGalleryImage(-1)}
        />
      )}
    </section>
  );
}

interface LinksScreenProps {
  links: UsefulLink[];
  t: TranslateFn;
}

export function LinksScreen({ links, t }: LinksScreenProps) {
  const groups = [
    { label: t('links.faculty'), items: links.filter((link) => link.scope === 'FACULTY') },
    { label: t('links.university'), items: links.filter((link) => link.scope === 'GLOBAL') },
  ];
  return <section className="screen links-screen">{groups.filter((group) => group.items.length).map((group) => <section className="link-section" key={group.label}>
    <h2 className="link-category">{group.label}</h2><div className="link-list">{group.items.map((link) => {
      let domain = link.url;
      try { domain = new URL(link.url).hostname.replace(/^www\./, ''); } catch { /* Keep the configured address. */ }
      return <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="link-card">
        <span className="link-thumb" aria-hidden="true">{link.title.slice(0, 1).toUpperCase()}</span>
        <span className="link-card-copy"><span className="link-card-title">{link.title}</span><span className="link-card-domain">{domain}</span><span className="link-card-desc">{link.description}</span></span>
        <Ic n="chevR" />
      </a>;
    })}</div>
  </section>)}</section>;
}


interface SettingsScreenProps {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  t: TranslateFn;
}

export function SettingsScreen({ settings, setSettings, t }: SettingsScreenProps) {
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const account = loadSession()?.userId || '';
  const exportSettings = () => {
    try {
      const backup = parseSettingsBackup(JSON.stringify({ version: 1, settings, tiles: loadHomeTiles(account), filters: JSON.parse(localStorage.getItem(`zutnik_filters:${account}`) || '[]') }));
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'zutnik-ustawienia.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setMessage(t('settings.exportFailed')); }
  };
  return <section className="screen settings-screen"><div className="settings-main">
    <section className="settings-section">
      <h2 className="settings-card-title">{t('settings.backupTitle')}</h2>
      <div className="settings-backup-actions"><button className="secondary-btn" onClick={exportSettings}><Ic n="download" />{t('settings.export')}</button><button className="secondary-btn" onClick={() => input.current?.click()}><Ic n="upload" />{t('settings.import')}</button></div>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={async (event) => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        try {
          if (file.size > 100_000) throw new Error('Plik jest zbyt duży.');
          const backup = parseSettingsBackup(await file.text());
          if (backup.tiles) localStorage.setItem(`zutnik_home:${account}`, JSON.stringify(backup.tiles));
          if (backup.filters) localStorage.setItem(`zutnik_filters:${account}`, JSON.stringify(backup.filters));
          window.dispatchEvent(new Event('zutnik-settings-imported'));
          setSettings(backup.settings); setMessage('Ustawienia zaimportowane.');
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zaimportować ustawień.'); }
      }} />
      {message && <p className="settings-import-status" role="status">{message}</p>}
    </section>
    <section className="settings-section">
      <h2 className="settings-card-title">{t('settings.sectionInterface')}</h2>
      <div className="settings-section-body">
        <div className="settings-select-row"><label htmlFor="app-theme">{t('settings.theme')}</label><p>{t('settings.themeDescription')}</p>
          <Select id="app-theme" value={settings.theme} onChange={(event) => setSettings((current) => ({ ...current, theme: event.target.value as AppSettings['theme'] }))}>
            {THEME_OPTIONS.map((theme) => <option key={theme} value={theme}>{t(`settings.theme${theme[0].toUpperCase()}${theme.slice(1)}`)}</option>)}
          </Select>
          {settings.theme === 'custom' && <CustomPaletteEditor value={settings.customPalette} t={t}
            onChange={(customPalette) => setSettings((current) => ({ ...current, customPalette }))} />}
        </div>
        <div className="settings-select-row"><label htmlFor="app-language">{t('settings.language')}</label><p>{t('settings.languageDescription')}</p><Select id="app-language" value={settings.language} onChange={(event) => setSettings((current) => ({ ...current, language: event.target.value as 'pl' | 'en' }))}><option value="pl">Polski</option><option value="en">English</option></Select></div>
      </div>
    </section>
    <section className="settings-section"><h2 className="settings-card-title">{t('settings.sectionViews')}</h2><div className="settings-section-body">
      <div className="settings-row"><span>{t('settings.compactPlan')}</span><Toggle label={t('settings.compactPlan')} checked={settings.compactPlan} onChange={(value) => setSettings((current) => ({ ...current, compactPlan: value }))} /></div>
      <div className="settings-row"><span>{t('settings.gradeGroup')}</span><Toggle label={t('settings.gradeGroup')} checked={settings.gradesGrouping} onChange={(value) => setSettings((current) => ({ ...current, gradesGrouping: value }))} /></div>
    </div></section>
    <section className="settings-section"><h2 className="settings-card-title">{t('settings.dataTitle')}</h2><div className="settings-section-body">
      <div className="settings-row"><span>{t('settings.backgroundRefresh')}</span><small>{t('settings.backgroundOff')}</small></div>
      <div className="settings-row"><span>{t('settings.manualRefresh')}</span><small>{t('settings.cooldown')}</small></div>
    </div></section>
  </div></section>;
}

interface AboutScreenProps {
  canOfferInstall: boolean;
  handleInstallPwa: () => Promise<void> | void;
  installBusy: boolean;
  installDescription: string;
  t: TranslateFn;
}

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=pl.kejlo.zutnik';
const PROJECT_URL = 'https://zutnik.endozero.pl';

export function AboutScreen({ canOfferInstall, handleInstallPwa, installBusy, installDescription, t }: AboutScreenProps) {
  const [shareStatus, setShareStatus] = useState('');
  const shareApp = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: 'ZUTnik', url: PROJECT_URL }); return; }
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(PROJECT_URL); setShareStatus(t('about.linkCopied')); }
      else setShareStatus(t('about.shareFallback'));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setShareStatus(t('about.shareFallback'));
    }
  };
  const links = [
    { href: PROJECT_URL, icon: 'info', title: t('about.projectSite') },
    { href: 'https://endozero.pl', icon: 'user', title: t('about.authorSite') },
    { href: PROJECT_URL + '/privacy_policy.html', icon: 'lock', title: t('about.privacyPolicy') },
    { href: 'mailto:kejlo@endozero.pl', icon: 'mail', title: 'kejlo@endozero.pl' },
  ];
  return <section className="screen about-screen">
    <div className="about-overview">
      <div className="about-hero"><img src={LOGO_SRC} alt="Logo ZUTnik" className="about-logo-img" /><div className="about-app-name">ZUTnik</div><div className="about-version">PWA</div>
        <div className="about-hero-actions"><a href={PLAY_STORE_URL} target="_blank" rel="noreferrer" className="secondary-btn"><Ic n="store" />{t('about.playStore')}</a><button className="secondary-btn" onClick={() => void shareApp()}><Ic n="share" />{t('about.share')}</button></div>
        {shareStatus && <p className="about-share-status" role="status">{shareStatus}</p>}
      </div>
      <h2 className="about-section-label">{t('about.supportSection')}</h2>
      <div className="about-actions">
        <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer" className="about-action-card"><span className="about-action-icon is-rating"><Ic n="star" /></span><span className="about-action-content"><span className="about-action-title">{t('about.rateApp')}</span><span className="about-action-desc">{t('about.rateDesc')}</span></span><Ic n="chevR" /></a>
        <a href="https://github.com/Kejlo523/ZUTnik" target="_blank" rel="noreferrer" className="about-action-card"><span className="about-action-icon"><Ic n="github" /></span><span className="about-action-content"><span className="about-action-title">{t('about.sourceCode')}</span><span className="about-action-desc">{t('about.sourceDesc')}</span></span><Ic n="external" /></a>
        {canOfferInstall && <button className="about-action-card" aria-label={t('install.action')} disabled={installBusy} onClick={() => void handleInstallPwa()}><span className="about-action-icon"><Ic n="install" /></span><span className="about-action-content"><span className="about-action-title">{t('install.action')}</span><span className="about-action-desc">{installDescription}</span></span><Ic n="chevR" /></button>}
      </div>
    </div>
    <div className="about-panels">
      <h2 className="about-section-label">{t('about.contactSection')}</h2>
      <div className="about-links">{links.map((link) => <a key={link.href} href={link.href} target={link.href.startsWith('https:') ? '_blank' : undefined} rel="noreferrer" className="about-link-item"><span className="about-link-icon"><Ic n={link.icon} /></span><span className="about-link-text">{link.title}</span><Ic n="chevR" /></a>)}</div>
      <div className="about-description"><p>{t('about.description')}</p><p className="about-signoff">Made by Kejlo</p></div>
    </div>
  </section>;
}
