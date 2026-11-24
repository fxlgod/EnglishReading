import {
  attemptKey, backupFormat, backupLimit, emptyRecords, personalKey, personalTables, readExtensionBackup,
  rowTime, validatePatch, validateRecords, verifyWrongItem,
} from './personal-contract.ts';
import type { Attempt, Draft, ExtensionBackup, PersonalRecords, PersonalRow, PersonalTable } from './personal-contract.ts';

export const databaseName = 'english-reading-extensions';
const databaseVersion = 1;
const temporaryNotice = '扩展存储不可用。记录仅保存在当前页面，关闭后会丢失。';
type Status = {mode:'persistent'} | {mode:'temporary';warning:string};
type ErrorCode = 'incompatible'|'blocked'|'unavailable'|'quota'|'read'|'write'|'conflict'|'temporary';
export class ExtensionStorageError extends Error {
  readonly code: ErrorCode;
  constructor(code:ErrorCode,message:string,options?:ErrorOptions) {
    super(message,options);
    this.name='ExtensionStorageError';
    this.code=code;
  }
}
type Removable = 'favorites'|'drafts'|'vocab';
type Opened = {mode:'persistent';database:IDBDatabase}|{mode:'temporary';warning:string};
const grammarTables=['drafts','attempts','wrongItems'] as const;
type GrammarRows=Pick<PersonalRecords,typeof grammarTables[number]>;
type Mutation<T>={changes:Partial<GrammarRows>;value:T};
type Operation = (tx:IDBTransaction, enqueue:(action:()=>void)=>void)=>void;

function transaction(db:IDBDatabase,tables:readonly PersonalTable[],mode:IDBTransactionMode,apply:Operation) {
  return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction([...tables],mode);
    let thrown:unknown;
    const enqueue = (action:()=>void) => {
      try { action(); }
      catch (error) { thrown=error; tx.abort(); }
    };
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(thrown ?? tx.error ?? new DOMException('Extension transaction aborted','AbortError'));
    enqueue(()=>apply(tx,enqueue));
  });
}
function storageFailure(error:unknown, op:'read'|'write') {
  if (error instanceof ExtensionStorageError) return error;
  if (error instanceof DOMException && error.name==='QuotaExceededError') {
    return new ExtensionStorageError('quota','本机存储空间不足，本次写入未完成，原记录已保留。',{cause:error});
  }
  return new ExtensionStorageError(op,op==='write'?'扩展记录写入失败，原记录已保留。':'无法读取扩展记录。',{cause:error});
}
function canonical(value:unknown) {
  return JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
}
function mergeRow(table:PersonalTable,incoming:PersonalRow,stored:PersonalRow|undefined):PersonalRow|undefined {
  if (!stored) return incoming;
  if (table==='attempts') {
    if (canonical(stored)!==canonical(incoming)) throw new ExtensionStorageError('conflict','该版本的作答已提交，现有评分快照已保留。');
    return undefined;
  }
  if (stored.source.kind==='chapter' && incoming.source.kind==='chapter' && stored.source.workId!==incoming.source.workId) {
    throw new ExtensionStorageError('conflict','章节归属与已保存的记录不一致。');
  }
  const newer=rowTime(incoming)>rowTime(stored)?incoming:stored;
  if (table==='drafts' && 'inputs' in incoming && 'inputs' in stored && 'inputs' in newer &&
    incoming.startedAt===stored.startedAt && !newer.revealed && (incoming.revealed || stored.revealed)) {
    return {...newer,revealed:true};
  }
  return newer===stored?undefined:newer;
}

