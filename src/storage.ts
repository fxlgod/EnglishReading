export type Progress = { articleId: string; revision: number; sentenceId: string; completed: boolean; updatedAt: string };
export type Favorite = { articleId: string; createdAt: string };
export type Vocab = { id: string; lemma: string; surface: string; pos: string; gloss: string; articleId: string; sentenceId: string; phraseSpan: [number, number] | null; sentence: string; createdAt: string };
type Tables = { progress: Progress; favorites: Favorite; vocab: Vocab; settings: { id: string; value: unknown; updatedAt: string } };
export type Table = keyof Tables;
const keys: Record<Table, string> = { progress: 'articleId', favorites: 'articleId', vocab: 'id', settings: 'id' };
const memory = new Map<Table, Map<IDBValidKey, unknown>>();
let temporary = false;
let opening: Promise<IDBDatabase> | undefined;

export function isTemporary() { return temporary; }
function fail() {
  temporary = true;
  window.dispatchEvent(new Event('reading-storage-change'));
}
function open(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('english-reading', 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const table of Object.keys(keys) as Table[]) {
        if (!db.objectStoreNames.contains(table)) db.createObjectStore(table, { keyPath: keys[table] });
      }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('数据库升级被其他标签页阻止')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      if ((Object.keys(keys) as Table[]).some(table => !db.objectStoreNames.contains(table))) {
        db.close(); reject(new Error('数据库结构不完整，原始数据已保留')); return;
      }
      const tx = db.transaction(Object.keys(keys), 'readonly');
      if ((Object.keys(keys) as Table[]).some(table => tx.objectStore(table).keyPath !== keys[table])) { db.close(); reject(new Error('数据库键结构不兼容，原始数据已保留')); return; }
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
  });
  return opening;
}
function cache(table: Table) {
  let data = memory.get(table);
  if (!data) { data = new Map(); memory.set(table, data); }
  return data;
}
function valid(table: Table, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const strings = (fields: string[]) => fields.every(field => typeof item[field] === 'string' && (item[field] as string).length > 0);
  if (table === 'progress') return strings(['articleId', 'sentenceId', 'updatedAt']) && Number.isInteger(item.revision) && typeof item.completed === 'boolean';
  if (table === 'favorites') return strings(['articleId', 'createdAt']);
  if (table === 'vocab') return strings(['id', 'lemma', 'surface', 'pos', 'gloss', 'articleId', 'sentenceId', 'sentence', 'createdAt']) && (item.phraseSpan === null || (Array.isArray(item.phraseSpan) && item.phraseSpan.length === 2 && item.phraseSpan.every(Number.isInteger)));
  return strings(['id']);
}
export async function all<K extends Table>(table: K): Promise<Tables[K][]> {
  if (temporary) return [...cache(table).values()] as Tables[K][];
  try {
    const db = await open();
    const values = await new Promise<Tables[K][]>((resolve, reject) => {
      const tx = db.transaction(table, 'readonly');
      const request = tx.objectStore(table).getAll();
      request.onsuccess = () => resolve(request.result as Tables[K][]);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
    if (!values.every(value => valid(table, value))) throw new Error('本机数据格式异常，原始数据已保留');
    return values;
  } catch { fail(); return [...cache(table).values()] as Tables[K][]; }
}
export async function put<K extends Table>(table: K, value: Tables[K]): Promise<void> {
  const key = (value as unknown as Record<string, IDBValidKey>)[keys[table]];
  if (!temporary) try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      tx.objectStore(table).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    window.dispatchEvent(new Event('reading-storage-change')); return;
  } catch { fail(); }
  cache(table).set(key, value);
  window.dispatchEvent(new Event('reading-storage-change'));
}
export async function remove(table: Table, key: IDBValidKey): Promise<void> {
  if (!temporary) try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      tx.objectStore(table).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    window.dispatchEvent(new Event('reading-storage-change')); return;
  } catch { fail(); }
  cache(table).delete(key);
  window.dispatchEvent(new Event('reading-storage-change'));
}

export type Snapshot = { [K in Table]: Tables[K][] };
const stores = Object.keys(keys) as Table[];
type Row = Tables[Table];

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('本机事务已取消。'));
  });
}

export async function snapshot(): Promise<Snapshot> {
  const tx = (await open()).transaction(stores, 'readonly');
  const done = transactionDone(tx);
  const result = {} as Snapshot;
  for (const table of stores) {
    const request = tx.objectStore(table).getAll();
    request.onsuccess = () => { Object.assign(result, { [table]: request.result }); };
  }
  await done;
  return result;
}

function rowDate(row: Row) {
  return Date.parse('updatedAt' in row ? row.updatedAt : row.createdAt);
}

export async function restore(data: Snapshot, mode: 'merge' | 'replace') {
  const tx = (await open()).transaction(stores, 'readwrite');
  const done = transactionDone(tx);
  let failure: unknown;
  function enqueue(action: () => void) {
    try { action(); }
    catch (error) { failure = error; tx.abort(); }
  }
  enqueue(() => {
    for (const table of stores) {
      const store = tx.objectStore(table);
      if (mode === 'replace') {
        store.clear();
        for (const row of data[table]) store.put(row);
      } else {
        for (const row of data[table]) {
          const key = 'id' in row ? row.id : row.articleId;
          const read = store.get(key);
          read.onsuccess = () => enqueue(() => {
            const old = read.result as Row | undefined;
            if (old && !Number.isFinite(rowDate(old))) throw new Error('本机记录时间异常。');
            if (!old || rowDate(row) > rowDate(old)) store.put(row);
          });
        }
      }
    }
  });
  try { await done; }
  catch (error) { throw failure ?? error; }
  if (mode === 'replace') memory.clear();
  if (mode === 'replace' || memory.size === 0) temporary = false;
  window.dispatchEvent(new Event('reading-storage-change'));
}
