export interface ProductInfo {
  repo: string;
  name: string;
  title: string;
  store?: string;
  docs?: string;
  website?: string;
  description?: string;
  intro?: string;
  community?: string;
  private?: boolean;
  audience?: string;
}

export type Product = {
  name: string;
  title: string;
  description: string;
  link: string;
  store?: string;
  docs?: string;
  website?: string;
  intro?: string;
  community?: string;
  audience?: string;
};

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string;
}

export interface CategorizedLinks {
  community: string[];
  github: string[];
  team: string[];
  other: string[];
}

export interface PullRequest {
  title: string;
  number: number;
  url: string;
  mergedAt: string;
  author: string;
  description: string;
  mediaFiles: string[];
  links: CategorizedLinks;
}

export interface RepoUpdate {
  cacheKey: string;
  product: {
    name: string;
    title: string;
    description: string;
    link: string;
    store?: string;
    docs?: string;
    website?: string;
    intro?: string;
    community?: string;
  };
  changes: ChangelogEntry[];
  pulls: PullRequest[];
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

// Constants shared across files
export const MONTH_NAMES = {
  en: [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ],
  zh: [
    "一月",
    "二月",
    "三月",
    "四月",
    "五月",
    "六月",
    "七月",
    "八月",
    "九月",
    "十月",
    "十一月",
    "十二月",
  ],
};
