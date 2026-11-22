import { Reader } from './Reader';
import { useOnline } from './offline-client';
import { put } from './storage';
import { useEffect, useMemo, useState } from 'react';
import { createContentLoader } from './core/content/load';
import type { Entry, SeriesSummary } from './core/content/types';
import './style.css';

const topics: Record<string, string> = { school:'校园与青春', technology:'科技与未来', mystery:'悬疑与推理', adventure:'科幻与冒险', history:'历史与文化', daily_life:'日常生活', psychology_science:'心理与科学', literature:'童话与文学' };
const sources: Record<string, string> = {licensed_original:'授权原版', licensed_adaptation:'授权改编', ai_original:'原创', original_serial:'原创连载'};
const validId = /^[a-z0-9][a-z0-9-]{2,79}$/;
const url = (id: string) => encodeURIComponent(id);

export function Library({ route }: { route: string }) {
  const online = useOnline();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const change = (event: Event) => setDark((event as CustomEvent<string>).detail === 'dark');
    window.addEventListener('reading-theme-change', change);
    return () => window.removeEventListener('reading-theme-change', change);
  }, []);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('');
  const [topic, setTopic] = useState('');
  const [source, setSource] = useState('');
  const [seriesFilter, setSeriesFilter] = useState('');
  const [length, setLength] = useState('');
  const [sort, setSort] = useState('default');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    setError(false);
    createContentLoader(new URL(import.meta.env.BASE_URL + 'content/', document.baseURI)).loadManifest()
      .then(result => { if (active) { setEntries(result.articles); setSeries(result.series); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [retry]);

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const list = (entries ?? []).filter(item =>
      (!level || item.level === level) && (!topic || item.primary_topic === topic) &&
      (!source || item.source_type === source) && (!seriesFilter || item.series?.id === seriesFilter) &&
      (!length || (length === 'short' ? item.word_count < 300 : length === 'medium' ? item.word_count >= 300 && item.word_count <= 800 : item.word_count > 800)) &&
      (!needle || [item.title_en, item.title_zh, ...item.tags].some(value => value.toLocaleLowerCase().includes(needle))));
    if (sort === 'title') list.sort((a,b) => a.title_en.localeCompare(b.title_en));
    if (sort === 'latest') list.sort((a, b) => b.admitted_at.localeCompare(a.admitted_at) || a.id.localeCompare(b.id));
    if (sort === 'length') list.sort((a,b) => a.word_count - b.word_count);
    return list;
  }, [entries,query,level,topic,source,seriesFilter,length,sort]);
  const pages = Math.max(1, Math.ceil(matches.length / 24));
  const path = route.split('?')[0];
  const match = /^#\/(series|article)\/([a-z0-9][a-z0-9-]{2,79})$/.exec(path);
  const invalid = path !== '#/library' && (!match || !validId.test(match[2]));
  const selected = match?.[1] === 'article' ? entries?.find(item => item.id === match[2]) : undefined;
  const seriesInfo = match?.[1] === 'series' ? series.find(item => item.id === match[2]) : undefined;
  const chapters = match?.[1] === 'series' ? entries?.filter(item => item.series?.id === match[2]).sort((a,b) => a.series!.chapter-b.series!.chapter) : undefined;
  const chapterAt = selected?.series ? entries?.find(item => item.series?.id === selected.series!.id && item.series.chapter === selected.series!.chapter - 1) : undefined;
  const chapterNext = selected?.series ? entries?.find(item => item.series?.id === selected.series!.id && item.series.chapter === selected.series!.chapter + 1) : undefined;
  const resetPage = () => setPage(1);

  return <div className="app" data-theme={dark ? 'dark' : 'light'}>
    <a className="skip" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>跳到主要内容</a>
    <header className="header"><a className="brand" href="#"><span className="brand-mark">e.</span><span>EnglishReading<small>一个阅读的地方</small></span></a><nav aria-label="页面导航"><a href="#">首页</a><a href="#/library">书库</a><a href="#/personal">我的阅读</a></nav><button className="theme" onClick={() => { const theme = dark ? 'light' : 'dark'; setDark(!dark); window.dispatchEvent(new CustomEvent('reading-theme-change', {detail: theme})); void put('settings', {id:'theme', value:theme, updatedAt:new Date().toISOString()}); }} aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}>{dark ? '☀ 浅色' : '◐ 深色'}</button></header>
    <main id="main" tabIndex={-1} className="library-main">
      {invalid ? <section className="section"><h1>页面不存在</h1><a className="secondary" href="#/library">返回书库</a></section> :
      error ? <section className="section"><h1>{online ? '目录暂时无法加载' : '离线目录不可用，请联网后重试'}</h1><button className="filter" onClick={() => setRetry(retry+1)}>重试</button></section> :
      entries === null ? <section className="section"><p>正在加载文章目录…</p></section> :
      path === '#/library' ? <section className="section"><p className="kicker">找到下一篇想读的故事</p><h1>书库</h1>
        <label className="search-label" htmlFor="library-search">搜索文章</label><input className="search" id="library-search" type="search" value={query} onChange={e=>{setQuery(e.target.value);resetPage();}} placeholder="英文、中文标题或标签" />
        <div className="library-filters">
          <label>难度<select value={level} onChange={e=>{setLevel(e.target.value);resetPage();}}><option value="">全部难度</option>{['A1','A2','B1','B2','C1','C2'].map(x=><option key={x}>{x}</option>)}</select></label>
          <label>题材<select value={topic} onChange={e=>{setTopic(e.target.value);resetPage();}}><option value="">全部题材</option>{Object.entries(topics).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
          <label>来源<select value={source} onChange={e=>{setSource(e.target.value);resetPage();}}><option value="">全部来源</option>{Object.entries(sources).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
          <label>系列<select value={seriesFilter} onChange={e=>{setSeriesFilter(e.target.value);resetPage();}}><option value="">全部系列</option>{series.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>长度<select value={length} onChange={e=>{setLength(e.target.value);resetPage();}}><option value="">全部长度</option><option value="short">少于 300 词</option><option value="medium">300–800 词</option><option value="long">超过 800 词</option></select></label>
          <label>排序<select value={sort} onChange={e=>{setSort(e.target.value);resetPage();}}><option value="default">目录顺序</option><option value="latest">最新入库</option><option value="title">标题</option><option value="length">长度</option></select></label>
          <button className="filter" onClick={()=>{setQuery('');setLevel('');setTopic('');setSource('');setSeriesFilter('');setLength('');setSort('default');resetPage();}}>清除筛选</button>
        </div>
        {entries.length === 0 ? <p className="empty">书架正在准备中，文章通过审核后会出现在这里。</p> : matches.length === 0 ? <p className="empty">没有找到符合条件的文章。</p> : <><p aria-live="polite">找到 {matches.length} 篇 · 第 {page} / {pages} 页</p><div className="article-grid">{matches.slice((page-1)*24,page*24).map(item=><article className="article-card" key={item.id}><span className="tag">{item.level} · {topics[item.primary_topic]}</span><h2><a href={`#/article/${url(item.id)}`}>{item.title_en}</a></h2><p>{item.title_zh}</p><p>{item.summary_zh}</p><small>{item.word_count} 词 · 约 {Math.max(1,Math.ceil(item.word_count/150))} 分钟 · {sources[item.source_type]}</small>{item.series && <p><a className="secondary" href={`#/series/${url(item.series.id)}`}>查看连载</a></p>}</article>)}</div><div className="pagination"><button className="filter" disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><label>第 <input aria-label="跳转页码" className="page-number" type="number" min="1" max={pages} value={page} onChange={e => { const next = Number(e.target.value); if (Number.isInteger(next) && next >= 1 && next <= pages) setPage(next); }} /> / {pages} 页</label><button className="filter" disabled={page===pages} onClick={()=>setPage(page+1)}>下一页</button></div></>}
      </section> : match?.[1] === 'series' ? <section className="section"><a className="secondary" href="#/library">← 返回书库</a>{!seriesInfo || !chapters?.length ? <><h1>未找到这个系列</h1><p>该系列不存在或暂不可用。</p></> : <><p className="kicker">连载故事</p><h1>{seriesInfo.title}</h1><p className="intro">{seriesInfo.synopsis_zh}</p><p>已收录 {chapters.length} 个章节</p>{chapters.some((item, index) => item.series!.chapter !== index + 1) && <p className="empty" role="alert">章节目录不完整，请稍后再试。</p>}<h2>章节目录</h2><ol className="chapter-list">{chapters.map(item=><li key={item.id}><a href={`#/article/${url(item.id)}`}><span>第 {item.series!.chapter} 章</span><strong>{item.title_en}</strong><span>{item.title_zh} · {item.level}</span></a></li>)}</ol></>}</section> :
      <section className="section"><a className="secondary" href="#/library">← 返回书库</a>{!selected ? <><h1>未找到这篇文章</h1><p>文章不存在或暂不可用。</p></> : <><p className="kicker">{selected.level} · {topics[selected.primary_topic]}</p><h1>{selected.title_en}</h1><p>{selected.title_zh}</p><p>{selected.word_count} 词 · 约 {Math.max(1,Math.ceil(selected.word_count/150))} 分钟 · {sources[selected.source_type]}</p><Reader key={selected.id + ":" + selected.revision} entry={selected} />{selected.series && <nav className="chapter-nav" aria-label="章节导航"><a href={`#/series/${url(selected.series.id)}`}>章节目录</a>{chapterAt && <a href={`#/article/${url(chapterAt.id)}`}>上一章</a>}{chapterNext && <a href={`#/article/${url(chapterNext.id)}`}>下一章</a>}</nav>}</>}</section>}
    </main><footer><span>EnglishReading</span><a href="#/licenses">来源与许可</a></footer>
  </div>;
}
