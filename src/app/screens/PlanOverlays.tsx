import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { PlanSubjectFilter } from '../../types';
import type { SelectedPlanEvent, TranslateFn } from '../viewTypes';
import { fmtDateLabel, toPlanTeacherSearchQuery } from '../helpers';
import { MOTION_MS } from '../../motion';
import { Ic } from '../ui';

const PLAN_EVENT_SHEET_TRANSITION_MS = MOTION_MS.panel;

interface PlanEventSheetProps {
  selectedPlanEvent: SelectedPlanEvent | null;
  onClose: () => void;
  language: 'pl' | 'en';
  onQuickSearch: (category: string, query: string) => void;
}

export function PlanEventSheet({ selectedPlanEvent, onClose, language, onQuickSearch }: PlanEventSheetProps) {
  const [renderedPlanEvent, setRenderedPlanEvent] = useState<SelectedPlanEvent | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const stateFrameRef = useRef<number | null>(null);
  const enterFrameRef = useRef<number | null>(null);
  const enterFrameNestedRef = useRef<number | null>(null);
  const shouldAnimateOpenRef = useRef(false);

  const clearStateFrame = () => {
    if (stateFrameRef.current !== null) {
      window.cancelAnimationFrame(stateFrameRef.current);
      stateFrameRef.current = null;
    }
  };

  const clearEnterFrames = () => {
    if (enterFrameRef.current !== null) {
      window.cancelAnimationFrame(enterFrameRef.current);
      enterFrameRef.current = null;
    }
    if (enterFrameNestedRef.current !== null) {
      window.cancelAnimationFrame(enterFrameNestedRef.current);
      enterFrameNestedRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
      clearStateFrame();
      clearEnterFrames();
    };
  }, []);

  useEffect(() => {
    clearStateFrame();

    if (selectedPlanEvent) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }

      clearEnterFrames();
      shouldAnimateOpenRef.current = !renderedPlanEvent || !isOpen;
      stateFrameRef.current = window.requestAnimationFrame(() => {
        if (shouldAnimateOpenRef.current) {
          setIsOpen(false);
        }
        setRenderedPlanEvent(selectedPlanEvent);
        stateFrameRef.current = null;
      });
      return;
    }

    if (!renderedPlanEvent) return;

    clearEnterFrames();
    shouldAnimateOpenRef.current = false;
    stateFrameRef.current = window.requestAnimationFrame(() => {
      setIsOpen(false);
      closeTimerRef.current = window.setTimeout(() => {
        setRenderedPlanEvent(null);
        closeTimerRef.current = null;
      }, PLAN_EVENT_SHEET_TRANSITION_MS);
      stateFrameRef.current = null;
    });
  }, [isOpen, renderedPlanEvent, selectedPlanEvent]);

  useEffect(() => {
    if (!renderedPlanEvent || !shouldAnimateOpenRef.current) return;

    shouldAnimateOpenRef.current = false;
    enterFrameRef.current = window.requestAnimationFrame(() => {
      enterFrameNestedRef.current = window.requestAnimationFrame(() => {
        setIsOpen(true);
        enterFrameRef.current = null;
        enterFrameNestedRef.current = null;
      });
    });
  }, [renderedPlanEvent]);

  if (!renderedPlanEvent) return null;

  const { date, event } = renderedPlanEvent;
  const room = event.room && event.room !== '-' ? event.room : '';
  const group = event.group && event.group !== '-' ? event.group : '';
  const teacherSearchQuery = toPlanTeacherSearchQuery(event.teacher);

  const renderSearchRow = (
    icon: string,
    label: string,
    value: string,
    category: string,
    query: string,
  ) => {
    if (!value) return null;
    const trimmedQuery = query.trim();
    const isSearchable = !!trimmedQuery;

    return (
      <div className="event-sheet-row">
        <Ic n={icon} />
        <div className="event-sheet-row-copy">
          <span className="event-sheet-row-label">{label}</span>
          {isSearchable ? (
            <button
              type="button"
              className="event-sheet-link"
              onClick={() => onQuickSearch(category, trimmedQuery)}
            >
              <span className="event-sheet-link-text">{value}</span>
              <span className="event-sheet-link-icon" aria-hidden>
                <Ic n="search" />
              </span>
            </button>
          ) : (
            <span className="event-sheet-row-value">{value}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`event-sheet-overlay plan-event-sheet-overlay${isOpen ? ' is-open' : ''}`} onClick={onClose}>
      <div className="event-sheet plan-event-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Szczegóły zajęć">
        <div className="event-sheet-handle" />
        <div className={`event-sheet-type-badge ev-${event.typeClass}`}>{event.typeLabel || 'Zajęcia'}</div>
        <div className="event-sheet-title">{event.title}</div>
        <div className="event-sheet-row">
          <Ic n="clock" />
          <span>{fmtDateLabel(date, language)} · {event.startStr} - {event.endStr}</span>
        </div>
        {renderSearchRow('location', 'Sala', room, 'room', room)}
        {renderSearchRow('group', 'Grupa', group, 'group', group)}
        {renderSearchRow('user', 'Prowadzący', event.teacher, 'teacher', teacherSearchQuery)}
        <button type="button" className="event-sheet-close" onClick={onClose}>
          Zamknij
        </button>
      </div>
    </div>
  );
}

interface PlanSearchSheetProps {
  planSearchOpen: boolean;
  planSearchCat: string;
  setPlanSearchCat: Dispatch<SetStateAction<string>>;
  planSearchQ: string;
  setPlanSearchQ: Dispatch<SetStateAction<string>>;
  planSearchSuggestions: string[];
  setPlanSearchSuggestions: Dispatch<SetStateAction<string[]>>;
  planSearchLoading: boolean;
  planSearchDebounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  fetchPlanSearchSuggestions: (kind: string, query: string) => Promise<void>;
  loadPlanData: (search?: { category: string; query: string }, forceRefresh?: boolean, newDate?: string) => Promise<void>;
  setPlanSearchOpen: Dispatch<SetStateAction<boolean>>;
  t: TranslateFn;
}

export function PlanSearchSheet({
  planSearchOpen,
  planSearchCat,
  setPlanSearchCat,
  planSearchQ,
  setPlanSearchQ,
  planSearchSuggestions,
  setPlanSearchSuggestions,
  planSearchLoading,
  planSearchDebounceRef,
  fetchPlanSearchSuggestions,
  loadPlanData,
  setPlanSearchOpen,
  t,
}: PlanSearchSheetProps) {
  if (!planSearchOpen) return null;

  const handleQueryChange = (value: string) => {
    setPlanSearchQ(value);

    if (planSearchDebounceRef.current) {
      clearTimeout(planSearchDebounceRef.current);
    }

    if (planSearchCat === 'album') {
      setPlanSearchSuggestions([]);
      return;
    }

    planSearchDebounceRef.current = setTimeout(() => {
      if (value.trim()) {
        void fetchPlanSearchSuggestions(planSearchCat, value.trim());
      } else {
        setPlanSearchSuggestions([]);
      }
    }, 300);
  };

  const handleCategoryChange = (newCat: string) => {
    setPlanSearchCat(newCat);
    setPlanSearchSuggestions([]);
    if (planSearchQ.trim() && newCat !== 'album') {
      if (planSearchDebounceRef.current) {
        clearTimeout(planSearchDebounceRef.current);
      }
      planSearchDebounceRef.current = setTimeout(() => {
        void fetchPlanSearchSuggestions(newCat, planSearchQ.trim());
      }, 300);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setPlanSearchQ(suggestion);
    setPlanSearchSuggestions([]);
  };

  const handleSearch = () => {
    if (planSearchQ.trim()) {
      void loadPlanData({ category: planSearchCat, query: planSearchQ.trim() });
      setPlanSearchOpen(false);
    }
  };

  const handleClear = () => {
    setPlanSearchQ('');
    setPlanSearchSuggestions([]);
    void loadPlanData();
    setPlanSearchOpen(false);
  };

  return (
    <div className="event-sheet-overlay" onClick={() => setPlanSearchOpen(false)}>
      <div className="event-sheet search-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Szukaj w planie">
        <div className="event-sheet-handle" />
        <div className="search-container">
          <h2 className="search-title">Szukaj w planie</h2>

          <div className="search-field-group">
            <label className="search-label">{t('search.category')}</label>
            <select
              value={planSearchCat}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="search-select"
            >
              <option value="album">{t('search.catAlbum')}</option>
              <option value="teacher">{t('search.catTeacher')}</option>
              <option value="group">{t('search.catGroup')}</option>
              <option value="room">{t('search.catRoom')}</option>
              <option value="subject">{t('search.catSubject')}</option>
            </select>
          </div>

          <div className="search-field-group">
            <label className="search-label">{t('search.queryLabel')}</label>
            <div className="search-input-wrapper">
              <input
                type="text"
                value={planSearchQ}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder={t('search.queryPlaceholder')}
                className="search-input"
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              {planSearchLoading && <span className="search-spinner-inline" />}
            </div>
          </div>

          {(planSearchSuggestions.length > 0 || (!planSearchQ.trim() && planSearchCat !== 'album')) && (
            <div className="search-suggestions-container">
              {planSearchSuggestions.length > 0 ? (
                planSearchSuggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="search-suggestion-item"
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))
              ) : planSearchCat !== 'album' && !planSearchQ.trim() ? (
                <div className="search-placeholder">{t('search.placeholderSearch')}</div>
              ) : null}
            </div>
          )}

          <div className="search-actions">
            <button
              type="button"
              className="search-btn-primary"
              onClick={handleSearch}
              disabled={!planSearchQ.trim()}
            >
              Szukaj
            </button>
            <button
              type="button"
              className="search-btn-secondary"
              onClick={handleClear}
            >
              Wyczyść
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PlanFiltersSheetProps {
  open: boolean;
  options: PlanSubjectFilter[];
  hiddenKeys: string[];
  onToggle: (key: string) => void;
  onReset: () => void;
  onClose: () => void;
}

export function PlanFiltersSheet({
  open,
  options,
  hiddenKeys,
  onToggle,
  onReset,
  onClose,
}: PlanFiltersSheetProps) {
  if (!open) return null;

  const excludedCount = hiddenKeys.length;

  return (
    <div className="event-sheet-overlay" onClick={onClose}>
      <div className="event-sheet search-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Wyklucz przedmioty">
        <div className="event-sheet-handle" />
        <div className="search-container">
          <h2 className="search-title">Wyklucz przedmioty</h2>

          <div className="plan-filter-intro">
            <span className="plan-filter-intro-badge">
              {excludedCount > 0 ? `Wykluczono: ${excludedCount}` : 'Bez wykluczeń'}
            </span>
            <p className="plan-filter-intro-text">
              Dotknij przedmiotu, aby ukryć go w planie. Ponowne dotknięcie przywraca go do widoku.
            </p>
          </div>

          {options.length === 0 ? (
            <div className="search-placeholder">Brak dostępnych przedmiotów w aktualnym zakresie.</div>
          ) : (
            <div className="plan-filter-list">
              {options.map((option) => {
                const excluded = hiddenKeys.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={`plan-filter-item${excluded ? ' is-excluded' : ''}`}
                    onClick={() => onToggle(option.key)}
                  >
                    <span className="plan-filter-copy">
                      <span className="plan-filter-label">{option.label}</span>
                      <span className="plan-filter-hint">
                        {excluded ? 'Dotknij, aby przywrócić do planu' : 'Dotknij, aby wykluczyć z planu'}
                      </span>
                    </span>
                    <span className="plan-filter-meta">
                      <span className="plan-filter-count">{option.count}</span>
                      <span className={`plan-filter-state${excluded ? ' is-excluded' : ''}`}>
                        {excluded ? 'Wykluczony' : 'Widoczny'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="search-actions">
            <button
              type="button"
              className="search-btn-secondary"
              onClick={onReset}
              disabled={hiddenKeys.length === 0}
            >
              Pokaż wszystko
            </button>
            <button
              type="button"
              className="search-btn-primary"
              onClick={onClose}
            >
              Gotowe
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
