import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { admissionTime } from '../../src/core/content/metadata.ts';
import { exactGrammarPolicy } from '../../src/core/extensions/grammar-policy.ts';
import {
  ajv, countsFor, filePath, hash, ident, identityKey, kinds, list, manifestPayload, positive,
  sameReference, sectionKinds, shape, text, validateDocument, validateExercise, validateManifest, validateWithdrawn, validId, version,
} from '../../src/core/extensions/contract.ts';
import { encode, generationName, sha256 } from './catalog.mjs';

const row = { kind:{enum:kinds}, id:ident, revision:positive };
const withdrawal = shape({...row, reason:text, operator:text});
const approval = shape({stage:{enum:['rights','continuity','annotations','blind_solution','ambiguity','explanation']},
  reviewer:text, subject_sha256:hash, decision:{enum:['pass','reject']}, at:text, notes:text,
  answers:list(shape({blank_id:ident,answer:text}))},['answers']);
const publicRights = shape({kind:text, attribution:text, source_url:text, license_url:text},['source_url','license_url']);
const licenseSchema = shape({public:publicRights, proof:text, territory:{const:'worldwide'},
  publish:{const:true}, translate:{const:true}, offline:{const:true}});
const quality = {type:'integer',minimum:1,maximum:5};
const scores = shape({engagement:quality,naturalness:quality,distinctiveness:quality,value:quality});
const unitSchema = shape({
  documents:list({type:'object'},1), source_text:text,
  license:licenseSchema, cover_license:licenseSchema,
  review:shape({producer:text,candidate_sha256:hash,source_sha256:hash,license_sha256:hash,
    document_hashes:list(shape({...row,sha256:hash}),1),checks:list(approval,1),
    editorial:list(shape({...row,sha256:hash,producer_scores:scores,independent_scores:scores}))}),
},['cover_license']);
const checkTransaction=ajv.compile(shape({schema_version:{const:version},mode:{enum:['fixture','release']},
  units:list(unitSchema),withdrawals:list(withdrawal)}));
const checkReceipt=ajv.compile(shape({schema_version:{const:version},mode:{enum:['release','fixture']},
  generation:positive, transaction_sha256:hash, committed_at:text,
  items:list({oneOf:[shape({...row,action:{enum:['new','revise']},sha256:hash}),shape({...row,action:{const:'withdraw'}})]},1)}));

const digest = object => sha256(encode(object));
const identity = ({kind,id,revision}) => ({kind,id,revision});
const reference = doc => ({...identity(doc),path:filePath(doc.kind,doc.id,doc.revision),sha256:digest(doc)});
const reviewerId = id => id.trim().normalize('NFKC').toLowerCase();
const required = {
  work:['rights','continuity','annotations'],
  exercise:['rights','annotations','blind_solution','ambiguity','explanation'],
};
const readRegular = async path => {
  assert((await lstat(path)).isFile(), 'Not a regular file: '+path);
  return readFile(path);
};
export const unitBinding = ({documents,source_text,license,cover_license}) => ({
  candidate_sha256:digest(documents), source_sha256:sha256(source_text), license_sha256:digest({license,...(cover_license && {cover_license})}),
  document_hashes:documents.map(doc=>({...identity(doc),sha256:digest(doc)})),
});
const canonicalAnswer = exactGrammarPolicy.normalize;

function verifyLicense(rights) {
  assert(rights.kind==='project_original' || rights.source_url,'External content needs the original source URL');
  const paths = { 'CC-BY': /^\/licenses\/by\/[1-4]\.0\/$/, 'CC-BY-SA': /^\/licenses\/by-sa\/[1-4]\.0\/$/, CC0: /^\/publicdomain\/zero\/1\.0\/$/ };
  const pattern = paths[rights.kind];
  if (pattern) {
    assert(rights.license_url,'Missing Creative Commons license URL');
    const url=new URL(rights.license_url);
    assert(url.origin==='https://creativecommons.org' && pattern.test(url.pathname) && !url.search && !url.hash,
      'License URL does not match license kind');
  }
}

