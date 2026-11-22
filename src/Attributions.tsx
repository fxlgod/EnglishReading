import { useEffect, useState } from 'react';
import './style.css';

type Credit = {id:string; title_en:string; author:string; kind:string; modifications:string;
  source_url?:string; license_url?:string; original_title?:string; attribution_notice?:string; adaptation_license_url?:string};
const optionalText = (value: unknown) => value === undefined || typeof value === 'string';
const safeLink = (value: unknown): boolean => {
  if (typeof value !== 'string' || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
};
function isCredit(row: Credit): boolean {
  return row != null && typeof row.id === 'string' && typeof row.title_en === 'string' &&
    typeof row.author === 'string' && typeof row.kind === 'string' && typeof row.modifications === 'string' &&
    [row.original_title,row.attribution_notice].every(optionalText) &&
    [row.source_url,row.license_url,row.adaptation_license_url].every(url => url === undefined || safeLink(url));
}

const licenseNames: Record<string,string> = {project_original:'项目原创',public_domain:'公共领域',
  written_permission:'书面许可','CC-BY':'CC BY','CC-BY-SA':'CC BY-SA',CC0:'CC0'};

export function Attributions() {
  const [credits, setCredits] = useState<Credit[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let active = true;
    const url = new URL(import.meta.env.BASE_URL + 'content/attributions.json', document.baseURI);
    void fetch(url, {signal:AbortSignal.timeout(10_000)}).then(async response => {
      if (!response.ok) throw new Error('Attribution index unavailable');
      const data = await response.json();
      if (data?.schema_version !== 2 || !Array.isArray(data.articles) || !data.articles.every(isCredit)) {
        throw new Error('Invalid attribution index');
      }
      if (active) setCredits(data.articles);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  return <div className="app">
    <a className="skip" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>跳到主要内容</a>
    <header className="header"><a className="brand" href="#">EnglishReading</a><nav aria-label="页面导航"><a href="#/library">书库</a></nav></header>
    <main id="main" tabIndex={-1} className="library-main"><section className="section">
      <h1>来源与许可</h1>
      <p>这里列出已发布文章的原作、作者、来源、适用许可和改动说明。译文与改编的许可按各条目所示。</p>
      <p>项目代码及平台原创文本的复用许可仍待负责人批准。</p>
      {failed ? <p className="empty" role="alert">暂时无法载入署名目录。 <button type="button" onClick={() => {
        setFailed(false); setAttempt(attempt + 1);
      }}>重试</button></p> : credits === undefined ? <p role="status">正在加载署名目录…</p> :
        credits.length === 0 ? <p className="empty">正式书库尚无已发布文章。</p> : <>
          <ul className="personal-list">{credits.slice((page-1)*24,page*24).map(item => <li key={item.id}>
            <h2 lang="en">{item.title_en}</h2>
            {item.original_title && <p>原作 <span lang="en">{item.original_title}</span></p>}
            <p>{item.attribution_notice ?? item.author}</p>
            <p>{item.modifications}</p>
            <p>{item.source_url && <><a href={item.source_url}>原始来源</a> · </>}
              {item.license_url ? <a href={item.license_url}>{licenseNames[item.kind] ?? item.kind}</a> : (licenseNames[item.kind] ?? item.kind)}
              {item.adaptation_license_url && <> · <a href={item.adaptation_license_url}>译文与改编许可</a></>}</p>
          </li>)}</ul>
          {credits.length > 24 && <div className="pagination">
            <button className="filter" disabled={page===1} onClick={() => setPage(page-1)}>上一页</button>
            <span role="status">第 {page} 页</span>
            <button className="filter" disabled={page*24>=credits.length} onClick={() => setPage(page+1)}>下一页</button>
          </div>}
        </>}
    </section></main>
  </div>;
}
