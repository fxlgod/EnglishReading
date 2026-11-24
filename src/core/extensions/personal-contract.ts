import { ajv, hash, ident, list, positive, shape, validId } from './contract.ts';

type WorkRef = {kind:'work';id:string;revision:number};
type ChapterRef = {kind:'chapter';id:string;revision:number;workId:string};
type ExerciseRef = {kind:'exercise';id:string;revision:number};
type Progress = {source:ChapterRef;sentenceId:string;completed:boolean;updatedAt:string};
export type ScoreBinding = {exerciseSha256:string;passageSha256:string;keySha256:string};
export type Draft = {source:ExerciseRef;startedAt:string;updatedAt:string;revealed:boolean;inputs:{blankId:string;input:string}[];
  attemptId?:string;binding?:ScoreBinding;reviewBlankIds?:string[]};
type Result = {blankId:string;input:string;status:'correct'|'incorrect'|'unanswered';points:number;maxPoints:number;
  feedback?:{canonical:string;variants:string[];explanation:string;knowledgeTags:string[]}};
export type Attempt = {
  source:ExerciseRef;attemptId:string;startedAt:string;submittedAt:string;revealed:boolean;
  scorePolicyId:'exact-v1';score:number;maxScore:number;results:Result[];binding?:ScoreBinding;reviewBlankIds?:string[];
};
export type WrongItem = {
  source:ExerciseRef;blankId:string;attemptId:string;state:'pending'|'resolved';updatedAt:string;
};
export type ExtensionWord = {
  source:ChapterRef|ExerciseRef;sentenceId:string;kind:'word'|'phrase';start:number;end:number;
  surface:string;lemma:string;pos:string;gloss:string;sentence:string;createdAt:string;
};

export type PersonalRecords = {
  favorites: {source:WorkRef;createdAt:string}[];
  progress: Progress[];
  drafts: Draft[];
  attempts: Attempt[];
  wrongItems: WrongItem[];
  vocab: ExtensionWord[];
};
export const personalTables = ['favorites','progress','drafts','attempts','wrongItems','vocab'] as const;
export type PersonalTable = typeof personalTables[number];
export type PersonalRow = PersonalRecords[PersonalTable][number];

export const backupLimit = 5 * 1024 * 1024;
export const backupFormat = 'english-reading-extensions' as const;
export type ExtensionBackup = {format:typeof backupFormat;format_version:1;exported_at:string;records:PersonalRecords};

const string = (maxLength:number,minLength=1) => ({type:'string',minLength,maxLength});
const iso = string(24,20);
const input = string(2048,0);
const sentenceId = string(256);
const bool = {type:'boolean'};
const nonnegative = {...positive,minimum:0};
const work = shape({kind:{const:'work'},id:ident,revision:positive});
const chapter = shape({kind:{const:'chapter'},id:ident,revision:positive,workId:ident});
const exercise = shape({kind:{const:'exercise'},id:ident,revision:positive});
const binding=shape({exerciseSha256:hash,passageSha256:hash,keySha256:hash});
const reviewBlankIds={...list(ident,1),uniqueItems:true};
const feedback=shape({canonical:string(2048),variants:list(string(2048)),
  explanation:string(32768),knowledgeTags:list(string(512),1)});
const rowSchemas = {
  favorites:shape({source:work,createdAt:iso}),
  progress:shape({source:chapter,sentenceId,completed:bool,updatedAt:iso}),
  drafts:shape({source:exercise,startedAt:iso,updatedAt:iso,revealed:bool,inputs:list(shape({blankId:ident,input})),
    attemptId:ident,binding,reviewBlankIds},['attemptId','binding','reviewBlankIds']),
  attempts:shape({source:exercise,attemptId:ident,startedAt:iso,submittedAt:iso,revealed:bool,
    scorePolicyId:{const:'exact-v1'},score:nonnegative,maxScore:positive,results:list(shape({
      blankId:ident,input,status:{enum:['correct','incorrect','unanswered']},points:nonnegative,maxPoints:positive,
      feedback,
    },['feedback']),1),binding,reviewBlankIds},['binding','reviewBlankIds']),
  wrongItems:shape({source:exercise,blankId:ident,attemptId:ident,state:{enum:['pending','resolved']},updatedAt:iso}),
  vocab:shape({source:{oneOf:[chapter,exercise]},sentenceId,kind:{enum:['word','phrase']},start:nonnegative,end:positive,
    surface:string(512),lemma:string(512),pos:string(128),gloss:string(4096),sentence:string(32768),createdAt:iso}),
};
const recordFields=Object.fromEntries(personalTables.map(table=>[table,list(rowSchemas[table])]));
const validatePatchSchema=ajv.compile<Partial<PersonalRecords>>(shape(recordFields,[...personalTables]));
const validateRecordsSchema=ajv.compile<PersonalRecords>(shape(recordFields));
const validateEnvelope=ajv.compile<ExtensionBackup>(shape({format:{const:backupFormat},format_version:{const:1},exported_at:iso,records:{type:'object'}}));

