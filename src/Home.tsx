import { useEffect, useMemo, useState } from 'react';
import { all, isTemporary } from './storage';
import type { Progress } from './storage';
import { createContentLoader } from './core/content/load';
import type { Entry, SeriesSummary } from './core/content/types';
import { getTheme, setSiteTheme } from './theme';
import { updates } from './updates-data';
import './style.css';

const levels = ['A2/B1', '全部', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const topics: Record<string, string> = { school: '校园与青春', technology: '科技与未来', mystery: '悬疑与推理', adventure: '科幻与冒险', history: '历史与文化', daily_life: '日常生活', psychology_science: '心理与科学', literature: '童话与文学' };
const sources: Record<string, string> = { licensed_original: '授权原版', licensed_adaptation: '授权改编', ai_original: '原创', original_serial: '原创连载' };
const explorePageSize = 24;

export function Home() {
  const [dark, setDark] = useState(false);
  useEffect(() => { void getTheme().then(setDark); }, []);
  const [recent, setRecent] = useState<Progress[]>([]);
  const [temporary, setTemporary] = useState(false);
  useEffect(() => { const refresh = () => { setTemporary(isTemporary()); void all('progress').then(items => setRecent(items.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)))); }; refresh(); window.addEventListener('reading-storage-change', refresh); return () => window.removeEventListener('reading-storage-change', refresh); }, []);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('全部');
  const [topic, setTopic] = useState('全部');
  const [visibleLimit, setVisibleLimit] = useState(explorePageSize);

  useEffect(() => {
    let active = true;
    const base = new URL(import.meta.env.BASE_URL + 'content/', document.baseURI);
    createContentLoader(base).loadManifest().then(result => {
      if (active) { setEntries(result.articles); setSeries(result.series); setError(false); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attempt]);

  const matches = useMemo(() => {
    if (!entries) return [];
    const needle = query.trim().toLocaleLowerCase();
    return entries.filter(item => (level === '全部' || (level === 'A2/B1' ? ['A2', 'B1'].includes(item.level) : item.level === level)) &&
      (topic === '全部' || item.primary_topic === topic) &&
      (!needle || [item.title_en, item.title_zh, ...item.tags].some(text => text.toLocaleLowerCase().includes(needle))));
  }, [entries, query, level, topic]);
  const visible = matches.slice(0, visibleLimit);
  const latest = recent.map(item => entries?.find(entry => entry.id === item.articleId)).find(Boolean);
  const featured = entries?.filter(item => item.featured).slice(0, 6);

  return <div className="app" data-theme={dark ? 'dark' : 'light'}>
    <a className="skip" href="#main">跳到主要内容</a>
    <header className="header"><a className="brand" href="#top"><span className="brand-mark" aria-hidden="true">e.</span><span>EnglishReading<small>一个阅读的地方</small></span></a><nav aria-label="页面导航"><a href="#explore">探索</a><a href="#/library">书库</a><a href="#series">连载</a><a href="#/personal">我的阅读</a></nav><button className="theme" onClick={() => { setDark(!dark); void setSiteTheme(!dark); }} aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}>{dark ? '☀ 浅色' : '◐ 深色'}</button></header>
    <main id="main"><section className="hero home-hero" id="top"><div className="hero-copy"><p className="kicker">为好奇心，留一点时间</p><h1>阅读不必赶路。<br /><em>故事会等你。</em></h1><p className="intro">从一个感兴趣的故事开始，在英文里发现更大的世界。</p><a className="primary" href="#/library">探索书架 <span aria-hidden="true">↗</span></a><p className="note">按自己的节奏阅读，无需考试和打卡。</p></div><div className="home-aside"><p className="kicker">继续阅读</p><h2>下一次打开，<br />会遇见什么？</h2>{temporary && <p role="alert">本机存储不可用，当前仅为临时记录，关闭后可能丢失。</p>}{latest ? <><p>{latest.title_en}</p><a href={`#/article/${latest.id}`}>继续阅读 →</a></> : <><p>阅读记录将在这里出现。</p><a href="#explore">先去发现故事 →</a></>}</div></section>
    <section className="section" id="explore"><div className="section-heading"><div><p className="kicker">找到适合你的那一篇</p><h2>从哪里开始？</h2></div><p>按标题、标签、难度或兴趣寻找文章。</p></div>
      <label className="search-label" htmlFor="search">搜索文章</label><input id="search" className="search" type="search" value={query} onChange={event => { setQuery(event.target.value); setVisibleLimit(explorePageSize); }} placeholder="输入英文、中文标题或标签" />
      <div className="filter-group" role="group" aria-label="选择难度">{levels.map(item => <button key={item} className={level === item ? 'filter active' : 'filter'} aria-pressed={level === item} onClick={() => { setLevel(item); setVisibleLimit(explorePageSize); }}>{item === 'A2/B1' ? '推荐 A2/B1' : item}</button>)}</div>
      <div className="filter-group" role="group" aria-label="选择题材"><button className={topic === '全部' ? 'filter active' : 'filter'} aria-pressed={topic === '全部'} onClick={() => { setTopic('全部'); setVisibleLimit(explorePageSize); }}>全部题材</button>{Object.entries(topics).map(([key, label]) => <button key={key} className={topic === key ? 'filter active' : 'filter'} aria-pressed={topic === key} onClick={() => { setTopic(key); setVisibleLimit(explorePageSize); }}>{label}</button>)}</div>
      <div className="subhead"><h3>探索文章</h3><span>{entries && entries.length > 0 ? '按目录顺序展示' : ''}</span></div>
      {error ? <div className="empty" role="alert">文章目录暂时无法加载。 <button onClick={() => { setError(false); setAttempt(attempt + 1); }}>重试</button></div> : entries === null ? <p className="empty">正在加载文章目录…</p> : entries.length === 0 ? <p className="empty">书架正在准备中，文章通过审核后会出现在这里。</p> : matches.length === 0 ? <p className="empty">没有找到符合条件的文章。试试其他关键词或条件。</p> : <>
        <p aria-live="polite">已显示 {visible.length} / 共 {matches.length} 篇</p>
        <div className="article-grid">{visible.map(item => <article className="article-card" key={item.id}><span className="tag">{item.level} · {topics[item.primary_topic]}</span><h3><a href={`#/article/${item.id}`}>{item.title_en}</a></h3><p>{item.title_zh}</p><p>{item.summary_zh}</p><small>{item.word_count} 词 · 约 {Math.max(1, Math.ceil(item.word_count / 150))} 分钟 · {sources[item.source_type]}</small></article>)}</div>
        {matches.length > explorePageSize && <div className="pagination"><button className="filter" type="button" disabled={visible.length === matches.length} onClick={() => setVisibleLimit(limit => limit + explorePageSize)}>{visible.length === matches.length ? '已显示全部' : '显示更多'}</button></div>}
      </>}
    </section><section className="section" aria-labelledby="featured"><h2 id="featured">编辑精选</h2>{
      error ? <p className="empty">目录暂不可用。</p> :
      !featured ? <p className="empty">正在加载…</p> :
      featured.length === 0 ? <p className="empty">精选内容正在准备中。</p> :
      <div className="article-grid">{featured.map(item => <article className="article-card" key={item.id}>
        <span className="tag">{item.level} · {topics[item.primary_topic]}</span>
        <h3><a href={`#/article/${item.id}`}>{item.title_en}</a></h3>
        <p>{item.title_zh}</p><p>{item.summary_zh}</p>
        <small>{item.word_count} 词 · 约 {Math.max(1, Math.ceil(item.word_count / 150))} 分钟</small>
      </article>)}</div>
    }</section><section className="section" id="series"><div className="section-heading"><div><p className="kicker">故事还在继续</p><h2>连载故事</h2></div><p>跟随熟悉的角色，走进下一个章节。</p></div>{error ? <p className="empty">目录暂不可用。</p> : entries === null ? <p className="empty">正在加载…</p> : series.length === 0 ? <p className="empty">连载故事正在准备中。</p> : <div className="article-grid">{series.slice(0, 6).map(item => <article className="article-card" key={item.id}><span className="tag">连载</span><h3>{item.title}</h3><p>{item.synopsis_zh}</p><p><a className="secondary" href={`#/series/${item.id}`}>查看连载章节 →</a></p></article>)}</div>}</section>
    </main><footer className="site-footer"><span>EnglishReading</span><a href="#/updates">更新日志{updates[0] && ` · ${updates[0].version}`}</a><a href="#/licenses">来源与许可</a></footer>
  </div>;
}
