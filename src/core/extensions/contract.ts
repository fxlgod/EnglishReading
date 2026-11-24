import type { ReadingLayout } from '../content/types.ts';
import Ajv2020 from 'ajv/dist/2020.js';
import articleSchema from '../../../schemas/article.schema.json' with { type: 'json' };
import type { Sentence } from '../content/types.ts';
import { words } from '../content/words.ts';
import { exactGrammarPolicy } from './grammar-policy.ts';

export const version = 1;
export const kinds = ['work', 'chapter', 'exercise', 'passage', 'key'] as const;
export type Kind = typeof kinds[number];
export type Section = 'novels' | 'grammar';
export const sectionKinds = { novels: ['work', 'chapter'], grammar: ['exercise', 'passage', 'key'] } satisfies Record<Section, Kind[]>;
const prefix = {work:'nw', chapter:'nc', exercise:'ge', passage:'gp', key:'gk'};
export function validId(kind: Kind, id: string) {
  return new RegExp('^'+prefix[kind]+'-[a-z0-9][a-z0-9-]{1,74}$').test(id);
}
export function filePath(kind: Kind, id: string, revision: number) {
  return kind+'/'+id+'.'+revision+'.json';
}
export type Identity = { kind: Kind; id: string; revision: number };
export type Reference = Identity & { path: string; sha256: string };
type Rights = { kind: string; attribution: string; source_url?: string; license_url?: string };
type Paragraphs = { sentences: Sentence[] }[];
type Blank = { id: string; order: number; sentence_id: string; start: number; end: number; cue?: string; points: number };
type Answer = { blank_id: string; canonical_answer: string; accepted_variants: string[]; explanation_zh: string; knowledge_tags: string[] };
type DocumentBase<K extends Kind> = { schema_version: 1; kind: K; id: string; revision: number };
export type NovelWork = DocumentBase<'work'> & {
  title_en: string; title_zh: string; synopsis_zh: string; author: string; translator?: string;
  rights: Rights; cover?: { asset_url: string; rights: Rights }; status: 'ongoing' | 'complete'; chapters: Reference[]; reading_note?: string; unit_titles?: string[];
};
export type NovelChapter = DocumentBase<'chapter'> & {
  work_id: string; number: number; title: string; level: string; paragraphs: Paragraphs; rights: Rights; layout?: ReadingLayout;
};
export type GrammarExercise = DocumentBase<'exercise'> & {
  title: string; difficulty: string; knowledge_tags: string[]; score_policy_id: typeof exactGrammarPolicy.id;
  passage_ref: Reference; key_ref: Reference; blanks: Blank[]; rights: Rights;
};
export type GrammarPassage = DocumentBase<'passage'> & { exercise_id: string; paragraphs: Paragraphs };
export type GrammarKey = DocumentBase<'key'> & { exercise_id: string; exercise_revision: number; passage_sha256: string; answers: Answer[] };
export type ExtensionDocument = NovelWork | NovelChapter | GrammarExercise | GrammarPassage | GrammarKey;
export type Manifest = {
  schema_version: 1; section: Section; content_version: string; entries: Reference[];
  counts: { works: number; chapters: number } | { exercises: number };
  withdrawn_sha256: string;
};
export type Withdrawn = { schema_version: 1; ids: { kind: Kind; id: string }[] };

