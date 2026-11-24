import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ReadingView } from './ReadingView';
import type { ReadingSelection } from './ReadingView';
import { createExtensionLoader, ExtensionContentError } from './core/extensions/load';
import type { NovelChapter, NovelWork } from './core/extensions/contract';
import { emptyRecords, personalKey } from './core/extensions/personal-contract';
import type { ExtensionWord, PersonalRecords } from './core/extensions/personal-contract';
import { extensionPersonalStore as storage } from './core/extensions/personal-store';
import { novelResume } from './core/extensions/personal-overview';
import { getTheme } from './theme';
import { useOfflineApp } from './offline-client';
import './novel.css';

type Page = {works: NovelWork[]} | {work: NovelWork; chapter?: NovelChapter};
const novelLink = (work: string, chapter?: string) => '#/novel/' + work + (chapter ? '/' + chapter : '');
const shelf = '#/novels';
const loadError = {
  missing: '找不到小说或阅读单元。', withdrawn: '此内容已撤回。',
  offline: '离线时无法打开未缓存的小说或阅读单元。', unsupported: '当前版本无法打开此小说。',
  invalid: '小说文件校验失败。', unavailable: '小说暂时无法加载。',
};

export default function Novel({workId,chapterId}: {workId?:string;chapterId?:string}) {
  const [data,setData]=useState<Page>();
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [dark,setDark]=useState(false);
  const main=useRef<HTMLElement>(null);

  useLayoutEffect(()=>{
    if (!chapterId) return;
    // The chapter restores its stored sentence after loading.
    const previous=history.scrollRestoration;
    history.scrollRestoration='manual';
    return ()=>{history.scrollRestoration=previous;};
  },[chapterId]);
  useEffect(()=>{ void getTheme().then(setDark); },[]);
  useEffect(()=>{
    let active=true;
    async function load():Promise<Page> {
      const base=new URL(import.meta.env.BASE_URL+'content/extensions/',document.baseURI);
      const novels=await createExtensionLoader(base).openNovels();
      if (workId && chapterId) return novels.loadReading(workId,chapterId);
      if (workId) return {work:await novels.loadWork(workId)};
      return {works:await Promise.all(novels.manifest.entries.filter(ref=>ref.kind==='work').map(ref=>novels.loadWork(ref.id)))};
    }
    window.scrollTo({top:0,behavior:'instant'});
    void load().then(page=>{if(active)setData(page);},cause=>{
      if(active)setError(cause instanceof ExtensionContentError ? loadError[cause.code] : loadError.unavailable);
    });
    return ()=>{active=false;};
  },[workId,chapterId,retry]);

  return <div className="app" data-theme={dark?'dark':'light'}>
    <a className="skip" href="#novel-main" onClick={event=>{event.preventDefault();main.current?.focus();}}>跳到主要内容</a>
    <header className="header"><a className="brand" href="#/">EnglishReading</a>
      <nav aria-label="页面导航"><a href={shelf}>小说书架</a><a href="#/library">分级书库</a><a href="#/personal">我的阅读</a></nav>
    </header>
    <main id="novel-main" className="section library-main" ref={main} tabIndex={-1}>
      {error ? <p className="empty" role="alert">{error} <button onClick={()=>{setError('');setRetry(retry+1);}}>重试</button></p> :
        !data ? <p role="status" className="empty">正在加载小说…</p> :
        'works' in data ? <><h1>小说书架</h1>{data.works.length===0 ? <p className="empty">暂无已发布小说。</p> :
          <div className="article-grid">{data.works.map(work=><article className="article-card" key={work.id}>
            <h2 lang="en"><a href={novelLink(work.id)}>{work.title_en}</a></h2>
            <p>{work.title_zh} · {work.author}</p><p>{work.synopsis_zh}</p>
          </article>)}</div>}</> :
          <WorkReading work={data.work} chapter={data.chapter} />}
    </main>
  </div>;
}

function Rights({work}: {work:NovelWork}) {
  const rights=work.rights;
  return <aside aria-label="来源与许可" className="novel-rights">
    <p>{rights.attribution}</p>
    <div className="chapter-nav">
      {rights.source_url && <a href={rights.source_url}>原始来源</a>}
      {rights.license_url && <a href={rights.license_url}>{rights.kind==='CC-BY-SA' && rights.license_url.endsWith('/4.0/') ? 'CC BY-SA 4.0 International' : rights.kind}</a>}
    </div>
  </aside>;
}

