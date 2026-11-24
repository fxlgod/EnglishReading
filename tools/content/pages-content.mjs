import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { compile } from './compile.mjs';
import { compilerInputs, encode, jsonFiles, readCatalog, sha256 } from './catalog.mjs';
import { loadSources } from './sources.mjs';
import { project, verifyProjection } from './extensions.mjs';

const snapshot = resolve(process.argv[3] ?? 'release-content');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const publicLicense = new Set(['CC-BY', 'CC-BY-SA', 'CC0', 'public_domain', 'written_permission', 'project_original']);

async function verifySnapshot(snapshot) {
  const entries = await readdir(snapshot, { withFileTypes: true });
  const extensions = entries.some(entry => entry.name === 'extensions');
  assert.deepEqual(entries.map(entry => entry.name).sort(), ['articles', 'attributions.json', ...(extensions ? ['extensions'] : []), 'manifest.json', 'series.json']);
  assert(entries.every(entry => ['articles','extensions'].includes(entry.name) ? entry.isDirectory() : entry.isFile()), 'Non-regular release file');
  const manifest = await read(`${snapshot}/manifest.json`);
  const credits = await read(`${snapshot}/attributions.json`);
  const series = await read(`${snapshot}/series.json`);
  assert([manifest, credits, series].every(data => data.schema_version === 2), 'Unsupported release schema');
  assert.equal(manifest.content_version, sha256(encode({ articles: manifest.articles, series: series.series, attributions: credits.articles })));
  assert.equal(manifest.build_id, `release-${manifest.content_version}`);
  assert.deepEqual(credits.articles.map(credit => credit.id), manifest.articles.map(article => article.id));
  const expected = manifest.articles.map(entry => {
    assert.match(entry.id, /^[a-z0-9][a-z0-9-]{2,79}$/);
    assert(Number.isSafeInteger(entry.revision) && entry.revision > 0);
    assert.equal(entry.path, `articles/${entry.id}.${entry.revision}.json`);
    return `${entry.id}.${entry.revision}.json`;
  });
  assert.equal(new Set(expected).size, expected.length);
  const articles = await readdir(`${snapshot}/articles`, { withFileTypes: true });
  assert(articles.every(file => file.isFile()), 'Non-regular article file');
  assert.deepEqual(articles.map(file => file.name).sort(), expected.sort());
  for (const [index, entry] of manifest.articles.entries()) {
    const raw = await readFile(`${snapshot}/${entry.path}`);
    assert.equal(sha256(raw), entry.sha256, `Article checksum mismatch: ${entry.id}`);
    const article = JSON.parse(raw);
    assert.equal(article.id, entry.id);
    assert.equal(article.revision, entry.revision);
    assert(article.schema_version === 2 && !('review' in article) && !('status' in article), `Non-public article: ${entry.id}`);
    const credit = credits.articles[index];
    assert(publicLicense.has(credit.kind) && credit.kind === article.rights.kind, `Missing or mismatched license: ${entry.id}`);
  }
  if (extensions) await verifyProjection(join(snapshot,'extensions'));
  return {articles:manifest.articles.length,extensions};
}

const command = process.argv[2];
assert(['export', 'install'].includes(command), 'Expected export or install');
if (command === 'export') {
  const root = process.cwd();
  await mkdir(dirname(snapshot),{recursive:true});
  const temp=await mkdtemp(join(dirname(snapshot),'.pages-export-'));
  const next=join(temp,'next');
  const previous=join(temp,'previous');
  let backup=false;
  try {
    await compile({
      mode: 'release', ...compilerInputs((await readCatalog(root)).active),
      seriesFiles: await jsonFiles(resolve('content/series')),
      sources: await loadSources(), serialRoot: root, output: next,
    });
    await project(resolve('content/extensions-private'),'release',join(next,'extensions'));
    await verifySnapshot(next);
    const existing=await lstat(snapshot).catch(error=>{
      if (error.code==='ENOENT') return undefined;
      throw error;
    });
    if (existing) {
      assert(existing.isDirectory(),'Existing Pages snapshot is not a directory');
      await rename(snapshot,previous);
      backup=true;
    }
    await rename(next,snapshot);
    backup=false;
  } finally {
    if (backup) await rename(previous,snapshot);
    await rm(temp,{recursive:true,force:true});
  }
}
const counts = await verifySnapshot(snapshot);
if (command === 'install') await cp(snapshot, 'dist/content', { recursive: true });
console.log(`Verified public catalogue: ${counts.articles} articles; extension projection ${counts.extensions ? 'verified' : 'absent (legacy snapshot)'}`);
