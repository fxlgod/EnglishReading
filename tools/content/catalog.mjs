import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const contentId = /^[a-z0-9][a-z0-9-]{2,79}$/;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const digestPattern = /^[a-f0-9]{64}$/;
export const encode = value => JSON.stringify(value) + '\n';
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export const generationName = number => String(number).padStart(8, '0');

export async function atomicJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, encode(value), {flag:'wx'});
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function jsonFiles(directory) {
  return (await readdir(directory,{withFileTypes:true})).filter(entry => entry.name.endsWith('.json'))
    .sort((a,b) => a.name.localeCompare(b.name)).map(entry => {
      assert(entry.isFile(), `not a regular file: ${entry.name}`);
      return join(directory,entry.name);
    });
}

export async function readCatalog(root) {
  const directory = join(root,'content','approved');
  const entries = (await readdir(directory,{withFileTypes:true}))
    .filter(entry => entry.name !== '.gitkeep').sort((a,b) => a.name.localeCompare(b.name));
  const active = new Map(), retired = new Set(), receipts = new Map();
  for (const [index, entry] of entries.entries()) {
    assert(entry.isDirectory() && entry.name === generationName(index + 1), `invalid approved commit: ${entry.name}`);
    const path = join(directory,entry.name);
    const commit = await readJson(join(path,'receipt.json'));
    assert(commit.format_version === 1 && commit.generation === index + 1 &&
      contentId.test(commit.batch_id) && digestPattern.test(commit.input_sha256) &&
      !receipts.has(commit.batch_id) && Array.isArray(commit.items) && commit.items.length > 0, 'invalid batch receipt');
    receipts.set(commit.batch_id,commit);
    const ids = new Set();
    for (const item of commit.items) {
      const {id, revision, action} = item;
      assert(typeof id === 'string' && contentId.test(id) && Number.isSafeInteger(revision) && revision > 0 &&
        !ids.has(id) && !retired.has(id), 'invalid or duplicate receipt item');
      ids.add(id);
      const previous = active.get(id);
      if (action === 'withdraw') {
        assert(previous && revision === previous.revision && typeof item.reason === 'string' && item.reason.trim() &&
          typeof item.operator === 'string' && item.operator.trim(), 'invalid withdrawal');
        active.delete(id);
        retired.add(id);
      } else {
        assert((action === 'new' && !previous && revision === 1) ||
          (action === 'revise' && previous && revision === previous.revision + 1), 'invalid article revision');
        assert(digestPattern.test(item.sha256) && digestPattern.test(item.evidence_sha256), 'invalid receipt hashes');
        active.set(id,{...item,file:join(path,'articles',id+'.json'), reviews:join(path,'reviews'),input_sha256:commit.input_sha256});
      }
    }
  }
  return {root, directory, active, retired, receipts};
}

export async function verifyCommitFiles(entry,sources) {
  const raw = await readFile(entry.file);
  assert(sha256(raw) === entry.sha256, `${entry.id}: article differs from committed bytes`);
  const article = JSON.parse(raw);
  assert(article.id === entry.id && article.revision === entry.revision &&
    article.review.evidence_ref === `content/rights/${entry.id}.${entry.revision}.json`, `${entry.id}: article receipt mismatch`);
  const evidence = await readFile(join(entry.reviews,`${entry.id}.${entry.revision}.json`));
  assert(sha256(evidence) === entry.evidence_sha256, `${entry.id}: review differs from committed bytes`);
  const proof = JSON.parse(evidence);
  assert(proof.input_sha256 === entry.input_sha256 && digestPattern.test(proof.candidate_sha256) &&
    proof.independent?.candidate_sha256 === proof.candidate_sha256 && proof.independent.decision === 'pass',
    `${entry.id}: independent review or batch evidence mismatch`);
  if (sources && article.rights.kind !== 'project_original') {
    const row = sources.get(article.rights.original_work_id);
    assert(row?.review.status === 'approved' && proof.provenance &&
      digestPattern.test(proof.provenance.original_sha256) && proof.provenance.source_record_sha256 === sha256(encode(row)),
      `${entry.id}: external source version evidence no longer matches`);
  }
  return raw;
}

export function compilerInputs(active) {
  return {files:[...active.values()].map(entry => entry.file),
    committed:new Map([...active.values()].map(entry => [entry.file,entry]))};
}

export async function commitDirectory(path, catalog, generation) {
  try {
    await rename(path, join(catalog.directory,generationName(generation)));
  } catch (error) {
    const latest = await readCatalog(catalog.root);
    if (latest.receipts.size >= generation) throw new Error('Concurrent commit won; rerun the same batch', {cause:error});
    throw error;
  }
}

export async function ensureWorkspace(root) {
  await mkdir(join(root,'content','approved'),{recursive:true});
  await mkdir(join(root,'content','staging'),{recursive:true});
}

