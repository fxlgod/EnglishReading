import { createHash } from 'node:crypto';
import { mkdir, readFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { admissionTime, publicText } from '../../src/core/content/metadata.ts';
import { words } from '../../src/core/content/words.ts';
import { loadSources, sourceAttribution } from './sources.mjs';
import { compilerInputs, jsonFiles, readCatalog, verifyCommitFiles } from './catalog.mjs';
import { loadSerialPlans, validateSerialRecord } from './serial.mjs';
import { project } from './extensions.mjs';

const json = value => JSON.stringify(value) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const root = new URL('../../', import.meta.url);
const schema = await read(new URL('schemas/article.schema.json', root));
const ajv = new Ajv2020({ allErrors: true, strictRequired: false, strictTypes: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);
const validateSeries = ajv.compile(await read(new URL('schemas/series.schema.json', root)));
const idPattern = /^[a-z0-9][a-z0-9-]{2,79}$/;

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function requireText(value, field = 'article') {
  if (typeof value === 'string') require(value.trim().length, `blank ${field}`);
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'separator_after') requireText(item, `${field}.${key}`);
    }
  }
}

function projectArticle(source) {
  const { id, revision, title_en, title_zh, level, primary_topic, tags, source_type, fiction, summary_zh, featured, admitted_at, series } = source;
  const { kind, author, source_url, license_url, modifications } = source.rights;
  for (const url of [source_url, license_url]) {
    if (url !== undefined) require(new URL(url).protocol === 'https:' && !new URL(url).username && !new URL(url).password, `${id}: unsafe attribution URL`);
  }
  const summary = { id, revision, title_en, title_zh, level, primary_topic, tags, source_type, fiction, summary_zh, featured, admitted_at, ...(series && { series }) };
  return {
    summary,
    article: { schema_version: 2, ...summary, paragraphs: source.paragraphs, rights: { kind, author, source_url, license_url, modifications } },
  };
}

export async function inspectArticle(raw, mode, reviews, sources = new Map(), usedWorks = new Set()) {
  const source = JSON.parse(raw);
  require(validateSchema(source), ajv.errorsText(validateSchema.errors));
  requireText(source);
  require(publicText(source.summary_zh, 240), 'invalid summary_zh');
  if (mode !== 'staging') require(admissionTime(source.admitted_at), 'invalid admitted_at');
  const { id, revision, series, rights, source_type: sourceType, review } = source;
  require(idPattern.test(id) && Number.isSafeInteger(revision), 'invalid article ID or revision');
  require(source.status === (mode === 'release' ? 'approved' : mode), `${id}: invalid status for ${mode}`);
  require((rights.kind === 'project_original') === ['ai_original', 'original_serial'].includes(sourceType), `${id}: rights/source type mismatch`);
  if (series) require(idPattern.test(series.id) && Number.isSafeInteger(series.chapter), `${id}: invalid series ID or chapter`);
  if (mode === 'release') {
    require(review.producer_id.trim() !== review.independent_reviewer_id.trim(), `${id}: reviewer must be independent`);
    require(/^content\/rights\/[a-z0-9][a-z0-9.-]*\.json$/.test(review.evidence_ref), `${id}: invalid review evidence path`);
    const evidence = await read(join(reviews, review.evidence_ref.split('/').at(-1)));
    require(evidence.id === id && evidence.revision === revision && evidence.sha256 === hash(raw) &&
      evidence.admitted_at === source.admitted_at && evidence.featured === source.featured &&
      evidence.producer_id === review.producer_id && evidence.independent_reviewer_id === review.independent_reviewer_id, `${id}: review evidence does not match source bytes`);
  }
  const sentenceIds = new Set();
  let word_count = 0;
  for (const { sentences } of source.paragraphs) {
    for (const sentence of sentences) {
      const { id: sid, text, tokens, phrases } = sentence;
      const label = `${id}/${sid}`;
      require(!sentenceIds.has(sid), `${label}: duplicate sentence ID`);
      sentenceIds.add(sid);
      const expected = words(text);
      require(tokens.length === expected.length && tokens.every((token, i) =>
        token.start === expected[i].start && token.end === expected[i].end && token.surface === expected[i].surface
      ), `${label}: invalid token coverage or UTF-16 offsets`);
      const starts = new Set(tokens.map(token => token.start));
      const ends = new Set(tokens.map(token => token.end));
      for (const phrase of phrases) {
        require(starts.has(phrase.start) && ends.has(phrase.end) && phrase.start < phrase.end &&
          text.slice(phrase.start, phrase.end) === phrase.surface, `${label}: invalid phrase span`);
      }
      word_count += expected.length;
    }
  }
  const projection = projectArticle(source);
  const attribution = mode !== 'fixture' && rights.kind !== 'project_original'
    ? sourceAttribution(rights, sources, usedWorks) : undefined;
  return { ...projection, word_count, attribution };
}

