import { useEffect, useState } from 'react';
import { getTheme, setSiteTheme } from './theme';
import { updates } from './updates-data';
import './style.css';

export function Updates() {
  const [dark, setDark] = useState(false);
  useEffect(() => { void getTheme().then(setDark); }, []);

  return <div className="app" data-theme={dark ? 'dark' : 'light'}>
    <a className="skip" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>跳到主要内容</a>
    <header className="header">
      <a className="brand" href="#">EnglishReading</a>
      <nav aria-label="页面导航"><a href="#/library">书库</a></nav>
      <button className="theme" type="button" onClick={() => { setDark(!dark); void setSiteTheme(!dark); }}>
        {dark ? '切换到浅色模式' : '切换到深色模式'}
      </button>
    </header>
    <main id="main" className="library-main" tabIndex={-1}>
      <section className="section"><h1>更新日志</h1>
        {updates.length === 0 ? <p>暂无发布记录。</p> : <ol className="personal-list update-list">
          {updates.map(update => <li key={`${update.version}-${update.date}-${update.title}`}>
            <article>
              <p className="tag"><time dateTime={update.date}>{update.date}</time> · {update.version} · {update.articleCount} 篇</p>
              <h2>{update.title}</h2>
              <p>{update.body}</p>
            </article>
          </li>)}
        </ol>}
      </section>
    </main>
  </div>;
}