function verifyUnit(unit) {
  const documents=unit.documents.map(validateDocument);
  const [parent,...children]=documents;
  assert(parent.kind==='work' || parent.kind==='exercise','Unit must begin with work or exercise');
  assert(children.every(doc=>parent.kind==='work'
    ? doc.kind==='chapter' && doc.work_id===parent.id
    : (doc.kind==='passage' || doc.kind==='key') && doc.exercise_id===parent.id),'Unit child belongs to a different title');
  for (const doc of documents) if ('rights' in doc) assert.deepEqual(doc.rights,unit.license.public,'License and attribution must bind public rights');
  verifyLicense(unit.license.public);
  const cover=parent.kind==='work' && parent.cover;
  assert(Boolean(cover)===Object.hasOwn(unit,'cover_license'),'Cover needs its own license proof');
  if (cover) {
    assert.deepEqual(cover.rights,unit.cover_license.public,'Cover license mismatches public attribution');
    verifyLicense(cover.rights);
  }
  const {producer,checks,editorial,...binding}=unit.review;
  const current=unitBinding(unit);
  assert.deepEqual(binding,current,'Stale source, license, candidate or annotated document hash');
  const reviewedPassages=current.document_hashes.filter(doc=>doc.kind==='chapter' || doc.kind==='passage');
  assert.deepEqual(editorial.map(item=>({...identity(item),sha256:item.sha256})),reviewedPassages,'Missing or stale editorial scores');
  const requiredDimensions=parent.kind==='exercise'
    ? ['naturalness','value']
    : ['engagement','naturalness','distinctiveness','value'];
  for (const review of editorial) {
    for (const role of ['producer_scores','independent_scores']) {
      for (const dimension of requiredDimensions) {
        assert(review[role][dimension]>=4,`Editorial score below 4: ${review.kind}/${review.id} ${role}.${dimension}`);
      }
    }
  }
  const subject=digest(current);
  const byStage=new Map(checks.map(check=>[check.stage,check]));
  assert(byStage.size===checks.length && byStage.size===required[parent.kind].length &&
    required[parent.kind].every(stage=>byStage.has(stage)),'Missing or duplicate independent review');
  for (const check of checks) {
    assert.equal(check.subject_sha256,subject,'Stale independent sign-off binding');
    assert(check.decision==='pass' && reviewerId(check.reviewer)!==reviewerId(producer) && admissionTime(check.at),
      'Review failed or is not independent');
    assert((check.stage==='blind_solution')===Object.hasOwn(check,'answers'),'Blind solution evidence must include recorded answers');
  }
  if (parent.kind==='exercise') {
    const blind=byStage.get('blind_solution');
    assert(['ambiguity','explanation'].every(stage=>byStage.get(stage).at>blind.at),'Blind solution must precede answer review');
  }
  return {documents, parent, blind:byStage.get('blind_solution')};
}

function validateGraph(active) {
  const referenced=new Set();
  function read(ref) {
    const key=identityKey(ref), item=active.get(key);
    assert(item && sameReference(item.ref,ref),'Missing or stale reference: '+key);
    assert(!referenced.has(key),'Repeated dependent reference: '+key);
    referenced.add(key);
    return item.doc;
  }
  for (const {doc} of active.values()) {
    if (doc.kind==='work') {
      for (const [i,ref] of doc.chapters.entries()) {
        const chapter=read(ref);
        assert(chapter.work_id===doc.id && chapter.number===i+1,'Invalid chapter owner or non-contiguous chapters');
        assert.deepEqual(chapter.rights,doc.rights,'Chapter rights differ from current work rights');
      }
    }
    if (doc.kind==='exercise') {
      validateExercise(doc,read(doc.passage_ref),read(doc.key_ref));
    }
  }
  for (const [key,{doc}] of active) if (doc.kind!=='work' && doc.kind!=='exercise') {
    assert(referenced.has(key),'Orphan extension document: '+key);
  }
}
function applyTransaction(catalog, tx) {
  assert(checkTransaction(tx) && tx.mode===catalog.mode && tx.units.length+tx.withdrawals.length>0,
    'Invalid or empty extension transaction: '+ajv.errorsText(checkTransaction.errors));
  const active=new Map(catalog.active), retired=new Map(catalog.retired), items=[], touched=new Set();
  function touch(row) {
    const key=identityKey(row);
    assert(validId(row.kind,row.id) && !retired.has(key) && !touched.has(key),'Duplicate or retired extension ID: '+key);
    touched.add(key);
    return key;
  }
  const reviewed=tx.units.map(verifyUnit);
  for (const {documents} of reviewed) for (const doc of documents) {
    const key=touch(doc), previous=active.get(key);
    assert(doc.revision===(previous?.doc.revision ?? 0)+1,'Invalid or stale extension revision: '+key);
    if (previous) {
      const owner=doc.kind==='chapter'?'work_id':'exercise_id';
      assert.equal(doc[owner],previous.doc[owner],'Cannot change an extension ID owner');
    }
    const ref=reference(doc);
    active.set(key,{doc,ref});
    items.push({...identity(doc),action:previous?'revise':'new',sha256:ref.sha256});
  }
  for (const item of tx.withdrawals) {
    const key=touch(item), previous=active.get(key);
    assert(previous?.doc.revision===item.revision,'Invalid withdrawal revision: '+key);
    active.delete(key);
    retired.set(key,{kind:item.kind,id:item.id});
    items.push({...identity(item),action:'withdraw'});
  }
  validateGraph(active);
  for (const {parent,blind} of reviewed) if (parent.kind==='exercise') {
    const {doc:key}=active.get(identityKey(parent.key_ref));
    const recorded=new Map(blind.answers.map(a=>[a.blank_id,canonicalAnswer(a.answer)]));
    assert(recorded.size===blind.answers.length && recorded.size===key.answers.length &&
      key.answers.every(a=>[a.canonical_answer,...a.accepted_variants].map(canonicalAnswer).includes(recorded.get(a.blank_id))),
      'Blind solution is incomplete, unmatched or ambiguous');
  }
  return {active,retired,items};
}

