import { useEffect, useState } from 'react';
import { all, isTemporary, remove } from './storage';
import type { Progress, Vocab, Favorite } from './storage';
import { createContentLoader } from './core/content/load';
import type { Entry } from './core/content/types';
import './style.css';

export function Personal() {
  const [dark, setDark] = useState(false);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [vocab, setVocab] = useState<Vocab[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      setTemporary(isTemporary());
      void Promise.all([all('progress'), all('vocab'), all('favorites')]).then(([p, v, f]) => {
        if (active) { setProgress(p.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))); setVocab(v); setFavorites(f); }
      });
    };
    refresh(); window.addEventListener('reading-storage-change', refresh);
    createContentLoader(new URL(import.meta.env.BASE_URL + 'content/', document.baseURI)).loadManifest()
      .then(manifest => { if (active) setEntries(manifest.articles); }).catch(() => { if (active) setError(true); });
    return () => { active = false; window.removeEventListener('reading-storage-change', refresh); };
  }, []);
  const title = (id: string) => entries?.find(entry => entry.id === id)?.title_en;
  const filtered = vocab.filter(item => [item.surface, item.lemma, item.gloss, item.sentence].some(text => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return <div className="app" data-theme={dark ? 'dark' : 'light'}>
    <header className="header"><a className="brand" href="#"><span className="brand-mark">e.</span><span>EnglishReading<small>一个阅读的地方</small></span></a><nav aria-label="页面导航"><a href="#">首页</a><a href="#/library">书库</a></nav><button className="theme" onClick={() => setDark(!dark)} aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}>{dark ? '☀ 浅色' : '◐ 深色'}</button></header>
    <main className="library-main"><section className="section"><p className="kicker">你的阅读空间</p><h1>我的阅读</h1>
      <p><a className="secondary" href="#/privacy">数据与隐私设置 →</a> · <a className="secondary" href="#/offline">离线阅读</a></p>
      <p>记录只保存在此浏览器中；清除浏览器数据可能导致记录丢失，不会自动跨设备同步。</p>
      {temporary && <p role="alert">本机存储不可用，当前仅为临时记录，关闭页面后可能丢失。请检查浏览器存储设置。</p>}
      {error && <p role="alert">文章目录暂不可用，已保留本机记录。</p>}
      <h2>最近阅读</h2>{progress.length === 0 ? <p className="empty">还没有阅读记录。</p> : <ul className="personal-list">{progress.map(item => <li key={item.articleId}>{title(item.articleId) ? <a href={`#/article/${item.articleId}`}>{title(item.articleId)}</a> : <span>文章已不可用（{item.articleId}）</span>} · {item.completed ? '已读' : '继续阅读'}</li>)}</ul>}
      <h2>收藏文章</h2>{favorites.length === 0 ? <p className="empty">还没有收藏文章。</p> : <ul className="personal-list">{favorites.map(item => <li key={item.articleId}>{title(item.articleId) ? <a href={`#/article/${item.articleId}`}>{title(item.articleId)}</a> : <span>文章已不可用（{item.articleId}）</span>} <button className="filter" onClick={() => { void remove('favorites',item.articleId); }}>取消收藏</button></li>)}</ul>}
      <h2>生词本</h2><label className="search-label" htmlFor="vocab-search">检索生词或释义</label><input id="vocab-search" className="search" type="search" value={query} onChange={event => setQuery(event.target.value)} />
      {filtered.length === 0 ? <p className="empty">{vocab.length ? '没有找到匹配的生词。' : '还没有收藏生词或短语。'}</p> : <ul className="personal-list">{filtered.map(item => <li key={item.id}><strong lang="en">{item.surface}</strong> · {item.pos} · {item.gloss}<p lang="en">{item.sentence}</p><p>{title(item.articleId) ? <a href={`#/article/${item.articleId}`}>{title(item.articleId)}</a> : '来源文章已不可用'}</p><button className="filter" onClick={() => { void remove('vocab',item.id); }}>删除 {item.surface}</button></li>)}</ul>}
    </section></main><footer><span>EnglishReading</span><span>为阅读而做，慢慢来。</span></footer>
  </div>;
}
