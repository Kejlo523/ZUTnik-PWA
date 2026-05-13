import type { CSSProperties, ChangeEventHandler } from 'react';

const SV = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function Ic({ n }: { n: string }) {
  if (n === 'menu') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M3 6h18M3 12h18M3 18h18" /></svg>;
  if (n === 'back') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M19 12H5M12 5l-7 7 7 7" /></svg>;
  if (n === 'search') return <svg viewBox="0 0 24 24" aria-hidden><circle {...SV} cx="11" cy="11" r="7" /><path {...SV} d="m21 21-4.35-4.35" /></svg>;
  if (n === 'refresh') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M1 4v6h6M23 20v-6h-6" /><path {...SV} d="M20.49 9A9 9 0 0 0 5.64 5.64M3.51 15A9 9 0 0 0 18.36 18.36" /></svg>;
  if (n === 'more') return <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="5" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="19" r="1.5" fill="currentColor" /></svg>;
  if (n === 'chevL') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M15 18l-6-6 6-6" /></svg>;
  if (n === 'chevR') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M9 18l6-6-6-6" /></svg>;
  if (n === 'minus') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M5 12h14" /></svg>;
  if (n === 'plus') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M12 5v14M5 12h14" /></svg>;
  if (n === 'home') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline {...SV} points="9 22 9 12 15 12 15 22" /></svg>;
  if (n === 'calendar') return <svg viewBox="0 0 24 24" aria-hidden><rect {...SV} x="3" y="4" width="18" height="18" rx="2" /><line {...SV} x1="16" y1="2" x2="16" y2="6" /><line {...SV} x1="8" y1="2" x2="8" y2="6" /><line {...SV} x1="3" y1="10" x2="21" y2="10" /></svg>;
  if (n === 'grade') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M22 10v6M2 10l10-5 10 5-10 5z" /><path {...SV} d="M6 12v5c3 3 9 3 12 0v-5" /></svg>;
  if (n === 'wallet') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M3 7.5A2.5 2.5 0 0 1 5.5 5h12A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-12A2.5 2.5 0 0 1 3 16.5z" /><path {...SV} d="M16 10h5v4h-5a2 2 0 1 1 0-4Z" /><path {...SV} d="M6 9h7" /></svg>;
  if (n === 'group') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle {...SV} cx="9" cy="7" r="4" /><path {...SV} d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>;
  if (n === 'user') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle {...SV} cx="12" cy="7" r="4" /></svg>;
  if (n === 'news') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2" /><path {...SV} d="M18 14h-8M15 18h-5M10 6h8v4h-8z" /></svg>;
  if (n === 'present') return <svg viewBox="0 0 24 24" aria-hidden><polyline {...SV} points="9 11 12 14 22 4" /><path {...SV} d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>;
  if (n === 'link') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path {...SV} d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>;
  if (n === 'lock') return <svg viewBox="0 0 24 24" aria-hidden><rect {...SV} x="3" y="11" width="18" height="11" rx="2" ry="2" /><path {...SV} d="M7 11V7a5 5 0 0110 0v4" /></svg>;
  if (n === 'eye') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle {...SV} cx="12" cy="12" r="3" /></svg>;
  if (n === 'settings') return <svg viewBox="0 0 24 24" aria-hidden><circle {...SV} cx="12" cy="12" r="3" /><path {...SV} d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;
  if (n === 'info') return <svg viewBox="0 0 24 24" aria-hidden><circle {...SV} cx="12" cy="12" r="10" /><line {...SV} x1="12" y1="8" x2="12" y2="12" /><line {...SV} x1="12" y1="16" x2="12.01" y2="16" /></svg>;
  if (n === 'logout') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline {...SV} points="16 17 21 12 16 7" /><line {...SV} x1="21" y1="12" x2="9" y2="12" /></svg>;
  if (n === 'wifi-off') return <svg viewBox="0 0 24 24" aria-hidden><line {...SV} x1="1" y1="1" x2="23" y2="23" /><path {...SV} d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" /></svg>;
  if (n === 'about') return <svg viewBox="0 0 24 24" aria-hidden><circle {...SV} cx="12" cy="12" r="10" /><path {...SV} d="M12 16v-4M12 8h.01" /></svg>;
  if (n === 'clock') return <svg viewBox="0 0 24 24" aria-hidden><circle {...SV} cx="12" cy="12" r="10" /><polyline {...SV} points="12 6 12 12 16 14" /></svg>;
  if (n === 'location') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle {...SV} cx="12" cy="10" r="3" /></svg>;
  if (n === 'download') return <svg viewBox="0 0 24 24" aria-hidden><path {...SV} d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline {...SV} points="7 10 12 15 17 10" /><line {...SV} x1="12" y1="15" x2="12" y2="3" /></svg>;
  if (n === 'layers') return <svg viewBox="0 0 24 24" aria-hidden><polygon {...SV} points="12 2 2 7 12 12 22 7 12 2" /><polyline {...SV} points="2 17 12 22 22 17" /><polyline {...SV} points="2 12 12 17 22 12" /></svg>;
  if (n === 'filter') return <svg viewBox="0 0 24 24" aria-hidden><polygon {...SV} points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>;
  if (n === 'x') return <svg viewBox="0 0 24 24" aria-hidden><line {...SV} x1="18" y1="6" x2="6" y2="18" /><line {...SV} x1="6" y1="6" x2="18" y2="18" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="4" fill="currentColor" /></svg>;
}

export function Spinner({ text }: { text: string }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      {text && <span>{text}</span>}
    </div>
  );
}

export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`skeleton-block ${className}`.trim()} style={style} />;
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const handleChange: ChangeEventHandler<HTMLInputElement> = (e) => onChange(e.target.checked);

  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={handleChange} />
      <span className="settings-toggle-track" />
    </label>
  );
}
