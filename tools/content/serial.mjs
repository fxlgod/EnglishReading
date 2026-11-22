import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { contentId, readCatalog, readJson, sha256, verifyCommitFiles } from './catalog.mjs';

const nonblank = text => typeof text === 'string' && text.trim().length > 0;
const levels = ['A1','A2','B1','B2','C1','C2'];
const topics = ['school','technology','mystery','adventure','history','daily_life','psychology_science','literature'];
const unique = values => new Set(values).size === values.length;

export function checkOutline(outline,target) {
  assert(outline?.format_version === 1 && outline.series_id === target.id && topics.includes(outline.primary_topic) &&
    Array.isArray(outline.chapters) && outline.chapters.length === target.chapters &&
    Array.isArray(outline.threads) && outline.threads.length > 0, `${target.id}: invalid outline or chapter count`);
  let previousDay = 0, previousLevel = -1;
  const counts = {};
  const ids = new Set(), titles = new Set();
  for (const [i,chapter] of outline.chapters.entries()) {
    const n = i + 1;
    assert(chapter.chapter === n && chapter.article_id === `${target.id}-${String(n).padStart(2,'0')}` &&
      !ids.has(chapter.article_id), `${target.id}: duplicated or missing chapter ${n}`);
    const level = levels.indexOf(chapter.level);
    assert(Number.isSafeInteger(chapter.story_day) && chapter.story_day > 0 && chapter.story_day >= previousDay &&
      level >= 0 && level >= previousLevel && Object.hasOwn(target.levels,chapter.level),
    `${chapter.article_id}: timeline or difficulty progression mismatch`);
    const {min,max} = chapter.target_words;
    assert(Number.isSafeInteger(min) && min > 0 && Number.isSafeInteger(max) && max >= min &&
      [chapter.title_en,chapter.summary_zh,chapter.beats,chapter.language_focus].every(nonblank) &&
      !titles.has(chapter.title_en), `${chapter.article_id}: duplicate or incomplete outline`);
    ids.add(chapter.article_id);
    titles.add(chapter.title_en);
    counts[chapter.level] = (counts[chapter.level] ?? 0) + 1;
    previousDay = chapter.story_day;
    previousLevel = level;
  }
  assert.deepEqual(counts,target.levels,`${target.id}: level quota mismatch`);
  assert(unique(outline.threads.map(thread => thread.id)),`${target.id}: duplicate thread ID`);
  for (const thread of outline.threads) {
    assert(typeof thread.id === 'string' && contentId.test(thread.id) && nonblank(thread.description) &&
      Array.isArray(thread.advance) && thread.advance.length > 0, `${target.id}: incomplete thread`);
    const steps = [thread.plant,...thread.advance,thread.payoff];
    assert(steps.every((chapter,i) => Number.isSafeInteger(chapter) && chapter >= 1 &&
      chapter <= target.chapters && (i === 0 || chapter > steps[i-1])), `${thread.id}: invalid thread order`);
  }
  return counts;
}

export async function loadSerialPlans(root) {
  const quotas = await readJson(join(root,'content','QUOTAS.json'));
  const plans = new Map();
  const totals = Object.fromEntries(levels.map(level => [level,0]));
  let chapters = 0;
  for (const target of quotas.series) {
    const outline = await readJson(join(root,'docs','series',target.id+'.json'));
    const metadata = await readJson(join(root,'content','series',target.id+'.json'));
    assert(metadata.schema_version === 2 && metadata.id === target.id && metadata.title === target.title &&
      nonblank(metadata.synopsis_zh), `${target.id}: public metadata differs from plan`);
    const counts = checkOutline(outline,target);
    const bible = await readFile(join(root,'docs','series',target.id+'.md'),'utf8');
    assert(nonblank(bible),`${target.id}: empty story bible`);
    for (const [level,count] of Object.entries(counts)) totals[level] += count;
    chapters += target.chapters;
    plans.set(target.id,{...outline,title:metadata.title});
  }
  assert.equal(chapters,quotas.source_targets.original_serial,'serial quota mismatch');
  for (const level of levels) assert.equal(totals[level],quotas.source_matrix[level].original_serial,`${level}: serial matrix mismatch`);
  return {plans,chapters,totals};
}

export function chapterContext(outline,number) {
  const chapter = outline?.chapters[number-1];
  assert(chapter && Number.isInteger(number), 'unknown planned chapter');
  const steps = Object.fromEntries(outline.threads.flatMap(thread => {
    const step = thread.plant===number ? 'plant' : thread.payoff===number ? 'payoff' :
      thread.advance.includes(number) ? 'advance' : null;
    return step ? [[thread.id,step]] : [];
  }));
  const prior = new Set([number-2,number-1].filter(n => n > 0));
  for (const thread of outline.threads) {
    if (steps[thread.id] === 'advance' || steps[thread.id] === 'payoff') {
      prior.add(thread.plant);
      const last = thread.advance.findLast(n => n < number);
      if (last !== undefined) prior.add(last);
    }
  }
  return {chapter, prior:[...prior].sort((a,b)=>a-b), steps,
    revealed:outline.threads.filter(thread=>thread.payoff===number).map(thread=>thread.id),
    open_threads:outline.threads.filter(thread=>thread.plant<=number && thread.payoff>number).map(thread=>thread.id)};
}