export const text = { type:'string', minLength:1, pattern:'\\S' };
export const hash = { type:'string', pattern:'^[a-f0-9]{64}$' };
export const positive = { type:'integer', minimum:1, maximum:Number.MAX_SAFE_INTEGER };
const zero = { ...positive, minimum:0 };
export const ident = { type:'string', pattern:'^[a-z0-9][a-z0-9-]{1,79}$' };
const schemaVersion = { const:version };
export function shape(properties: Record<string, unknown>, optional: string[] = []) {
  return { type:'object', properties, required:Object.keys(properties).filter(key=>!optional.includes(key)), additionalProperties:false };
}
export function list(items: object, minItems = 0) { return { type:'array', items, minItems }; }
const uniqueText = { ...list(text,1), uniqueItems:true };
const kind = { enum:kinds };
const identity = { kind, id:ident, revision:positive };
const ref = shape({ ...identity, path:text, sha256:hash });
const rights = shape({
  kind:{enum:['CC-BY','CC-BY-SA','CC0','public_domain','written_permission','project_original']},
  attribution:text, source_url:text, license_url:text,
}, ['source_url','license_url']);
const level = { enum:['A1','A2','B1','B2','C1','C2'] };
const paragraphs = articleSchema.properties.paragraphs;
const schemaFields = {
  work: shape({title_en:text,title_zh:text,synopsis_zh:text,author:text,translator:text,rights,
    status:{enum:['ongoing','complete']},chapters:list(ref,1),cover:shape({asset_url:text,rights}),
    reading_note:text,unit_titles:list(text,1)},['translator','cover','reading_note','unit_titles']),
  chapter: shape({work_id:ident,number:positive,title:text,level,paragraphs,rights,layout:shape({
    blockquote:{...list(positive),uniqueItems:true},breaks_after:{...list(positive),uniqueItems:true},
    emphasis:list(shape({sentence_id:text,start:zero,end:positive,tag:{enum:['em','strong']}})),
  })},['layout']),
  exercise: shape({title:text,difficulty:text,knowledge_tags:uniqueText,score_policy_id:{const:exactGrammarPolicy.id},rights,
    passage_ref:ref,key_ref:ref,blanks:list(shape({id:ident,order:positive,sentence_id:text,start:zero,end:positive,cue:text,points:positive},['cue']),1)}),
  passage: shape({exercise_id:ident,paragraphs}),
  key: shape({exercise_id:ident,exercise_revision:positive,passage_sha256:hash,
    answers:list(shape({blank_id:ident,canonical_answer:text,accepted_variants:{...list(text),uniqueItems:true},explanation_zh:text,knowledge_tags:uniqueText}),1)}),
};
export const ajv = new Ajv2020({allErrors:true});
export const documentSchema = { oneOf:kinds.map(k=>{
  const fields=schemaFields[k];
  const base={schema_version:schemaVersion,...identity,kind:{const:k}};
  return {...fields,properties:{...base,...fields.properties},required:[...Object.keys(base),...fields.required]};
}) };
const checkDocument = ajv.compile<ExtensionDocument>(documentSchema);
const checkManifest = ajv.compile<Manifest>({oneOf:[
  ['novels', shape({works:zero,chapters:zero})], ['grammar', shape({exercises:zero})],
].map(([section, counts])=>shape({schema_version:schemaVersion,section:{const:section},content_version:hash,
  entries:list(ref),counts,withdrawn_sha256:hash}))});
const checkWithdrawn = ajv.compile<Withdrawn>(shape({schema_version:schemaVersion,ids:list(shape({kind,id:ident}))}));

export function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function validateRef(ref: Reference, expected?: Kind) {
  requireValid((!expected || expected===ref.kind) && validId(ref.kind,ref.id) &&
    ref.path === filePath(ref.kind,ref.id,ref.revision), 'Invalid extension reference or path');
}
function checkHttps(value: string) {
  const url = new URL(value);
  requireValid(url.protocol==='https:' && !url.username && !url.password, 'Unsafe attribution URL');
}
export function validateDocument(raw: unknown): ExtensionDocument {
  requireValid(checkDocument(raw), 'Invalid extension document: '+ajv.errorsText(checkDocument.errors));
  requireValid(validId(raw.kind,raw.id), 'Invalid extension ID namespace');
  if ('rights' in raw) {
    for (const url of [raw.rights.source_url,raw.rights.license_url]) if (url) checkHttps(url);
  }
  if ('paragraphs' in raw) {
    const ids = new Set<string>();
    for (const {sentences} of raw.paragraphs) for (const s of sentences) {
      requireValid(s.id.trim() && s.translation_zh.trim() && !ids.has(s.id), 'Invalid or duplicate sentence ID/translation');
      ids.add(s.id);
      const expected = words(s.text);
      requireValid(expected.length===s.tokens.length && s.tokens.every((t,index)=>
        t.start===expected[index].start && t.end===expected[index].end && t.surface===expected[index].surface &&
        t.lemma.trim() && t.pos.trim() && t.gloss_zh.trim()), 'Invalid UTF-16 token coverage');
      const starts=new Set(s.tokens.map(t=>t.start)), ends=new Set(s.tokens.map(t=>t.end));
      requireValid(s.phrases.every(p=>p.start<p.end && starts.has(p.start) && ends.has(p.end) &&
        p.surface===s.text.slice(p.start,p.end) && p.gloss_zh.trim()), 'Invalid UTF-16 phrase');
    }
  }
  if (raw.kind==='work') {
    for (const ref of raw.chapters) validateRef(ref,'chapter');
    requireValid(!raw.unit_titles || raw.unit_titles.length===raw.chapters.length,'Unit titles do not match the directory');
    if (raw.cover) {
      checkHttps(raw.cover.asset_url);
      for (const url of [raw.cover.rights.source_url,raw.cover.rights.license_url]) if (url) checkHttps(url);
    }
  }
  if (raw.kind==='chapter') {
    requireValid(validId('work',raw.work_id), 'Invalid chapter owner');
    if (raw.layout) {
      const {blockquote,breaks_after,emphasis}=raw.layout;
      requireValid([...blockquote,...breaks_after].every(index=>index<=raw.paragraphs.length),'Invalid novel paragraph reference');
      const sentences=new Map(raw.paragraphs.flatMap(p=>p.sentences.map(s=>[s.id,s.text] as const)));
      const ends=new Map<string,number>();
      for (const span of emphasis) {
        const text=sentences.get(span.sentence_id);
        requireValid(text!==undefined && span.start>= (ends.get(span.sentence_id) ?? 0) && span.start<span.end &&
          span.end<=text.length && [span.start,span.end].every(index=>!(text.charCodeAt(index)>=0xdc00 && text.charCodeAt(index)<=0xdfff)),
          'Invalid novel emphasis range');
        ends.set(span.sentence_id,span.end);
      }
    }
  }
  if (raw.kind==='exercise') {
    validateRef(raw.passage_ref,'passage');
    validateRef(raw.key_ref,'key');
  }
  if (raw.kind==='passage' || raw.kind==='key') requireValid(validId('exercise',raw.exercise_id), 'Invalid exercise owner');
  return raw;
}
export const identityKey = ({kind,id}: {kind:Kind;id:string}) => kind+':'+id;
export const sameReference = (a: Reference, b: Reference) =>
  a.kind===b.kind && a.id===b.id && a.revision===b.revision && a.path===b.path && a.sha256===b.sha256;
