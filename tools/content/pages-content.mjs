import assert from 'node:assert/strict';
import { cp, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compile } from './compile.mjs';
import { compilerInputs, encode, jsonFiles, readCatalog, sha256 } from './catalog.mjs';
import { loadSources } from './sources.mjs';

const snapshot = 'release-content';
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const publicLicense = new Set(['CC-BY', 'CC-BY-SA', 'CC0', 'public_domain', 'written_permission', 'project_original']);

async function verifySnapshot() {
  const entries = await readdir(snapshot, { withFileTypes: true });
  assert.deepEqual(entries.map(entry => entry.name).sort(), ['articles', 'attributions.json', 'manifest.json', 'series.json']);
  assert(entries.every(entry => entry.name === 'articles' ? entry.isDirectory() : entry.isFile()), 'Non-regular release file');
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
  return manifest.articles.length;
}

const command = process.argv[2];
assert(['export', 'install'].includes(command), 'Expected export or install');
if (command === 'export') {
  const root = process.cwd();
  await compile({
    mode: 'release', ...compilerInputs((await readCatalog(root)).active),
    seriesFiles: await jsonFiles(resolve('content/series')),
    sources: await loadSources(), serialRoot: root, output: resolve(snapshot),
  });
}
const count = await verifySnapshot();
if (command === 'install') await cp(snapshot, 'dist/content', { recursive: true });
console.log(`Verified public catalogue: ${count} articles`);
