import { useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { PlanSubjectFilter } from '../../types';
import type { SelectedPlanEvent, TranslateFn } from '../viewTypes';
import { fmtDateLabel, toPlanTeacherSearchQuery } from '../helpers';
import { Sheet } from '../components/Sheet';
import { Ic, LoadingIndicator } from '../ui';

interface PlanEventSheetProps {
  selectedPlanEvent: SelectedPlanEvent | null; onClose: () => void; language: 'pl' | 'en';
  onQuickSearch: (category: string, query: string) => void;
}
export function PlanEventSheet({ selectedPlanEvent, onClose, language, onQuickSearch }: PlanEventSheetProps) {
  if (!selectedPlanEvent) return null;
  const { date, event } = selectedPlanEvent;
  const rows = [
    { icon: 'location', label: 'Sala', value: event.room, category: 'room', query: event.room },
    { icon: 'group', label: 'Grupa', value: event.group, category: 'group', query: event.group },
    { icon: 'user', label: 'Prowadzący', value: event.teacher, category: 'teacher', query: toPlanTeacherSearchQuery(event.teacher) },
  ];
  return <Sheet title={event.title} onClose={onClose} className="plan-event-sheet">
    <span className={`event-sheet-type-badge ev-${event.typeClass}`}>{event.typeLabel || 'Zajęcia'}</span>
    <div className="event-sheet-row"><Ic n="clock" /><span>{fmtDateLabel(date, language)} · {event.startStr}–{event.endStr}</span></div>
    {rows.filter((row) => row.value && row.value !== '-').map((row) => <div className="event-sheet-row" key={row.label}>
      <Ic n={row.icon} /><div className="event-sheet-row-copy"><span className="event-sheet-row-label">{row.label}</span>
        <button className="event-sheet-link" onClick={() => onQuickSearch(row.category, row.query)}><span className="event-sheet-link-text">{row.value}</span><Ic n="search" /></button>
      </div>
    </div>)}
  </Sheet>;
}

interface PlanSearchSheetProps {
  initialSearch?: { category: string; query: string };
  planSearchOpen: boolean; planSearchCat: string; setPlanSearchCat: Dispatch<SetStateAction<string>>;
  planSearchQ: string; setPlanSearchQ: Dispatch<SetStateAction<string>>;
  planSearchSuggestions: string[]; setPlanSearchSuggestions: Dispatch<SetStateAction<string[]>>;
  planSearchLoading: boolean; planSearchDebounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  fetchPlanSearchSuggestions: (kind: string, query: string) => Promise<void>;
  loadPlanData: (search?: { category: string; query: string }, forceRefresh?: boolean, newDate?: string) => Promise<void>;
  setPlanSearchOpen: Dispatch<SetStateAction<boolean>>; t: TranslateFn;
}
export function PlanSearchSheet(props: PlanSearchSheetProps) {
  const { planSearchOpen, planSearchCat, planSearchQ, planSearchSuggestions, planSearchLoading, planSearchDebounceRef, fetchPlanSearchSuggestions, t } = props;
  const [query, setQuery] = useState(props.initialSearch?.query ?? planSearchQ);
  const [category, setCategory] = useState(props.initialSearch?.category ?? planSearchCat);
  useEffect(() => {
    return () => { if (planSearchDebounceRef.current) clearTimeout(planSearchDebounceRef.current); };
  }, [planSearchDebounceRef]);
  if (!planSearchOpen) return null;
  const canSubmit = category === 'album' ? /^s?\d+$/i.test(query.trim())
    : category === 'group' ? /\[\d+:\d+\]$/.test(query.trim()) : /\[[^\s[\]]+\]$/.test(query.trim());
  const suggest = (value: string, kind = category) => {
    setQuery(value); props.setPlanSearchSuggestions([]);
    if (planSearchDebounceRef.current) clearTimeout(planSearchDebounceRef.current);
    if (kind !== 'album' && value.trim().length >= 2) planSearchDebounceRef.current = setTimeout(() => void fetchPlanSearchSuggestions(kind, value.trim()), 650);
  };
  const submit = () => {
    if (!canSubmit) return;
    props.setPlanSearchCat(category); props.setPlanSearchQ(query.trim());
    props.setPlanSearchOpen(false); props.setPlanSearchSuggestions([]);
    void props.loadPlanData({ category, query: query.trim() });
  };
  return <Sheet title="Szukaj w planie" onClose={() => props.setPlanSearchOpen(false)}>
    <label className="field-label">{t('search.category')}<select value={category} onChange={(event) => { setCategory(event.target.value); suggest(query, event.target.value); }}>
      <option value="album">{t('search.catAlbum')}</option><option value="teacher">{t('search.catTeacher')}</option><option value="group">{t('search.catGroup')}</option><option value="room">{t('search.catRoom')}</option><option value="subject">{t('search.catSubject')}</option>
    </select></label>
    <label className="field-label">{t('search.queryLabel')}<div className="search-input-wrapper"><input autoFocus value={query} onChange={(event) => suggest(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} placeholder={t('search.queryPlaceholder')} />{planSearchLoading && <LoadingIndicator className="search-spinner-inline" />}</div></label>
    <div className="search-suggestions-container" aria-live="polite">{planSearchSuggestions.map((value) => <button className="search-suggestion-item" key={value} onClick={() => { if (value.trimEnd().endsWith('/')) suggest(value); else { setQuery(value); props.setPlanSearchSuggestions([]); } }}>{value}</button>)}</div>
    <div className="search-actions"><button className="text-btn" onClick={() => { props.setPlanSearchQ(''); props.setPlanSearchCat('album'); props.setPlanSearchOpen(false); void props.loadPlanData({ category: 'album', query: '' }); }}>Mój plan</button><button className="primary-btn" onClick={submit} disabled={!canSubmit}><Ic n="search" />Szukaj</button></div>
  </Sheet>;
}

interface PlanFiltersSheetProps {
  open: boolean; options: PlanSubjectFilter[]; hiddenKeys: string[]; onToggle: (key: string) => void; onReset: () => void; onClose: () => void;
}
export function PlanFiltersSheet({ open, options, hiddenKeys, onToggle, onReset, onClose }: PlanFiltersSheetProps) {
  if (!open) return null;
  return <Sheet title="Filtr przedmiotów" onClose={onClose}>
    {!options.length ? <div className="empty-state">Brak przedmiotów w zapisanym planie.</div> : <div className="plan-filter-list">
      {options.map((option) => <label className="plan-filter-item" key={option.key}>
        <span className="plan-filter-copy"><span className="plan-filter-label">{option.label}</span><small>{option.count} zajęć</small></span>
        <input type="checkbox" checked={!hiddenKeys.includes(option.key)} onChange={() => onToggle(option.key)} />
      </label>)}
    </div>}
    <div className="search-actions"><button className="text-btn" onClick={onReset} disabled={!hiddenKeys.length}>Pokaż wszystkie</button><button className="primary-btn" onClick={onClose}>Gotowe</button></div>
  </Sheet>;
}
