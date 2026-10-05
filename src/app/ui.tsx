import { useLayoutEffect, useRef, type ComponentProps, type CSSProperties, type ChangeEventHandler, type ReactNode } from 'react';
import { ArrowLeft, Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Download, Eye, Filter, GraduationCap, Home, Info, Layers, Link, Lock, LogOut, MapPin, Menu, MoreHorizontal, MoreVertical, Newspaper, Pencil, Plus, Minus, RefreshCw, Search, Settings, Share2, Star, Trash2, Users, UserRound, Wallet, WifiOff, X, ChartNoAxesColumnIncreasing, CheckSquare, GripVertical, Expand, Upload, ExternalLink, Mail, GitFork, Smartphone, type LucideIcon } from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  back: ArrowLeft, bell: Bell, calendar: CalendarDays, check: Check,
  chevL: ChevronLeft, chevR: ChevronRight, clock: Clock, download: Download,
  eye: Eye, filter: Filter, grade: GraduationCap, home: Home, about: Info,
  info: Info, layers: Layers, link: Link, lock: Lock, logout: LogOut,
  location: MapPin, menu: Menu, more: MoreVertical, 'more-horizontal': MoreHorizontal,
  news: Newspaper, edit: Pencil, plus: Plus, minus: Minus, refresh: RefreshCw,
  search: Search, settings: Settings, share: Share2, star: Star, trash: Trash2,
  group: Users, user: UserRound, wallet: Wallet, 'wifi-off': WifiOff, x: X,
  stats: ChartNoAxesColumnIncreasing, present: CheckSquare, grip: GripVertical,
  expand: Expand, upload: Upload, external: ExternalLink, mail: Mail, github: GitFork, store: Smartphone,
};

export function Ic({ n }: { n: string }) {
  const Icon = icons[n] ?? Info;
  return <Icon size={24} strokeWidth={1.8} aria-hidden="true" />;
}

export function LoadingIndicator({ className = '' }: { className?: string }) {
  return <span className={`loading-indicator ${className}`} aria-hidden="true"><i /><i /><i /></span>;
}

export function Spinner({ text }: { text: string }) {
  return <div className="spinner-wrap" role="status"><LoadingIndicator />{text && <span>{text}</span>}</div>;
}

export function SkeletonRegion({ children, className = '', label = 'Ładowanie danych' }: { children: ReactNode; className?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const blocks = ref.current?.querySelectorAll<HTMLElement>('.skeleton-block');
    blocks?.forEach((block, index) => block.style.setProperty('--pulse-delay', `${-1120 * .7 * index / blocks.length}ms`));
  }, []);
  return <div ref={ref} className={`skeleton-region ${className}`} role="status" aria-label={label} aria-busy="true">{children}</div>;
}

export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={`skeleton-block ${className}`} style={style} />;
}

export function Select(props: ComponentProps<'select'>) {
  return <span className="select-control"><select {...props} /><span className="select-chevron" aria-hidden="true"><Ic n="chevR" /></span></span>;
}

export function Toggle({ checked, onChange, label = 'Włącz ustawienie' }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  const handleChange: ChangeEventHandler<HTMLInputElement> = (e) => onChange(e.target.checked);
  return <label className="settings-toggle"><input type="checkbox" checked={checked} onChange={handleChange} aria-label={label} /><span className="settings-toggle-track" /></label>;
}
