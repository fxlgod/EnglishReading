import { useEffect, useState } from 'react';
import type { Entry } from './core/content/types';
import { createContentLoader } from './core/content/load';
import { installApp, offlineCache, syncOfflineApp, useOfflineApp, useOnline } from './offline-client';

export function Offline() {
  const [cache, setCache] = useState<Awaited<ReturnType<typeof offlineCache>>>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);
  const {controller, install, message, revision} = useOfflineApp();
  const online = useOnline();
  useEffect(() => {
    let active = true;
    if (controller) void offlineCache('list').then(data => { if (active) setCache(data); })
      .catch(() => { if (active) setError('无法读取离线缓存。'); });
    return () => { active = false; };
  }, [controller, online, revision]);

  async function manage(action: 'clear' | 'remove', path?: string) {
    setBusy(true);
    setError('');
    try { setCache(await offlineCache(action, path)); }
    catch { setError('离线缓存操作失败，请重试。'); }
    finally { setBusy(false); }
  }

  return <div className="app" data-theme={dark ? 'dark' : 'light'}>
    <a className="skip" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>跳到主要内容</a>
    <header className="header"><a className="brand" href="#">EnglishReading</a>
      <nav aria-label="页面导航"><a href="#/library">书库</a><a href="#/personal">我的阅读</a></nav>
      <button className="theme" type="button" onClick={() => setDark(!dark)}>{dark ? '浅色' : '深色'}</button>
    </header>
    <main id="main" tabIndex={-1} className="library-main"><section className="section">
      <h1>离线阅读</h1>
      <p role="status">{online ? '网络已连接' : '当前离线'}{message ? ' · ' + message : ''}</p>
      {install ? <button type="button" className="filter" onClick={() => { void installApp().catch(() => setError('安装未能启动，请使用浏览器菜单。')); }}>安装 EnglishReading</button>
        : <p>支持安装的设备可通过浏览器菜单添加 EnglishReading。</p>}
      <p>首次使用请联网打开。只有已缓存的文章可以离线阅读；已下架内容需联网更新后才能移除。</p>
      {online && controller && <button type="button" className="filter" onClick={() => {
        setError('');
        void syncOfflineApp().catch(() => setError('暂时无法检查更新。'));
      }}>检查更新</button>}
      {error && <p role="alert">{error}</p>}
      {cache ? <>
        <h2>已缓存文章</h2>
        <p>{cache.saved.length} / {cache.limit} 篇，每篇最多 {cache.maxMiB} MiB。达到上限时会移除最早保存的文章。</p>
        <p>清理这里的文章缓存会释放空间，个人阅读记录、生词本、收藏和设置仍保存在本机。</p>
        {cache.saved.length ? <>
          <button type="button" className="filter" disabled={busy} onClick={() => void manage('clear')}>清除全部文章缓存</button>
          <ul className="offline-list">{cache.saved.map(entry => <li key={entry.id}>
            <a href={'#/article/' + entry.id}>{entry.title_en}</a>
            <button type="button" className="filter" disabled={busy} aria-label={'移除离线缓存：' + entry.title_en}
              onClick={() => void manage('remove', entry.path)}>移除</button>
          </li>)}</ul>
        </> : <p>暂无已缓存文章。联网阅读时会尝试自动保存。</p>}
      </> : <p>{controller ? '正在读取离线缓存…' : '离线功能尚未就绪。请联网打开或检查浏览器是否支持。'}</p>}
    </section></main>
  </div>;
}

export function OfflineArticle({entry}: {entry: Entry}) {
  const {controller, revision} = useOfflineApp();
  const online = useOnline();
  const [saved, setSaved] = useState<boolean>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (controller) void offlineCache('list', entry.path).then(data => {
      if (active) setSaved(data.saved.some(item => item.path === entry.path));
    }).catch(() => { if (active) setError('无法确认离线保存状态。'); });
    return () => { active = false; };
  }, [controller, entry.path, online, revision]);
  if (!controller) return null;
  async function save() {
    setBusy(true);
    setError('');
    try {
      await createContentLoader(new URL(import.meta.env.BASE_URL + 'content/', document.baseURI)).loadArticle(entry);
      const data = await offlineCache('list', entry.path);
      const exists = data.saved.some(item => item.path === entry.path);
      setSaved(exists);
      if (!exists) setError('未能保存离线副本。该文章可能超出单篇上限，或浏览器存储空间不足。');
    } catch { setError('无法保存离线副本，请联网后重试。'); }
    finally { setBusy(false); }
  }
  return <div className="reader-actions">
    <span role="status">{saved === undefined ? '正在确认离线状态…' : saved ? '已缓存 · 可离线阅读' : '未缓存'}</span>
    {saved === false && online && <button className="filter" type="button" disabled={busy} onClick={() => void save()}>保存离线副本</button>}
    <a className="secondary" href="#/offline">管理离线文章</a>
    {error && <p role="alert">{error}</p>}
  </div>;
}
