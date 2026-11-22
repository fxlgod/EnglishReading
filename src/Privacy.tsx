import { useState } from 'react';
import { limit, readBackup, validateBackup } from './backup';
import type { Backup } from './backup';
import { restore, snapshot } from './storage';
import './privacy.css';

type Action = 'replace' | 'clear';

export function Privacy() {
  const [preview, setPreview] = useState<Backup | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败，请检查本机浏览器存储。'); }
    finally { setBusy(false); }
  }

  async function download() {
    const exported_at = new Date().toISOString();
    const data = validateBackup({ format_version: 1, exported_at, ...await snapshot() });
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    if (blob.size > limit) throw new Error('本机数据超过 5 MiB，无法生成可导入的备份。');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'EnglishReading-' + exported_at.slice(0, 10) + '.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('备份文件已生成。请妥善保管。');
  }

  async function apply(mode: 'merge' | Action) {
    try {
      if (mode === 'clear') {
        await restore({ progress: [], favorites: [], vocab: [], settings: [] }, 'replace');
      } else {
        if (!preview) return;
        await restore(preview, mode);
      }
    } catch {
      throw new Error('写入本机数据失败，原有记录已保留。请检查浏览器存储后重试。');
    }
    setPreview(null);
    setConfirm(null);
    setNotice(mode === 'clear' ? '本机个人数据已清除。' : '备份已导入。');
  }

  return <div className="app privacy">
    <header className="header"><a className="brand" href="#/personal">← 我的阅读</a></header>
    <main className="library-main"><section className="section privacy-content">
      <h1>数据与隐私</h1>
      <p>阅读进度、历史、已读状态、收藏、生词和已保存的阅读设置保存在当前浏览器中。网站不会上传这些记录。清除网站数据或更换浏览器前，请先导出备份。</p>
      <p>可将 JSON 文件手动导入另一台设备或浏览器。备份文件会包含阅读记录和生词例句，请仅分享给你信任的人。</p>
      <section className="privacy-card">
        <h2>备份与恢复</h2>
        <p>导出包含已保存的个人记录。临时记录、文章全文和浏览器缓存不在备份中。</p>
        <button className="filter" disabled={busy || !!confirm} onClick={() => void run(download)}>导出 JSON 备份</button>
        <label className="privacy-file">选择备份文件（最多 5 MiB）
          <input type="file" accept=".json,application/json" disabled={busy || !!confirm} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            setPreview(null);
            if (file) void run(async () => setPreview(await readBackup(file)));
          }} />
        </label>
        {preview && <section aria-labelledby="backup-preview">
          <h3 id="backup-preview">导入预览</h3>
          <p>格式 v{preview.format_version} · {new Date(preview.exported_at).toLocaleString()}</p>
          <p>阅读记录 {preview.progress.length} 条（已读 {preview.progress.filter(item => item.completed).length} 条） · 收藏 {preview.favorites.length} 条 · 生词 {preview.vocab.length} 条 · 设置 {preview.settings.length} 项</p>
          <p>合并时，同一条记录保留较新的版本。下架文章保留记录，修订后按可匹配句子恢复。</p>
          <div className="privacy-actions">
            <button className="filter" disabled={busy || !!confirm} onClick={() => void run(() => apply('merge'))}>确认合并</button>
            <button className="filter" disabled={busy || !!confirm} onClick={() => setConfirm('replace')}>覆盖恢复…</button>
            <button className="filter" disabled={busy || !!confirm} onClick={() => setPreview(null)}>取消导入</button>
          </div>
        </section>}
      </section>
      <section className="privacy-card">
        <h2>清理个人数据</h2>
        <p>清除本浏览器中本站的阅读记录、收藏、生词和设置。建议先导出备份。</p>
        <button className="filter" disabled={busy || !!confirm} onClick={() => setConfirm('clear')}>清除个人数据…</button>
      </section>
      {confirm && <section className="privacy-card" aria-labelledby="backup-confirm">
        <h2 id="backup-confirm">{confirm === 'clear' ? '确认清除个人数据' : '确认覆盖个人数据'}</h2>
        <p>{confirm === 'clear' ? '这会删除当前浏览器内的全部个人记录。此操作无法撤销。' : '这会用备份替换当前浏览器内的全部个人记录，包括备份中缺少的记录。此操作无法撤销。'}</p>
        <div className="privacy-actions">
          <button className="filter" disabled={busy} onClick={() => void run(() => apply(confirm))}>{confirm === 'clear' ? '永久清除' : '确认覆盖'}</button>
          <button className="filter" disabled={busy} onClick={() => setConfirm(null)}>返回</button>
        </div>
      </section>}
      {error && <p role="alert">{error}</p>}
      <p role="status">{notice}</p>
    </section></main>
  </div>;
}
