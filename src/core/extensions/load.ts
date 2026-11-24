import {
  identityKey, manifestPayload, requireValid, sameReference, validateDocument, validateExercise,
  validateManifest, validateWithdrawn, validId, version,
} from './contract.ts';
import type { Identity, Kind, Reference, Section } from './contract.ts';

type ErrorCode = 'missing' | 'withdrawn' | 'offline' | 'unsupported' | 'invalid' | 'unavailable';
export class ExtensionContentError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = 'ExtensionContentError';
  }
}
async function digest(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte=>byte.toString(16).padStart(2,'0')).join('');
}
const decoder = new TextDecoder('utf-8',{fatal:true});

export function createExtensionLoader(base: URL) {
  async function get(section: Section, path: string, sha?: string, catalogue = false): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(section+'/'+path,base),{signal:AbortSignal.timeout(10_000),redirect:'error',
        ...(catalogue && {headers:{'X-Reading-Catalogue':'1'}})});
    } catch (cause) {
      throw new ExtensionContentError(globalThis.navigator?.onLine===false?'offline':'unavailable',path,{cause});
    }
    const reason=response.headers.get('X-Reading-Cache');
    if (reason==='offline-miss' || reason==='offline-corrupt') throw new ExtensionContentError('offline',path);
    if (response.status===410) throw new ExtensionContentError('withdrawn',path);
    if (response.status===404) throw new ExtensionContentError('missing',path);
    if (!response.ok) throw new ExtensionContentError('unavailable',path);
    const bytes=await response.arrayBuffer();
    if (sha && sha!==await digest(bytes)) throw new ExtensionContentError('invalid','SHA-256 mismatch: '+path);
    let data: unknown;
    try { data=JSON.parse(decoder.decode(bytes)); }
    catch (cause) { throw new ExtensionContentError('invalid','Invalid JSON: '+path,{cause}); }
    if (typeof data==='object' && data!==null && 'schema_version' in data && data.schema_version!==version) {
      throw new ExtensionContentError('unsupported',path);
    }
    return data;
  }
  async function open(section: Section) {
    const manifest=validateManifest(await get(section,'manifest.json'),section);
    const payload=new TextEncoder().encode(JSON.stringify(manifestPayload(manifest))+'\n');
    requireValid(await digest(payload.buffer)===manifest.content_version,'Invalid manifest version hash');
    const entries=new Map(manifest.entries.map(ref=>[identityKey(ref),{...ref}]));
    function bound(ref: Reference) {
      const listed=entries.get(identityKey(ref));
      requireValid(listed && sameReference(listed,ref),'Missing or stale extension reference');
      return listed;
    }
    async function lookup(kind: Kind, id: string) {
      requireValid(validId(kind,id),'Invalid extension ID');
      const ref=entries.get(identityKey({kind,id}));
      if (ref) return ref;
      const retired=validateWithdrawn(await get(section,'withdrawn.json',manifest.withdrawn_sha256),section);
      requireValid(retired.ids.every(item=>!entries.has(identityKey(item))),'Active object in withdrawal index');
      throw new ExtensionContentError(retired.ids.some(item=>item.kind===kind && item.id===id)?'withdrawn':'missing',id);
    }
    async function read(ref: Reference, catalogue = false) {
      const doc=validateDocument(await get(section,ref.path,ref.sha256,catalogue));
      const expected: Identity=ref;
      requireValid(doc.kind===expected.kind && doc.id===expected.id && doc.revision===expected.revision, 'Extension reference mismatch');
      return doc;
    }
    return {manifest, bound, lookup, read};
  }
  async function checked<T>(fn:()=>Promise<T>) {
    try { return await fn(); }
    catch(cause) {
      if (cause instanceof ExtensionContentError) throw cause;
      throw new ExtensionContentError('invalid',cause instanceof Error?cause.message:'Invalid extension data',{cause});
    }
  }
  return {
    openNovels: () => checked(async()=>{
      const {manifest,bound,lookup,read}=await open('novels');
      async function work(id: string) {
        const doc=await read(await lookup('work',id));
        requireValid(doc.kind==='work' && new Set(doc.chapters.map(ref=>ref.id)).size===doc.chapters.length,'Invalid work directory');
        doc.chapters.forEach(bound);
        return doc;
      }
      return {
        manifest,
        loadWork: (id: string)=>checked(()=>work(id)),
        loadChapter: (workId: string, chapterId: string)=>checked(async()=>{
          const parent=await work(workId);
          return readChapter(parent,chapterId);
        }),
        loadReading: (workId:string,chapterId:string)=>checked(async()=>{
          const workDoc=await work(workId);
          return {work:workDoc,chapter:await readChapter(workDoc,chapterId)};
        }),
      };
      async function readChapter(parent:Awaited<ReturnType<typeof work>>,chapterId:string) {
        const index=parent.chapters.findIndex(ref=>ref.id===chapterId);
        const ref=await lookup('chapter',chapterId);
        requireValid(index>=0 && sameReference(parent.chapters[index],ref),'Chapter is outside the work');
        const child=await read(ref);
        requireValid(child.kind==='chapter' && child.work_id===parent.id && child.number===index+1,'Invalid chapter ownership or order');
        return child;
      }
    }),
    openGrammar: () => checked(async()=>{
      const {manifest,bound,lookup,read}=await open('grammar');
      async function exercise(id: string, catalogue = false) {
        const doc=await read(await lookup('exercise',id),catalogue);
        requireValid(doc.kind==='exercise','Invalid exercise reference');
        bound(doc.passage_ref);
        bound(doc.key_ref);
        return doc;
      }
      async function passage(doc: Awaited<ReturnType<typeof exercise>>) {
        const data=await read(doc.passage_ref);
        requireValid(data.kind==='passage','Invalid passage reference');
        validateExercise(doc,data);
        return data;
      }
      return {
        manifest,
        loadExercise: (id: string)=>checked(()=>exercise(id)),
        loadCatalogueExercise: (id: string)=>checked(()=>exercise(id,true)),
        loadPassage: (id: string)=>checked(async()=>passage(await exercise(id))),
        loadKey: (id: string)=>checked(async()=>{
          const doc=await exercise(id);
          const [text,key]=await Promise.all([passage(doc),read(doc.key_ref)]);
          requireValid(key.kind==='key','Invalid answer key reference');
          validateExercise(doc,text,key);
          return key;
        }),
        async loadScoring(id:string) {
          return checked(async()=>{
            const doc=await exercise(id);
            const [text,key]=await Promise.all([passage(doc),read(doc.key_ref)]);
            requireValid(key.kind==='key','Invalid answer key reference');
            validateExercise(doc,text,key);
            const ref=manifest.entries.find(entry=>entry.kind==='exercise' && entry.id===id)!;
            return {exercise:doc,passage:text,key,binding:{exerciseSha256:ref.sha256,
              passageSha256:doc.passage_ref.sha256,keySha256:doc.key_ref.sha256}};
          });
        },
      };
    }),
  };
}
