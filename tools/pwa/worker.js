/* global VERSION, SHELL */
const scope = self.registration.scope;
const absolute = path => new URL(path, scope).href;
const prefix = 'englishreading:' + scope + ':';
const shellName = prefix + 'shell:' + VERSION;
const articlePrefix = prefix + 'articles:';
const articleName = articlePrefix + VERSION;
const novelPrefix = prefix + 'novels:';
const extensionPath = /^content\/extensions\/(novels\/(?:work\/nw|chapter\/nc)|grammar\/(?:exercise\/ge|passage\/gp|key\/gk))-[a-z0-9][a-z0-9-]{1,74}\.[1-9]\d*\.json$/;
const extensionCatalogs = new Map();
const extensionRoot = section => 'content/extensions/'+section+'/';
function getExtensionCatalog(section) {
  const root = extensionRoot(section);
  if (!extensionCatalogs.has(section)) {
    extensionCatalogs.set(section, shellFile(root+'manifest.json').then(response=>response.json()).then(manifest=>{
      if (manifest.schema_version!==1 || manifest.section!==section || !Array.isArray(manifest.entries)) {
        throw new Error('Unsupported extension catalog: '+section);
      }
      return new Map(manifest.entries.map(entry=>[root+entry.path,entry]));
    }).catch(error=>{extensionCatalogs.delete(section);throw error;}));
  }
  return extensionCatalogs.get(section);
}
const limit = 30;
const maxBytes = 2 * 1024 * 1024;
const articlePath = /^content\/articles\/[a-z0-9][a-z0-9-]{2,79}\.[1-9]\d*\.json$/;
let catalog;
let writes = Promise.resolve();

async function verifiedSize(response, hash, max = Infinity) {
  if (!response?.ok) return 0;
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength > max) return 0;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') === hash ? bytes.byteLength : 0;
}

function fetchFile(path) {
  return fetch(absolute(path), {cache: 'no-store', signal: AbortSignal.timeout(8000)});
}

async function shellFile(path) {
  const cache = await caches.open(shellName);
  const cached = await cache.match(absolute(path));
  if (await verifiedSize(cached, SHELL[path])) return cached;
  const response = await fetchFile(path);
  if (!(await verifiedSize(response, SHELL[path]))) throw new Error('Release asset is unavailable: ' + path);
  await cache.put(absolute(path), response.clone());
  return response;
}

function getCatalog() {
  if (!catalog) {
    catalog = shellFile('content/manifest.json').then(response => response.json()).then(manifest => {
      if (manifest.schema_version !== 2 || !Array.isArray(manifest.articles)) throw new Error('Unsupported content catalog');
      return new Map(manifest.articles.map(entry => ['content/' + entry.path, entry]));
    }).catch(error => { catalog = undefined; throw error; });
  }
  return catalog;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(shellName);
      for (const [path, hash] of Object.entries(SHELL)) {
        const response = await fetchFile(path);
        if (!(await verifiedSize(response, hash))) throw new Error('Release asset is unavailable: ' + path);
        await cache.put(absolute(path), response);
      }
      const entries = new Map(await getCatalog());
      for (const section of ['novels','grammar']) {
        if (!Object.hasOwn(SHELL,extensionRoot(section)+'manifest.json')) continue;
        for (const [path, entry] of await getExtensionCatalog(section)) entries.set(path,entry);
      }
      await migrateDocuments(entries);
    } catch (error) {
      await Promise.all([caches.delete(shellName), caches.delete(articleName)]);
      throw error;
    }
    await self.skipWaiting();
  })());
});

async function migrateDocuments(entries) {
  const next = await caches.open(articleName);
  for (const name of await caches.keys()) {
    if ((!name.startsWith(articlePrefix) && !name.startsWith(novelPrefix)) || name===articleName) continue;
    const previous = await caches.open(name);
    for (const request of await previous.keys()) {
      if ((await next.keys()).length >= limit) return;
      const entry = entries.get(request.url.slice(scope.length));
      const response = entry && await previous.match(request);
      if (entry && await verifiedSize(response, entry.sha256, maxBytes)) {
        try { await next.put(request, response); } catch (error) {
          if (error.name !== 'QuotaExceededError') throw error;
          console.warn('Offline downloads could not all be migrated', error);
          return;
        }
      }
    }
  }
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    for (const name of names) {
      if (name.startsWith(prefix) && name !== shellName && name !== articleName) {
        try { await caches.delete(name); } catch (error) { console.warn('Old offline cache could not be removed', error); }
      }
    }
    await self.clients.claim();
  })());
});

