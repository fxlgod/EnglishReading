import type { Span } from './words.ts';

export interface Sentence {
  id: string;
  text: string;
  separator_after: '' | ' ';
  translation_zh: string;
  note_zh?: string;
  tokens: (Span & { lemma: string; pos: string; gloss_zh: string; ipa?: string })[];
  phrases: (Span & { gloss_zh: string })[];
}

export interface ArticleSummary {
  id: string;
  revision: number;
  title_en: string;
  title_zh: string;
  level: string;
  primary_topic: string;
  tags: string[];
  source_type: string;
  fiction: boolean;
  summary_zh: string;
  featured: boolean;
  admitted_at: string;
  series?: { id: string; chapter: number };
}

export interface Article extends ArticleSummary {
  schema_version: 2;
  paragraphs: { sentences: Sentence[] }[];
  rights: { kind: string; author: string; source_url?: string; license_url?: string; modifications: string };
}

export interface Entry extends ArticleSummary {
  path: string;
  sha256: string;
  word_count: number;
}

export interface SeriesSummary {
  id: string;
  title: string;
  synopsis_zh: string;
}

export interface Manifest {
  schema_version: 2;
  build_id: string;
  content_version: string;
  articles: Entry[];
  series: SeriesSummary[];
  counts: { levels: Record<string, number>; topics: Record<string, number> };
}


export type ReadingLayout = {
  blockquote: number[];
  breaks_after: number[];
  emphasis: { sentence_id: string; start: number; end: number; tag: 'em' | 'strong' }[];
};