export function createExtensionPersonalStore() {
  let opening: Promise<Opened>|undefined;
  let memory=emptyRecords();
  const temporary=(): Opened=>({mode:'temporary',warning:temporaryNotice});
  function open() {
    if (opening) return opening;
    opening=new Promise<Opened>((resolve,reject)=>{
      let req: IDBOpenDBRequest;
      try {
        if (typeof globalThis.indexedDB==='undefined') { resolve(temporary()); return; }
        req=globalThis.indexedDB.open(databaseName,databaseVersion);
      } catch (cause) {
        if (cause instanceof DOMException && ['SecurityError','InvalidStateError'].includes(cause.name)) resolve(temporary());
        else reject(storageFailure(cause,'read'));
        return;
      }
      let blocked=false;
      req.onupgradeneeded=()=>{
        if (blocked) { req.transaction!.abort(); return; }
        for (const table of personalTables) req.result.createObjectStore(table);
      };
      req.onblocked=()=>{
        blocked=true;
        reject(new ExtensionStorageError('blocked','扩展数据库被其他页面占用，请关闭相关页面后重试。'));
      };
      req.onerror=()=>{
        const error=req.error;
        if (error?.name==='VersionError') reject(new ExtensionStorageError('incompatible','扩展数据库由较新版本创建，原记录已保留。',{cause:error}));
        else if (error && ['SecurityError','InvalidStateError','UnknownError'].includes(error.name)) resolve(temporary());
        else reject(storageFailure(error,'read'));
      };
      req.onsuccess=()=>{
        const db=req.result;
        if (blocked) { db.close(); return; }
        const validStores=db.objectStoreNames.length===personalTables.length &&
          personalTables.every(table=>db.objectStoreNames.contains(table));
        if (!validStores || personalTables.some(table=>db.transaction(table).objectStore(table).keyPath!==null)) {
          db.close();
          reject(new ExtensionStorageError('incompatible','扩展数据库结构不受支持，原记录已保留。'));
          return;
        }
        db.onversionchange=()=>{ db.close(); opening=undefined; };
        resolve({mode:'persistent',database:db});
      };
    }).catch(error=>{ opening=undefined; throw error; });
    return opening;
  }
  const status = (opened:Opened): Status => opened.mode==='temporary'?opened:{mode:'persistent'};
  async function snapshot() {
    const opened=await open();
    if (opened.mode==='temporary') return {status:status(opened),records:structuredClone(memory)};
    const data=emptyRecords();
    try {
      await transaction(opened.database,personalTables,'readonly',(tx,enqueue)=>{
        for (const table of personalTables) {
          const read=tx.objectStore(table).getAll();
          read.onsuccess=()=>enqueue(()=>{ Object.assign(data,{[table]:read.result}); });
        }
      });
      return {status:status(opened),records:validateRecords(data)};
    } catch(error) { throw storageFailure(error,'read'); }
  }
  async function merge(opened:Opened,data:Partial<PersonalRecords>) {
    if (opened.mode==='temporary') {
      const next=emptyRecords();
      for (const table of personalTables) {
        const rows=new Map<string,PersonalRow>(memory[table].map(row=>[personalKey(row),row]));
        for (const row of data[table] ?? []) {
          const key=personalKey(row);
          const merged=mergeRow(table,row,rows.get(key));
          if (merged) rows.set(key,merged);
        }
        Object.assign(next,{[table]:[...rows.values()]});
      }
      memory=validateRecords(next);
      return;
    }
    const inputAttempts=new Map(data.attempts?.map(row=>[personalKey(row),row]));
    try {
      await transaction(opened.database,personalTables,'readwrite',(tx,enqueue)=>{
        for (const table of personalTables) {
          const store=tx.objectStore(table);
          for (const row of data[table] ?? []) {
            const key=personalKey(row);
            const write=()=>{
              const previous=store.get(key);
              previous.onsuccess=()=>enqueue(()=>{
                const saved=previous.result;
                if (saved!==undefined) validatePatch({[table]:[saved]});
                const merged=mergeRow(table,row,saved);
                if (merged) store.put(merged,key);
              });
            };
            if ('blankId' in row) {
              const key=attemptKey(row);
              const incoming=inputAttempts.get(key);
              if (incoming) {
                verifyWrongItem(row,incoming);
                write();
              } else {
                const read=tx.objectStore('attempts').get(key);
                read.onsuccess=()=>enqueue(()=>{
                  const stored=read.result as Attempt|undefined;
                  if (stored!==undefined) validatePatch({attempts:[stored]});
                  verifyWrongItem(row,stored);
                  write();
                });
              }
            } else write();
          }
        }
      });
    } catch(error) { throw storageFailure(error,'write'); }
  }
  async function mutateGrammar<T>(source:Draft['source'],change:(rows:GrammarRows)=>Mutation<T>) {
    const opened=await open();
    const draftKey=JSON.stringify([source.kind,source.id,source.revision]);
    const prefix=draftKey.slice(0,-1)+',';
    const matches=(row:PersonalRow)=>row.source.kind===source.kind && row.source.id===source.id && row.source.revision===source.revision;
    function verified(rows:GrammarRows) {
      validatePatch(rows);
      const mutation=change(rows);
      validatePatch(mutation.changes);
      const attempts=new Map(rows.attempts.map(item=>[personalKey(item),item]));
      for(const row of mutation.changes.attempts ?? []) {
        mergeRow('attempts',row,attempts.get(personalKey(row)));
        attempts.set(personalKey(row),row);
      }
      for(const table of grammarTables) {
        if(!(mutation.changes[table]??[]).every(matches)) throw new Error('作答事务包含其他套题的记录。');
      }
      for(const row of mutation.changes.wrongItems??[]) verifyWrongItem(row,attempts.get(attemptKey(row)));
      return mutation;
    }
    if(opened.mode==='temporary') {
      const mutation=verified({drafts:memory.drafts.filter(matches),attempts:memory.attempts.filter(matches),wrongItems:memory.wrongItems.filter(matches)});
      await merge(opened,mutation.changes);
      return {value:mutation.value,status:status(opened)};
    }
    let result:T|undefined;
    try {
      await transaction(opened.database,grammarTables,'readwrite',(tx,enqueue)=>{
        const rows:GrammarRows={drafts:[],attempts:[],wrongItems:[]};
        let pending=grammarTables.length;
        for(const table of grammarTables) {
          const read=table==='drafts'?tx.objectStore(table).get(draftKey):
            tx.objectStore(table).getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'));
          read.onsuccess=()=>enqueue(()=>{
            Object.assign(rows,{[table]:table==='drafts'?(read.result?[read.result]:[]):read.result});
            if(--pending>0) return;
            const {changes,value}=verified(rows);
            for(const name of grammarTables) for(const row of changes[name]??[]) tx.objectStore(name).put(row,personalKey(row));
            result=value;
          });
        }
      });
      return {value:result as T,status:status(opened)};
    } catch(error) {throw storageFailure(error,'write');}
  }
  return {
    mutateGrammar,
    async snapshot() { return snapshot(); },
    async save(data:Partial<PersonalRecords>):Promise<Status> {
      const validated=validatePatch(structuredClone(data));
      const opened=await open();
      await merge(opened,validated);
      return status(opened);
    },
    async remove<T extends Removable>(table:T,row:PersonalRecords[T][number]):Promise<Status> {
      if (table!=='favorites' && table!=='drafts' && table!=='vocab') throw new Error('该数据表不允许删除单条记录。');
      const validated=validatePatch({[table]:[structuredClone(row)]});
      const key=personalKey(validated[table]![0]);
      const opened=await open();
      if (opened.mode==='temporary') {
        Object.assign(memory,{[table]:memory[table].filter(row=>personalKey(row)!==key)});
      } else {
        try { await transaction(opened.database,[table],'readwrite',tx=>{tx.objectStore(table).delete(key);}); }
        catch(error) { throw storageFailure(error,'write'); }
      }
      return status(opened);
    },
    async exportBackup() {
      const {records,status}=await snapshot();
      const data:ExtensionBackup={format:backupFormat,format_version:1,exported_at:new Date().toISOString(),records};
      const file=new Blob([JSON.stringify(data)],{type:'application/json'});
      if (file.size>backupLimit) throw new Error('扩展备份超过 5 MiB。');
      return {file,status};
    },
    async importBackup(file:Blob) {
      const {records}=await readExtensionBackup(file);
      const opened=await open();
      if (opened.mode==='temporary') throw new ExtensionStorageError('temporary',temporaryNotice+' 当前无法导入持久化备份。');
      await merge(opened,records);
      return status(opened);
    },
  };
}
export const extensionPersonalStore = createExtensionPersonalStore();
