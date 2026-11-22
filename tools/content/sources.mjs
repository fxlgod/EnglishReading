import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { publicText } from '../../src/core/content/metadata.ts';

const idPattern = /^[a-z0-9][a-z0-9-]{2,79}$/;
const licensePaths = {'CC0':'publicdomain/zero','CC-BY':'licenses/by','CC-BY-SA':'licenses/by-sa'};
const licenses = [...Object.keys(licensePaths),'public_domain','written_permission','unknown','CC-BY-ND','CC-BY-NC','CC-BY-NC-SA','CC-BY-NC-ND'];
const permissions = ['reproduce','translate','adapt','distribute'];
const topics = ['school','technology','mystery','adventure','history','daily_life','psychology_science','literature'];
const text = value => publicText(value, 1200);
const validDate = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) &&
  new Date(day).toISOString().slice(0,10) === day && day <= new Date().toISOString().slice(0,10);

function https(value) {
  assert(typeof value === 'string' && URL.canParse(value), 'invalid evidence or source URL');
  const url = new URL(value);
  assert(url.protocol === 'https:' && !url.username && !url.password, 'source URLs must use HTTPS without credentials');
  return url;
}

function normalizedUrl(value) {
  const url = https(value);
  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, '');
  return url.href;
}

export function validateSources(ledger) {
  assert(ledger?.format_version === 1 && Array.isArray(ledger.sources), 'invalid source ledger format');
  const ids = new Set();
  const urls = new Set();
  const works = new Map();
  for (const source of ledger.sources) {
    assert(source && typeof source.source_id === 'string' && typeof source.original_work_id === 'string' &&
      idPattern.test(source.source_id) && idPattern.test(source.original_work_id), 'invalid source or work ID');
    const {source_id:id, original_work_id:work, review, license, attribution, editorial} = source;
    assert(!ids.has(id) && !works.has(work), `${id}: duplicate source ID or work ID`);
    const url = normalizedUrl(source.source_url);
    assert(!urls.has(url), `${id}: duplicate source URL`);
    assert([source.title,source.author,source.version,source.collection_method].every(text), `${id}: missing source metadata`);
    assert(review && ['approved','pending','rejected'].includes(review.status) && validDate(review.checked_on) &&
      text(review.reviewer) && text(review.reason), `${id}: invalid review status, date or reason`);
    assert(editorial && /^[ABC][12]$/.test(editorial.level) && topics.includes(editorial.topic) &&
      text(editorial.hook) && text(editorial.age_notes) && ['pass','pending','fail'].includes(editorial.suitability), `${id}: invalid editorial triage`);
    assert(license && licenses.includes(license.kind) && Array.isArray(license.evidence_urls) && license.evidence_urls.length &&
      text(license.territory) && text(license.scope_notes) && ['cleared','excluded','unresolved'].includes(license.third_party) &&
      permissions.every(operation => ['allowed','denied','unknown'].includes(license.permissions?.[operation])), `${id}: missing or invalid license evidence or permissions`);
    license.evidence_urls.forEach(https);
    if (license.url !== undefined) https(license.url);
    if (license.adaptation_url !== undefined) https(license.adaptation_url);
    if (review.status === 'approved') {
      assert(Object.hasOwn(licensePaths, license.kind) || ['public_domain','written_permission'].includes(license.kind), `${id}: unsupported license for approval`);
      assert(permissions.every(operation => license.permissions[operation] === 'allowed'), `${id}: reproduction, translation, adaptation and distribution required`);
      assert(license.territory === 'worldwide' && license.third_party !== 'unresolved' && editorial.suitability === 'pass', `${id}: territory, third-party rights or suitability unresolved`);
      assert(attribution && text(attribution.notice) && attribution.notice.includes(source.author) && attribution.notice.includes(source.title), `${id}: attribution must include author and original title`);
      if (Object.hasOwn(licensePaths, license.kind)) {
        const versions = license.kind === 'CC0' ? ['1.0'] : ['3.0','4.0'];
        assert(versions.includes(license.version) &&
          license.url === `https://creativecommons.org/${licensePaths[license.kind]}/${license.version}/`, `${id}: missing or mismatched CC license URL/version`);
      }
      if (license.kind === 'CC-BY-SA') assert(license.adaptation_url === license.url, `${id}: ShareAlike license for translated and adapted text required`);
      else assert(license.adaptation_url === undefined, `${id}: unexpected ShareAlike declaration`);
    }
    ids.add(id);
    urls.add(url);
    works.set(work, source);
  }
  return works;
}

export async function loadSources(path = 'content/rights/sources.json') {
  return validateSources(JSON.parse(await readFile(path, 'utf8')));
}

export function sourceAttribution(rights, sources, usedWorks) {
  const row = sources.get(rights.original_work_id);
  assert(row?.review.status === 'approved', `no approved source for ${rights.original_work_id}`);
  assert(rights.source_url === row.source_url && rights.author === row.author && rights.kind === row.license.kind &&
    rights.license_url === row.license.url && rights.review_date === row.review.checked_on &&
    rights.evidence_ref === `content/rights/sources.json#${row.source_id}`, `article rights do not match source ledger: ${row.source_id}`);
  assert(!usedWorks.has(row.original_work_id), `duplicate external original work: ${row.original_work_id}`);
  usedWorks.add(row.original_work_id);
  return {original_title:row.title, attribution_notice:row.attribution.notice,
    ...(row.license.adaptation_url && {adaptation_license_url:row.license.adaptation_url})};
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const sources = await loadSources();
  const counts = {approved:0,pending:0,rejected:0};
  for (const row of sources.values()) counts[row.review.status]++;
  console.log(`Source ledger: ${sources.size} records, ${JSON.stringify(counts)}`);
}