async function readCatalog(root,mode) {
  assert(mode==='release' || mode==='fixture','Invalid extension catalogue mode');
  const directory=join(root,mode+'-approved');
  const catalog={mode,directory,active:new Map(),retired:new Map(),receipts:new Map()};
  let entries;
  try { entries=await readdir(directory,{withFileTypes:true}); }
  catch(error) { if (error.code==='ENOENT') return catalog; throw error; }
  assert((await lstat(directory)).isDirectory(),'Extension catalogue is not a regular directory');
  entries.sort((a,b)=>a.name.localeCompare(b.name));
  for (const [index,entry] of entries.entries()) {
    assert(entry.isDirectory() && entry.name===generationName(index+1),'Invalid extension generation');
    const location=join(directory,entry.name);
    const raw=await readRegular(join(location,'transaction.json'));
    const receipt=JSON.parse(await readRegular(join(location,'receipt.json')));
    const txHash=sha256(raw);
    assert(checkReceipt(receipt) && receipt.mode===mode && receipt.generation===index+1 &&
      receipt.transaction_sha256===txHash && admissionTime(receipt.committed_at) && !catalog.receipts.has(txHash),
      'Invalid extension receipt');
    const {active,retired,items}=applyTransaction(catalog,JSON.parse(raw));
    assert.deepEqual(receipt.items,items,'Extension receipt does not match transaction');
    catalog.active=active;
    catalog.retired=retired;
    catalog.receipts.set(txHash,receipt);
  }
  return catalog;
}

