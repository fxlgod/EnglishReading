import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { all, put } from './storage';

type Setting = 'fontSize' | 'lineHeight' | 'readingWidth' | 'theme';
type Values = { fontSize: number; lineHeight: number; readingWidth: number; theme: 'light' | 'dark' | 'system' };
const initial: Values = { fontSize: 20, lineHeight: 1.95, readingWidth: 68, theme: 'system' };
export function ReadingSettings({ onChange }: { onChange: (values: Values) => void }) {
  const [values, setValues] = useState(initial);
  const [ready, setReady] = useState(false);
  const anchor = useRef<{element: HTMLElement; top: number} | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => { void all('settings').then(rows => {
      if (!active) return;
      const next = { ...initial };
      for (const {id,value} of rows) {
        if (id === 'fontSize' && typeof value === 'number' && value >= 12 && value <= 48) next.fontSize = value;
        if (id === 'lineHeight' && typeof value === 'number' && value >= 1 && value <= 3) next.lineHeight = value;
        if (id === 'readingWidth' && typeof value === 'number' && value >= 40 && value <= 90) next.readingWidth = value;
        if (id === 'theme' && (value === 'light' || value === 'dark' || value === 'system')) next.theme = value;
      }
      setValues(next); onChange(next); setReady(true);
    }); };
    const themeChanged = (event: Event) => {
      const theme = (event as CustomEvent<string>).detail;
      if (theme === 'light' || theme === 'dark') setValues(previous => previous.theme === theme ? previous : {...previous, theme});
    };
    load();
    window.addEventListener('reading-theme-change', themeChanged);
    return () => { active = false; window.removeEventListener('reading-theme-change', themeChanged); };
  }, [onChange]);
  useLayoutEffect(() => {
    if (anchor.current) {
      const {element,top} = anchor.current;
      window.scrollBy({ top: element.getBoundingClientRect().top - top, behavior: 'instant' });
      anchor.current = null;
    }
  }, [values]);
  function update(id: Setting, value: number | Values['theme']) {
    const element = [...document.querySelectorAll<HTMLElement>('[data-sentence-id]')].find(el => el.getBoundingClientRect().bottom > 100);
    if (element) anchor.current = {element, top: element.getBoundingClientRect().top};
    const next = {...values, [id]: value};
    setValues(next); onChange(next);
    void put('settings', {id, value, updatedAt: new Date().toISOString()});
  }
  return <details className="reading-settings"><summary>阅读设置</summary>
    <div className="settings-fields">
      <label>字号 <select aria-label="字号" disabled={!ready} value={values.fontSize} onChange={e => update('fontSize',Number(e.target.value))}>{![16,20,24,30].includes(values.fontSize) && <option value={values.fontSize}>{values.fontSize}px</option>}<option value="16">小</option><option value="20">标准</option><option value="24">大</option><option value="30">特大</option></select></label>
      <label>行距 <select aria-label="行距" disabled={!ready} value={values.lineHeight} onChange={e => update('lineHeight',Number(e.target.value))}>{![1.5,1.95,2.3].includes(values.lineHeight) && <option value={values.lineHeight}>{values.lineHeight}</option>}<option value="1.5">紧凑</option><option value="1.95">标准</option><option value="2.3">宽松</option></select></label>
      <label>阅读宽度 <select aria-label="阅读宽度" disabled={!ready} value={values.readingWidth} onChange={e => update('readingWidth',Number(e.target.value))}>{![48,68,80].includes(values.readingWidth) && <option value={values.readingWidth}>{values.readingWidth}</option>}<option value="48">窄</option><option value="68">标准</option><option value="80">宽</option></select></label>
      <label>主题 <select aria-label="阅读主题" disabled={!ready} value={values.theme} onChange={e => update('theme',e.target.value as Values['theme'])}><option value="system">跟随页面</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
    </div>
  </details>;
}