export function countsFor(section: Section, entries: Reference[]) {
  return section==='novels' ? {
    works:entries.filter(e=>e.kind==='work').length, chapters:entries.filter(e=>e.kind==='chapter').length,
  } : { exercises:entries.filter(e=>e.kind==='exercise').length };
}
export function manifestPayload(m: Omit<Manifest,'content_version'>) {
  const {schema_version,section,entries,counts,withdrawn_sha256}=m;
  return {schema_version,section,entries,counts,withdrawn_sha256};
}
export function validateManifest(raw: unknown, section: Section): Manifest {
  requireValid(checkManifest(raw) && raw.section===section, 'Invalid extension manifest');
  const ids=new Set<string>();
  const allowed: readonly Kind[] = sectionKinds[section];
  for (const ref of raw.entries) {
    validateRef(ref);
    requireValid(allowed.includes(ref.kind) && !ids.has(identityKey(ref)), 'Duplicate ID or wrong manifest section');
    ids.add(identityKey(ref));
  }
  const expected: Record<string,number | undefined> = countsFor(section,raw.entries);
  requireValid(Object.entries(raw.counts).every(([name,value])=>expected[name]===value), 'Invalid extension counts');
  return raw;
}
export function validateWithdrawn(raw: unknown, section: Section): Withdrawn {
  const allowed: readonly Kind[] = sectionKinds[section];
  requireValid(checkWithdrawn(raw) && new Set(raw.ids.map(identityKey)).size===raw.ids.length &&
    raw.ids.every(({kind,id})=>allowed.includes(kind) && validId(kind,id)), 'Invalid withdrawal index');
  return raw;
}
export function validateExercise(exercise: GrammarExercise, passage: GrammarPassage, key?: GrammarKey) {
  requireValid(passage.exercise_id===exercise.id, 'Wrong passage owner');
  const sequence=passage.paragraphs.flatMap(p=>p.sentences);
  const sentences=new Map(sequence.map(s=>[s.id,s]));
  const ordered=new Map(sequence.map((s,index)=>[s.id,index]));
  const ids=new Set<string>();
  const ends=new Map<string,number>();
  let points=0, lastSentence=-1;
  for (const [index,blank] of exercise.blanks.entries()) {
    const s=sentences.get(blank.sentence_id), position=ordered.get(blank.sentence_id);
    requireValid(!ids.has(blank.id) && blank.order===index+1 && blank.start<blank.end && s &&
      s.tokens.some(t=>t.start===blank.start) && s.tokens.some(t=>t.end===blank.end) &&
      position!==undefined && position>=lastSentence && blank.start >= (ends.get(blank.sentence_id) ?? 0), 'Duplicate or invalid blank range/order');
    ids.add(blank.id);
    ends.set(blank.sentence_id,blank.end);
    lastSentence=position;
    points+=blank.points;
  }
  requireValid(Number.isSafeInteger(points), 'Invalid total points');
  if (!key) return;
  requireValid(key.exercise_id===exercise.id && key.exercise_revision===exercise.revision &&
    key.passage_sha256===exercise.passage_ref.sha256 && key.answers.length===ids.size, 'Invalid answer key binding');
  const answers=new Map(key.answers.map(a=>[a.blank_id,a]));
  requireValid(answers.size===ids.size,'Duplicate answers');
  for (const b of exercise.blanks) {
    const a=answers.get(b.id);
    const canonical=sentences.get(b.sentence_id)!.text.slice(b.start,b.end);
    requireValid(a && a.canonical_answer===canonical && new Set([canonical,...a.accepted_variants].map(exactGrammarPolicy.normalize)).size===a.accepted_variants.length+1, 'Missing canonical answer or duplicate answer variants');
  }
}