function WorkReading({work,chapter}: {work:NovelWork;chapter?:NovelChapter}) {
  const [records,setRecords]=useState(emptyRecords);
  const [notice,setNotice]=useState('');
  const [ready,setReady]=useState(false);
  const saved=records.favorites.find(row=>row.source.id===work.id);
  const resume=novelResume(records).get(work.id);
  const resumeChapter=work.chapters.find(ref=>ref.id===resume?.source.id);
  const {controller}=useOfflineApp();

  const report=useCallback((cause:unknown)=>{
    setNotice(cause instanceof Error?cause.message:'无法保存本机阅读记录。');
  },[]);
  async function refresh() {
    const {records,status}=await storage.snapshot();
    setRecords(records);
    setNotice(status.mode==='temporary'?status.warning:'');
    setReady(true);
  }
  useEffect(()=>{
    let active=true;
    void storage.snapshot().then(({records,status})=>{
      if(!active)return;
      setRecords(records);
      setNotice(status.mode==='temporary'?status.warning:'');
      setReady(true);
    },cause=>{if(active)report(cause);});
    return ()=>{active=false;};
  },[report]);
  async function favorite() {
    try {
      if(saved) await storage.remove('favorites',saved);
      else await storage.save({favorites:[{source:{kind:'work',id:work.id,revision:work.revision},createdAt:new Date().toISOString()}]});
      await refresh();
    } catch(cause) {report(cause);}
  }
  const label=(i:number)=>work.unit_titles?.[i] ?? `第 ${i+1} 单元`;
  return <>
    <nav className="chapter-nav" aria-label="当前位置"><a href={shelf}>小说书架</a>
      {chapter && <a href={novelLink(work.id)}>作品目录</a>}
    </nav>
    {chapter ? <><p className="note" lang="en">{work.title_en} · {chapter.level}</p><h1>{chapter.title}</h1></> :
      <><h1 lang="en">{work.title_en}</h1><p>{work.title_zh} · {work.author}</p><p>{work.synopsis_zh}</p></>}
    {work.reading_note && <p>{work.reading_note}</p>}

    <div className="reader-actions">
      <button className="filter" type="button" disabled={!ready} aria-pressed={!!saved} onClick={()=>void favorite()}>{saved?'取消收藏作品':'收藏作品'}</button>
      {!chapter && resumeChapter && <a className="primary" href={novelLink(work.id,resumeChapter.id)}>继续阅读</a>}
    </div>
    {notice && <p role="alert" className="empty">{notice}</p>}
    <Rights work={work} />
    {chapter ? <>
      {controller && <p className="note">联网阅读后，支持离线缓存的浏览器可重访这些单元。</p>}
      <ChapterText chapter={chapter} records={records} ready={ready} refresh={refresh} report={report} />
      <nav className="chapter-nav" aria-label="阅读单元导航">
        {chapter.number>1 && <a href={novelLink(work.id,work.chapters[chapter.number-2].id)}>← 上一单元</a>}
        <a href={novelLink(work.id)}>返回目录</a>
        {chapter.number<work.chapters.length && <a href={novelLink(work.id,work.chapters[chapter.number].id)}>下一单元 →</a>}
      </nav>
    </> : <><h2>阅读目录</h2><ol className="chapter-list">{work.chapters.map((ref,i)=><li key={ref.id}>
      <a href={novelLink(work.id,ref.id)}>{label(i)}</a>
    </li>)}</ol></>}
  </>;
}