export function emptyRecords(): PersonalRecords {
  return {favorites:[],progress:[],drafts:[],attempts:[],wrongItems:[],vocab:[]};
}
export function personalKey(row: PersonalRow): string {
  const {source}=row;
  const ref=[source.kind,source.id,source.revision];
  if ('attemptId' in row && 'results' in row) return JSON.stringify([...ref,row.attemptId]);
  if ('blankId' in row) return JSON.stringify([...ref,row.blankId]);
  if ('surface' in row) return JSON.stringify([...ref,row.sentenceId,row.kind,row.start,row.end]);
  return JSON.stringify(source.kind==='work'?ref.slice(0,2):ref);
}
export function attemptKey(row: Pick<WrongItem,'source'|'attemptId'>) {
  return JSON.stringify([row.source.kind,row.source.id,row.source.revision,row.attemptId]);
}
export function rowTime(row: PersonalRow) {
  return Date.parse('updatedAt' in row?row.updatedAt:'submittedAt' in row?row.submittedAt:row.createdAt);
}
function invalid(message:string):never { throw new Error(message); }
function isTime(value:string) {
  const parsed=Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString()===value.replace(/(\d\d:\d\d:\d\d)Z$/,'$1.000Z');
}
function validateText(value: unknown) {
  if (typeof value==='string' && /<\s*[a-z!?/]/i.test(value)) invalid('记录含有不允许的标记。');
  if (value && typeof value==='object') for (const part of Object.values(value)) validateText(part);
}
function uniqueBlanks(items: {blankId:string}[]) {
  if (new Set(items.map(x=>x.blankId)).size!==items.length) invalid('题目空位重复。');
}
export function verifyWrongItem(row: WrongItem, attempt: Attempt|undefined) {
  if (!attempt || attemptKey(row)!==personalKey(attempt) ||
    !attempt.results.some(result=>result.blankId===row.blankId && result.status!=='correct') ||
    Date.parse(attempt.submittedAt)>Date.parse(row.updatedAt)) invalid('错题与作答记录不匹配。');
}

function validateRecord(row: PersonalRow) {
  validateText(row);
  if (!validId(row.source.kind,row.source.id) ||
    (row.source.kind==='chapter' && !validId('work',row.source.workId))) invalid('来源 ID 或专区不匹配。');
  const date='updatedAt' in row?row.updatedAt:'submittedAt' in row?row.submittedAt:row.createdAt;
  if (!isTime(date) || ('startedAt' in row && (!isTime(row.startedAt)||Date.parse(row.startedAt)>Date.parse(date)))) {
    invalid('记录时间无效。');
  }
  if ('sentenceId' in row && !row.sentenceId.trim()) invalid('句子 ID 无效。');
  if ('surface' in row) {
    if (row.start>=row.end || row.end>row.sentence.length || row.sentence.slice(row.start,row.end)!==row.surface ||
      [row.start,row.end].some(i=>i>0 && i<row.sentence.length && /[\uDC00-\uDFFF]/.test(row.sentence[i]) && /[\uD800-\uDBFF]/.test(row.sentence[i-1]))) {
      invalid('生词 UTF-16 范围与正文不一致。');
    }
    if (![row.lemma,row.surface,row.pos,row.gloss].every(value=>value.trim())) invalid('生词释义不完整。');
  }
  if ('inputs' in row) {
    uniqueBlanks(row.inputs);
    if (Boolean(row.attemptId)!==Boolean(row.binding) ||
      (row.reviewBlankIds && (!row.binding || row.inputs.some(input=>!row.reviewBlankIds!.includes(input.blankId))))) invalid('草稿作答身份或复练范围无效。');
  }
  if ('results' in row) {
    uniqueBlanks(row.results);
    if (row.results.some(result=>Boolean(result.feedback)!==Boolean(row.binding)) ||
      (row.reviewBlankIds && (!row.binding || row.reviewBlankIds.length!==row.results.length ||
        row.results.some(result=>!row.reviewBlankIds!.includes(result.blankId))))) invalid('评分快照绑定或复练范围无效。');
    let points=0,max=0;
    for (const result of row.results) {
      if (result.points!==(result.status==='correct'?result.maxPoints:0) ||
        (result.status==='unanswered')!==!result.input.trim()) invalid('作答状态和分数不匹配。');
      points+=result.points;
      max+=result.maxPoints;
    }
    if (row.score!==points || row.maxScore!==max) invalid('作答总分不匹配。');
  }
}
function validateRows(data: Partial<PersonalRecords>) {
  for (const table of personalTables) {
    const seen=new Set<string>();
    for (const row of data[table] ?? []) {
      validateRecord(row);
      const key=personalKey(row);
      if (seen.has(key)) invalid('记录键重复。');
      seen.add(key);
    }
  }
}
export function validatePatch(value:unknown): Partial<PersonalRecords> {
  if (!validatePatchSchema(value)) invalid('扩展记录格式错误或含未知字段。');
  validateRows(value);
  return value;
}
export function validateRecords(value:unknown): PersonalRecords {
  if (!validateRecordsSchema(value)) invalid('扩展数据表格式错误或含未知字段。');
  validateRows(value);
  const attempts=new Map(value.attempts.map(row=>[personalKey(row),row]));
  for (const wrong of value.wrongItems) verifyWrongItem(wrong,attempts.get(attemptKey(wrong)));
  return value;
}
export function validateExtensionBackup(value:unknown): ExtensionBackup {
  if (value && typeof value==='object' && 'format' in value && value.format===backupFormat &&
    'format_version' in value && value.format_version!==1) invalid('扩展备份版本不受支持。');
  if (!validateEnvelope(value) || !isTime(value.exported_at)) invalid('扩展备份格式或导出时间无效。');
  validateRecords(value.records);
  return value;
}
export async function readExtensionBackup(file:Blob): Promise<ExtensionBackup> {
  if (file.size>backupLimit) invalid('扩展备份超过 5 MiB。');
  let value:unknown;
  try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())); }
  catch { invalid('扩展备份必须为有效的 UTF-8 JSON。'); }
  return validateExtensionBackup(value);
}