function mutate(operation) {
  const result = writes.then(operation);
  writes = result.catch(() => {});
  return result;
}

async function notifyCacheChange() {
  const clients = await self.clients.matchAll({type:'window'});
  for (const client of clients) client.postMessage('reading-cache-change');
}

function failure(status, reason) {
  return new Response(reason, {status, headers: {'X-Reading-Cache': reason}});
}

async function documentFile(path, entries) {
  const entry = entries.get(path);
  if (!entry) return failure(404, 'withdrawn');
  const key = absolute(path);
  const cache = await caches.open(articleName);
  const saved = await cache.match(key);
  if (await verifiedSize(saved, entry.sha256, maxBytes)) return saved;
  if (saved) await mutate(async () => { await cache.delete(key); await notifyCacheChange(); });
  let response;
  try { response = await fetchFile(path); } catch {
    return failure(503, saved ? 'offline-corrupt' : 'offline-miss');
  }
  if (!response.ok) return response;
  const size = await verifiedSize(response, entry.sha256);
  if (!size) return failure(502, 'integrity');
  if (size > maxBytes) return response;
  try {
    return await mutate(async () => {
      await cache.put(key, response.clone());
      const keys = await cache.keys();
      for (const request of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(request);
      await notifyCacheChange();
      return response;
    });
  } catch (error) {
    // Reading still works when the browser cannot persist the public copy.
    console.warn('EnglishReading offline save failed', error);
    const headers = new Headers(response.headers);
    headers.set('X-Reading-Cache', 'save-failed');
    return new Response(response.body, {headers});
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  const path = new URL(request.url).pathname.slice(new URL(scope).pathname.length);
  if (request.mode === 'navigate' && (path === '' || path === 'index.html')) {
    event.respondWith(shellFile('index.html').catch(() => new Response(
      '离线应用不可用。请联网打开 EnglishReading 后再试。', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}})));
  } else if (Object.hasOwn(SHELL, path)) event.respondWith(shellFile(path));
  else if (articlePath.test(path)) event.respondWith(getCatalog().then(entries=>documentFile(path,entries)));
  else if (extensionPath.test(path)) {
    const section = path.split('/')[2];
    const root = extensionRoot(section);
    if (!Object.hasOwn(SHELL,root+'manifest.json')) return;
    const catalogue = getExtensionCatalog(section);
    const document = catalogue.then(entries=>documentFile(path,entries));
    if (path.startsWith(root+'exercise/') && !request.headers.has('X-Reading-Catalogue')) {
      // The client still requests the key only when grading. Warm its verified offline copy on a practice visit.
      event.waitUntil(document.then(async response=>{
        if (!response.ok) return;
        const {key_ref} = await response.clone().json();
        const entries = await catalogue;
        const keyPath = root+key_ref.path;
        if (entries.get(keyPath)?.sha256===key_ref.sha256) await documentFile(keyPath,entries);
      }));
    }
    event.respondWith(document);
  }
});

self.addEventListener('message', event => {
  const {action, path} = event.data ?? {};
  const port = event.ports[0];
  if (!port || !['list', 'remove', 'clear'].includes(action)) return;
  event.waitUntil(mutate(async () => {
    const cache = await caches.open(articleName);
    const entries = await getCatalog();
    if (action === 'remove' && entries.has(path)) await cache.delete(absolute(path));
    if (action === 'clear') for (const request of await cache.keys()) {
      if (articlePath.test(request.url.slice(scope.length))) await cache.delete(request);
    }
    if (action !== 'list') await notifyCacheChange();
    const saved = [];
    for (const request of await cache.keys()) {
      const current = request.url.slice(scope.length);
      const entry = entries.get(current);
      if (entry && (action !== 'list' || !path || path === current) &&
          await verifiedSize(await cache.match(request), entry.sha256, maxBytes)) saved.push(entry);
    }
    port.postMessage({saved, limit, maxMiB: maxBytes / 1024 ** 2});
  }).catch(error => { console.error(error); port.postMessage({error: true}); }));
});