function ChapterText({chapter,records,ready,refresh,report}: {
  chapter:NovelChapter;records:PersonalRecords;ready:boolean;refresh:()=>Promise<void>;report:(cause:unknown)=>void;
}) {
  const root=useRef<HTMLDivElement>(null);
  const position=useRef('');
  const completion=useRef(false);
  const [completed,setCompleted]=useState(false);
  const [resumeMessage,setResumeMessage]=useState('');
  const progress=useRef(records.progress);
  const source={kind:'chapter' as const,id:chapter.id,revision:chapter.revision,workId:chapter.work_id};
  useEffect(()=>{progress.current=records.progress;},[records.progress]);
  useEffect(()=>{
    if(!ready || !root.current)return;
    const saved=progress.current.filter(row=>row.source.id===chapter.id && row.source.workId===chapter.work_id)
      .sort((a,b)=>Number(b.source.revision===chapter.revision)-Number(a.source.revision===chapter.revision) ||
        b.updatedAt.localeCompare(a.updatedAt))[0];
    const lines=[...root.current.querySelectorAll<HTMLElement>('[data-sentence-id]')];
    const target=lines.find(line=>line.dataset.sentenceId===saved?.sentenceId);
    let restoring=!!target;
    let lastScrollY=window.scrollY;
    let frame=0;
    if(saved && target) {
      position.current=saved.sentenceId;
      completion.current=saved.source.revision===chapter.revision && saved.completed;
      frame=requestAnimationFrame(()=>{
        setCompleted(completion.current);
        target.scrollIntoView({block:'center',behavior:'instant'});
        setResumeMessage('已恢复上次阅读位置。');
        frame=requestAnimationFrame(()=>{
          lastScrollY=window.scrollY;
          restoring=false;
        });
      });
    } else if(saved) {
      frame=requestAnimationFrame(()=>setResumeMessage('上次阅读位置不可用，已从单元开头打开。'));
    }
    function track() {
      const scrollY=window.scrollY;
      if(restoring || scrollY===lastScrollY)return;
      lastScrollY=scrollY;
      const line=lines.find(item=>item.getBoundingClientRect().bottom>100 && item.getBoundingClientRect().top<innerHeight);
      const id=line?.dataset.sentenceId;
      if(!id || id===position.current)return;
      position.current=id;
      void storage.save({progress:[{source:{kind:'chapter',id:chapter.id,revision:chapter.revision,workId:chapter.work_id},
        sentenceId:id,completed:completion.current,updatedAt:new Date().toISOString()}]}).catch(cause=>{
        if(position.current===id)position.current='';
        report(cause);
      });
    }
    // Opening an earlier unit intentionally makes it the current resume unit.
    const first=target?.dataset.sentenceId ?? lines[0].dataset.sentenceId!;
    void storage.save({progress:[{source:{kind:'chapter',id:chapter.id,revision:chapter.revision,workId:chapter.work_id},
      sentenceId:first,completed:completion.current,updatedAt:new Date().toISOString()}]}).catch(report);
    if(!position.current)position.current=first;
    window.addEventListener('scroll',track,{passive:true});
    return ()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',track);};
  },[ready,chapter,report]);

  function vocabularyRow({sentence,token,phrase}:ReadingSelection):ExtensionWord {
    const span=phrase??token;
    return {source,sentenceId:sentence.id,kind:phrase?'phrase':'word',start:span.start,end:span.end,
      surface:span.surface,lemma:phrase?phrase.surface.toLowerCase():token.lemma,pos:phrase?'短语':token.pos,
      gloss:span.gloss_zh,sentence:sentence.text,createdAt:new Date().toISOString()};
  }
  const words=new Set(records.vocab.map(personalKey));
  return <ReadingView paragraphs={chapter.paragraphs} rootRef={root} layout={chapter.layout} vocabulary={{
    isSaved:selection=>words.has(personalKey(vocabularyRow(selection))),
    toggle:selection=>{
      const word=vocabularyRow(selection);
      const operation=words.has(personalKey(word))?storage.remove('vocab',word):storage.save({vocab:[word]});
      void operation.then(refresh).catch(report);
    },
  }}>
    {resumeMessage && <p role="status">{resumeMessage}</p>}
    <button type="button" className="filter" disabled={!ready} aria-pressed={completed} onClick={()=>{
      const next=!completion.current;
      void storage.save({progress:[{source,sentenceId:position.current,completed:next,updatedAt:new Date().toISOString()}]})
        .then(()=>{completion.current=next;setCompleted(next);}).catch(report);
    }}>{completed?'取消标记已读':'标记已读'}</button>
  </ReadingView>;
}