export function validateSerialRecord(article,wordCount,record,plans) {
  const outline = plans.get(article.series.id);
  const expected = chapterContext(outline,article.series.chapter);
  const {chapter,prior,steps} = expected;
  assert(article.id === chapter.article_id && article.level === chapter.level &&
    article.primary_topic === outline.primary_topic, `${article.id}: planned chapter ID, level or topic mismatch`);
  assert(record?.story_day === chapter.story_day &&
    ['timeline_note','terms_note','language_note','age_note'].every(name => nonblank(record[name])),
    `${article.id}: missing timeline, terminology, level or age continuity evidence`);
  assert(Array.isArray(record.prior_reviewed) && unique(record.prior_reviewed) &&
    record.prior_reviewed.every(n=>Number.isSafeInteger(n) && n>=1 && n<chapter.chapter) &&
    prior.every(n=>record.prior_reviewed.includes(n)), `${article.id}: missing prior continuity review`);
  for (const name of ['facts_added','character_changes']) {
    assert(Array.isArray(record[name]) && record[name].every(nonblank), `${article.id}: invalid ${name}`);
  }
  for (const name of ['revealed','open_threads']) {
    assert(Array.isArray(record[name]) && unique(record[name]) &&
      record[name].length===expected[name].length && expected[name].every(id=>record[name].includes(id)),
    `${article.id}: incorrect clue reveal or unresolved threads`);
  }
  const sentenceIds = new Set(article.paragraphs.flatMap(paragraph=>paragraph.sentences.map(sentence=>sentence.id)));
  assert(record.thread_evidence && Object.keys(record.thread_evidence).length === Object.keys(steps).length &&
    Object.entries(steps).every(([id,step]) => {
      const proof = record.thread_evidence[id];
      return proof?.step === step && nonblank(proof.note) && Array.isArray(proof.sentence_ids) &&
        proof.sentence_ids.length > 0 && unique(proof.sentence_ids) && proof.sentence_ids.every(id=>sentenceIds.has(id));
    }), `${article.id}: missing or invalid clue action evidence`);
  if (wordCount < chapter.target_words.min || wordCount > chapter.target_words.max) {
    assert(nonblank(record.length_exception), `${article.id}: explain word count outside outline target`);
  }
}

export async function serialPacket(root,id,number) {
  const {plans} = await loadSerialPlans(root);
  const outline = plans.get(id);
  const context = chapterContext(outline,number);
  const catalog = await readCatalog(root);
  const canon = new Map();
  for (const planned of outline.chapters.slice(0,number-1)) {
    const entry = catalog.active.get(planned.article_id);
    if (!entry) continue;
    const raw = await readFile(join(entry.reviews,`${entry.id}.${entry.revision}.json`));
    assert(sha256(raw) === entry.evidence_sha256,`${entry.id}: continuity evidence differs from committed bytes`);
    const evidence = JSON.parse(raw);
    assert(evidence.independent?.serial,`${entry.id}: committed continuity record missing`);
    canon.set(planned.chapter,{chapter:planned.chapter,revision:entry.revision,...evidence.independent.serial});
  }
  const prior = [];
  for (const n of context.prior) {
    const planned = outline.chapters[n-1];
    const entry = catalog.active.get(planned.article_id);
    if (entry) {
      await verifyCommitFiles(entry);
      prior.push({chapter:n,revision:entry.revision,article_path:entry.file,continuity:canon.get(n)});
    } else prior.push({chapter:n,article_id:planned.article_id,status:'not_committed'});
  }
  return {series_id:id,bible:`docs/series/${id}.md`,chapter:context.chapter,relevant_prior:prior,
    canon_history:[...canon.values()].map(({chapter,revision,story_day,facts_added,character_changes,revealed,open_threads}) =>
      ({chapter,revision,story_day,facts_added,character_changes,revealed,open_threads})),
    thread_steps:context.steps, expected_revealed:context.revealed,expected_open_threads:context.open_threads,
    version_note:'未提交前章同批生产时，另行读取该章已独立核验的暂存记录。'};
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const [, , action,id,number,...rest] = process.argv;
  assert(rest.length === 0 && ((action === 'check' && !id) || (action === 'packet' && id && number)),
    'usage: serial.mjs check | packet <series-id> <chapter>');
  const result = action === 'check' ? await loadSerialPlans(process.cwd()) : await serialPacket(process.cwd(),id,Number(number));
  console.log(JSON.stringify(action === 'check' ? {series:[...result.plans.keys()],chapters:result.chapters,levels:result.totals} : result,null,2));
}

