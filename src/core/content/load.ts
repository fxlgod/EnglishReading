import type { Article, Entry, Manifest } from './types.ts';

import { admissionTime, contentId, publicText } from './metadata.ts';
const digestPattern = /^[a-f0-9]{64}$/;

function validEntry(entry: Entry): boolean {
  return entry != null && typeof entry.id === 'string' && contentId.test(entry.id) &&
    Number.isSafeInteger(entry.revision) && entry.revision > 0 &&
    entry.path === `articles/${entry.id}.${entry.revision}.json` &&
    typeof entry.sha256 === 'string' && digestPattern.test(entry.sha256) &&
    typeof entry.title_en === 'string' && typeof entry.title_zh === 'string' &&
    publicText(entry.summary_zh, 240) && typeof entry.featured === 'boolean' && admissionTime(entry.admitted_at) &&
    (entry.source_type === 'original_serial'
      ? typeof entry.series?.id === 'string' && contentId.test(entry.series.id) &&
        Number.isSafeInteger(entry.series.chapter) && entry.series.chapter > 0
      : entry.series === undefined) &&
    typeof entry.level === 'string' && typeof entry.primary_topic === 'string' &&
    typeof entry.source_type === 'string' && typeof entry.fiction === 'boolean' &&
    Array.isArray(entry.tags) && entry.tags.every(tag => typeof tag === 'string') &&
    Number.isSafeInteger(entry.word_count) && entry.word_count > 0;
}

export function createContentLoader(base: URL) {
  async function get(path: string) {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10_000) });
    const reason = response.headers.get('X-Reading-Cache');
    if (reason === 'offline-miss' || reason === 'offline-corrupt') throw new Error(reason);
    if (!response.ok) throw new Error(`Content request failed (${response.status}): ${path}`);
    return response;
  }

  return {
    async loadManifest(): Promise<Manifest> {
      const manifest: Manifest = await (await get('manifest.json')).json();
      if (manifest?.schema_version !== 2 || !Array.isArray(manifest.articles) ||
          !manifest.articles.every(validEntry) ||
          new Set(manifest.articles.map(entry => entry.id)).size !== manifest.articles.length ||
          typeof manifest.content_version !== 'string' || !digestPattern.test(manifest.content_version) ||
          manifest.build_id !== `release-${manifest.content_version}` ||
          !manifest.counts?.levels || !manifest.counts.topics) {
        throw new Error('Invalid or unsupported content manifest');
      }
      if (!Array.isArray(manifest.series) || !manifest.series.every(item => item != null &&
          typeof item.id === 'string' && contentId.test(item.id) && publicText(item.title, 100) &&
          item.title.toLowerCase() !== item.id && publicText(item.synopsis_zh, 600))) {
        throw new Error('Invalid series metadata');
      }
      const seriesIds = new Set(manifest.series.map(item => item.id));
      if (seriesIds.size !== manifest.series.length ||
          manifest.articles.some(item => item.series && !seriesIds.has(item.series.id))) {
        throw new Error('Invalid series references');
      }
      return manifest;
    },

    async loadArticle(entry: Entry): Promise<Article> {
      if (!validEntry(entry)) throw new Error('Invalid article reference');
      const bytes = await (await get(entry.path)).arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
      if (hex !== entry.sha256) throw new Error('Article integrity check failed');
      const article: Article = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (article?.schema_version !== 2 || article.id !== entry.id || article.revision !== entry.revision ||
          article.summary_zh !== entry.summary_zh || article.admitted_at !== entry.admitted_at ||
          article.featured !== entry.featured || !Array.isArray(article.paragraphs) || !article.paragraphs.length) {
        throw new Error('Invalid or unsupported article');
      }
      return article;
    },
  };
}

