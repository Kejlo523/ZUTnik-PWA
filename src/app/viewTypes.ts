import type { Grade, NewsItem, PlanResult, ScreenKey } from '../types';

export type TranslateFn = (key: string) => string;

export interface NewsDetailParams {
  item: NewsItem;
}

export interface SelectedPlanEvent {
  date: string;
  event: PlanResult['dayColumns'][number]['events'][number];
}

export interface GroupedGradeView {
  subject: string;
  items: Grade[];
  finalGrade: string;
  ects: number;
  emptyFromPlanFilter?: boolean;
}

export type DrawerScreenKey = Exclude<ScreenKey, 'login' | 'news-detail'>;