export async function submit(root,mode,transaction,{beforeCommit}={}) {
  const raw=encode(transaction), txHash=sha256(raw);
  const catalog=await readCatalog(root,mode);
  if (catalog.receipts.has(txHash)) return catalog.receipts.get(txHash);
  const {items}=applyTransaction(catalog,JSON.parse(raw));
  const receipt={schema_version:version, mode, generation:catalog.receipts.size+1, transaction_sha256:txHash,
    committed_at:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'), items};
  await mkdir(catalog.directory,{recursive:true});
  const pending=await mkdtemp(join(root,'.pending-'));
  try {
    await writeFile(join(pending,'transaction.json'),raw,{flag:'wx'});
    await writeFile(join(pending,'receipt.json'),encode(receipt),{flag:'wx'});
    if (beforeCommit) await beforeCommit();
    try {
      await rename(pending,join(catalog.directory,generationName(receipt.generation)));
    } catch(error) {
      const latest=await readCatalog(root,mode);
      if (latest.receipts.has(txHash)) return latest.receipts.get(txHash);
      if (latest.receipts.size>=receipt.generation) throw new Error('Concurrent extension commit won; rerun transaction',{cause:error});
      throw error;
    }
    return receipt;
  } finally {
    await rm(pending,{recursive:true,force:true});
  }
}

export async function project(root,mode,destination) {
  const catalog=await readCatalog(root,mode);
  const parent=dirname(destination);
  await mkdir(parent,{recursive:true});
  const stage=await mkdtemp(join(parent,'.extension-export-'));
  try {
    for (const [section,kinds] of Object.entries(sectionKinds)) {
      const folder=join(stage,section);
      await mkdir(folder);
      const selected=[...catalog.active.values()].filter(({ref})=>kinds.includes(ref.kind))
        .sort((a,b)=>identityKey(a.ref).localeCompare(identityKey(b.ref)));
      for (const kind of kinds) await mkdir(join(folder,kind));
      for (const {doc,ref} of selected) {
        const raw=encode(doc);
        assert.equal(sha256(raw),ref.sha256);
        await writeFile(join(folder,ref.path),raw,{flag:'wx'});
      }
      const withdrawn={schema_version:version,ids:[...catalog.retired.values()].filter(row=>kinds.includes(row.kind))};
      const entries=selected.map(({ref})=>ref);
      const payload=manifestPayload({schema_version:version,section,entries,counts:countsFor(section,entries),withdrawn_sha256:digest(withdrawn)});
      await writeFile(join(folder,'withdrawn.json'),encode(withdrawn),{flag:'wx'});
      await writeFile(join(folder,'manifest.json'),encode({...payload,content_version:digest(payload)}),{flag:'wx'});
    }
    await rename(stage,destination);
  } finally {
    await rm(stage,{recursive:true,force:true});
  }
}

// CI receives only the public projection. Verify it without needing the private ledger.
export async function verifyProjection(root) {
  async function directory(path, expectedDirectories, expectedFiles) {
    const entries=await readdir(path,{withFileTypes:true});
    assert.deepEqual(entries.filter(e=>e.isDirectory()).map(e=>e.name).sort(),expectedDirectories.sort());
    assert.deepEqual(entries.filter(e=>e.isFile()).map(e=>e.name).sort(),expectedFiles.sort());
    assert(entries.every(e=>e.isDirectory()||e.isFile()),'Non-regular extension release entry');
  }
  await directory(root,Object.keys(sectionKinds),[]);
  const active=new Map();
  for (const [section,allowed] of Object.entries(sectionKinds)) {
    const folder=join(root,section);
    await directory(folder,[...allowed],['manifest.json','withdrawn.json']);
    const manifest=validateManifest(JSON.parse(await readRegular(join(folder,'manifest.json'))),section);
    assert.equal(manifest.content_version,digest(manifestPayload(manifest)),'Invalid extension manifest hash');
    const withdrawnBytes=await readRegular(join(folder,'withdrawn.json'));
    assert.equal(sha256(withdrawnBytes),manifest.withdrawn_sha256,'Invalid withdrawal index hash');
    const retired=new Set(validateWithdrawn(JSON.parse(withdrawnBytes),section).ids.map(identityKey));
    for (const kind of allowed) {
      await directory(join(folder,kind),[],manifest.entries.filter(e=>e.kind===kind).map(e=>e.path.split('/')[1]));
    }
    for (const ref of manifest.entries) {
      const key=identityKey(ref);
      assert(!retired.has(key),'Active object in withdrawal index');
      const raw=await readRegular(join(folder,ref.path));
      assert.equal(sha256(raw),ref.sha256,'Extension file hash mismatch: '+ref.path);
      const doc=validateDocument(JSON.parse(raw));
      assert(sameReference(reference(doc),ref),'Extension reference mismatch: '+ref.path);
      active.set(key,{doc,ref});
    }
  }
  validateGraph(active);
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [command,file]=process.argv.slice(2);
  const root=resolve('content/extensions-private');
  if (command==='submit' && file) console.log(await submit(root,'release',JSON.parse(await readRegular(file))));
  else if (command==='project' && /^[a-z0-9][a-z0-9-]{1,50}$/.test(file ?? '')) {
    const target=resolve('outputs/extensions-preview',file);
    await project(root,'release',target);
    console.log('Verified extension preview: '+target);
  } else throw new Error('Usage: extensions.mjs submit <transaction.json> | project <snapshot-name>');
}
