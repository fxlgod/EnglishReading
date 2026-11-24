import { snapshot as readLegacySnapshot } from '../../storage.ts';
import { extensionPersonalStore } from './personal-store.ts';
import type { PersonalRecords } from './personal-contract.ts';

export function novelResume(records: Pick<PersonalRecords,'progress'>) {
  const byWork=new Map<string,PersonalRecords['progress'][number]>();
  for (const progress of records.progress) {
    const work=progress.source.workId;
    const saved=byWork.get(work);
    const delta=saved?Date.parse(progress.updatedAt)-Date.parse(saved.updatedAt):1;
    if (!saved || delta>0 || (delta===0 && (
      progress.source.revision>saved.source.revision ||
      (progress.source.revision===saved.source.revision && progress.source.id>saved.source.id)
    ))) byWork.set(work,progress);
  }
  return byWork;
}

export async function readPersonalOverview(store = extensionPersonalStore) {
  const [legacy,extended]=await Promise.allSettled([readLegacySnapshot(),store.snapshot()]);
  const articles=legacy.status==='fulfilled'
    ? {status:'available' as const,favorites:legacy.value.favorites,progress:legacy.value.progress}
    : {status:'unavailable' as const,error:legacy.reason as unknown};
  const extensions=extended.status==='fulfilled'
    ? {status:extended.value.status,records:extended.value.records,resume:novelResume(extended.value.records)}
    : {status:{mode:'unavailable' as const},error:extended.reason as unknown};
  const vocabulary=[
    ...(legacy.status==='fulfilled'?legacy.value.vocab.map(record=>({scope:'articles' as const,
      source:{kind:'article' as const,id:record.articleId},record})):[]),
    ...(extended.status==='fulfilled'?extended.value.records.vocab.map(record=>({scope:record.source.kind==='chapter'
      ?'novels' as const:'grammar' as const,source:record.source,record})):[]),
  ];
  return {articles,extensions,vocabulary};
}