export async function compile({ mode, files, reviews, output, seriesFiles = [], sources = new Map(), committed = new Map(), serialRoot }) {
  require(mode === 'release' || mode === 'fixture', 'invalid build mode');
  const seriesMetadata = new Map();
  for (const file of seriesFiles) {
    const data = await read(file);
    require(validateSeries(data), ajv.errorsText(validateSeries.errors));
    const { id, title, synopsis_zh } = data;
    require(publicText(title, 100) && title.toLowerCase() !== id && publicText(synopsis_zh, 600), `${id}: invalid series title or synopsis`);
    require(!seriesMetadata.has(id), `duplicate series ID: ${id}`);
    seriesMetadata.set(id, { id, title, synopsis_zh });
  }
  const counts = {
    levels: Object.fromEntries(schema.properties.level.enum.map(key => [key, 0])),
    topics: Object.fromEntries(schema.properties.primary_topic.enum.map(key => [key, 0])),
  };
  let serialPlans;
  const ids = new Set(), usedWorks = new Set(), chapters = new Map(), articles = [], attributions = [];
  const stage = output ? await mkdir(dirname(output), { recursive: true }).then(() => mkdtemp(join(dirname(output), '.content-'))) : undefined;
  try {
    if (stage) await mkdir(join(stage, 'articles'));
    for (const file of files) {
      const entry = committed.get(file);
      const raw = entry ? await verifyCommitFiles(entry,sources) : await readFile(file);
      const { article, summary, word_count, attribution } = await inspectArticle(raw, mode, entry?.reviews ?? reviews, sources, usedWorks);
      const { id, revision, level, primary_topic, series } = summary;
      require(!ids.has(id), `duplicate article ID: ${id}`);
      ids.add(id);
      if (series) {
        if (mode === 'release' && serialRoot) {
          serialPlans ??= (await loadSerialPlans(serialRoot)).plans;
          const source = JSON.parse(raw);
          const evidence = await read(join(entry?.reviews ?? reviews,source.review.evidence_ref.split('/').at(-1)));
          validateSerialRecord(article,word_count,evidence.independent?.serial,serialPlans);
        }
        if (!chapters.has(series.id)) chapters.set(series.id, []);
        chapters.get(series.id).push({ id, chapter: series.chapter });
      }
      counts.levels[level]++;
      counts.topics[primary_topic]++;
      const path = `articles/${id}.${revision}.json`;
      const body = json(article);
      articles.push({ ...summary, word_count, path, sha256: hash(body) });
      attributions.push({ id, title_en: summary.title_en, ...article.rights, ...attribution });
      if (stage) await writeFile(join(stage, path), body);
    }
    const byId = (a, b) => a.id < b.id ? -1 : Number(a.id !== b.id);
    articles.sort(byId);
    attributions.sort(byId);
    const series = Array.from(chapters, ([id, entries]) => {
      entries.sort((a, b) => a.chapter - b.chapter);
      require(entries.every(({ chapter }, i) => chapter === i + 1), `${id}: missing or duplicate chapter`);
      const metadata = seriesMetadata.get(id);
      require(metadata, `missing series definition: ${id}`);
      return { ...metadata, chapters: entries };
    }).sort(byId);
    const content_version = hash(json({ articles, series, attributions }));
    if (stage) {
      await writeFile(join(stage, 'manifest.json'), json({ schema_version: 2, build_id: `${mode}-${content_version}`, content_version, articles, counts, series: series.map(({ id, title, synopsis_zh }) => ({ id, title, synopsis_zh })) }));
      await writeFile(join(stage, 'series.json'), json({ schema_version: 2, series }));
      await writeFile(join(stage, 'attributions.json'), json({ schema_version: 2, articles: attributions }));
      await rm(output, { recursive: true, force: true });
      await rename(stage, output);
    }
    return articles.length;
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const [, , action, flag] = process.argv;
  require(['validate', 'build'].includes(action) && (flag === undefined || flag === '--fixture'), 'usage: compile.mjs validate|build [--fixture]');
  const mode = flag === '--fixture' ? 'fixture' : 'release';
  const inputs = mode === 'fixture' ? {files:[resolve('examples/article.example.json')]}
    : compilerInputs((await readCatalog(process.cwd())).active);
  const seriesFiles = mode === 'release' ? await jsonFiles(resolve('content/series')) : [];
  const sources = mode === 'release' ? await loadSources() : new Map();
  const total = await compile({ mode, ...inputs, seriesFiles, sources, serialRoot:process.cwd(), reviews: resolve('content/rights'),
    output: action === 'build' ? resolve(mode === 'fixture' ? '.cache/content-fixture' : 'dist/content') : undefined });
  if (action === 'build' && mode === 'release') {
    await project(resolve('content/extensions-private'),'release',resolve('dist/content/extensions'));
  }
  console.log(`${mode} ${action}: ${total} article(s)`);
}

