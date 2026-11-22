import type { Snapshot, Table } from './storage';

export const limit = 5 * 1024 * 1024;
export const tables = ['progress', 'favorites', 'vocab', 'settings'] as const;
export type Backup = Snapshot & { format_version: 1; exported_at: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份字段格式错误。');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || !expected.every(key => Object.hasOwn(value, key))) {
    throw new Error('备份包含缺失或未知字段。');
  }
}
function plain(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !!value.trim() && !/<\s*(?:[a-z!/]|\?)/i.test(value);
}
function time(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value.replace(/(\d\d:\d\d:\d\d)Z$/, '$1.000Z');
}
const articleId = (value: unknown) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,79}$/.test(value);

function validateRow(table: Table, value: unknown) {
  const row = record(value);
  if (table === 'settings') {
    fields(row, ['id', 'value', 'updatedAt']);
    const ranges = { fontSize: [12, 48], lineHeight: [1, 3], readingWidth: [40, 90], rate: [0.5, 2] };
    if (row.id === 'theme' && (row.value === 'light' || row.value === 'dark' || row.value === 'system') && time(row.updatedAt)) return;
    if (typeof row.id === 'string' && Object.hasOwn(ranges, row.id) && typeof row.value === 'number' && time(row.updatedAt)) {
      const [min, max] = ranges[row.id as keyof typeof ranges];
      if (row.value >= min && row.value <= max) return;
    }
    throw new Error('阅读设置无效。');
  }
  if (!articleId(row.articleId)) throw new Error('文章编号无效。');
  if (table === 'favorites') {
    fields(row, ['articleId', 'createdAt']);
    if (time(row.createdAt)) return;
  }
  if (table === 'progress') {
    fields(row, ['articleId', 'revision', 'sentenceId', 'completed', 'updatedAt']);
    if (Number.isSafeInteger(row.revision) && Number(row.revision) > 0 &&
        plain(row.sentenceId, 256) && typeof row.completed === 'boolean' && time(row.updatedAt)) return;
  }
  if (table === 'vocab') {
    fields(row, ['id', 'lemma', 'surface', 'pos', 'gloss', 'articleId', 'sentenceId', 'phraseSpan', 'sentence', 'createdAt']);
    if (plain(row.id, 2048) && plain(row.lemma, 512) && plain(row.surface, 512) &&
        plain(row.pos, 128) && plain(row.gloss, 4096) && plain(row.sentenceId, 256) &&
        plain(row.sentence, 32768) && time(row.createdAt)) {
      // P2-02 encodes its stable word key as a JSON tuple.
      const key: unknown = JSON.parse(row.id);
      if (Array.isArray(key) && key.length === 5) {
        const [article, sentence, kind, start, end] = key;
        const span = row.phraseSpan;
        if (row.id === JSON.stringify(key) && article === row.articleId && sentence === row.sentenceId &&
            Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start &&
            end <= row.sentence.length && row.sentence.slice(start, end) === row.surface &&
            ((kind === 'word' && span === null) ||
             (kind === 'phrase' && Array.isArray(span) && span.length === 2 && span[0] === start && span[1] === end))) return;
      }
    }
  }
  throw new Error('备份记录包含无效数据。');
}

export function validateBackup(value: unknown): Backup {
  const data = record(value);
  fields(data, ['format_version', 'exported_at', ...tables]);
  if (data.format_version !== 1) throw new Error('此备份格式版本不受支持。');
  if (!time(data.exported_at)) throw new Error('备份导出时间无效。');
  for (const table of tables) {
    const rows = data[table];
    if (!Array.isArray(rows)) throw new Error('备份数据表无效。');
    const seen = new Set();
    for (const row of rows) {
      validateRow(table, row);
      const key = table === 'vocab' || table === 'settings' ? row.id : row.articleId;
      if (seen.has(key)) throw new Error('备份包含重复记录。');
      seen.add(key);
    }
  }
  return data as Backup;
}

export async function readBackup(file: File) {
  if (file.size > limit) throw new Error('备份文件超过 5 MiB。');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
  } catch {
    throw new Error('无法读取备份。请选择有效的 UTF-8 JSON 文件。');
  }
  return validateBackup(value);
}
