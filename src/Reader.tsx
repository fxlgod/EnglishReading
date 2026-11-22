import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Speech } from './Speech';
import { OfflineArticle } from './Offline';
import { useOnline } from './offline-client';
import { ReadingSettings } from './ReadingSettings';
import { all, put, remove, isTemporary } from './storage';
import type { Vocab, Favorite } from './storage';
import { createContentLoader } from './core/content/load';
import type { Article, Entry, Sentence } from './core/content/types';
import { matchingPhrases, words } from './core/content/words';
import './reader.css';

type Token = Sentence['tokens'][number];
type Lookup = { token: Token; sentence: Sentence; trigger: HTMLButtonElement };

function validateBody(article: Article) {
  const ids = new Set<string>();
  for (const { sentences } of article.paragraphs) {
    if (!sentences.length) throw new Error('Empty paragraph');
    for (const sentence of sentences) {
      const { id, text, translation_zh, separator_after, tokens, phrases } = sentence;
      const expected = words(text);
      if (!id.trim() || ids.has(id) || !translation_zh.trim() ||
          (separator_after !== '' && separator_after !== ' ') ||
          !expected.length || tokens.length !== expected.length ||
          !tokens.every((token, i) => token.start === expected[i].start &&
            token.end === expected[i].end && token.surface === expected[i].surface &&
            token.gloss_zh.trim() && token.lemma.trim() && token.pos.trim())) {
        throw new Error('Invalid sentence annotations');
      }
      const starts = new Set(tokens.map(token => token.start));
      const ends = new Set(tokens.map(token => token.end));
      if (!phrases.every(phrase => starts.has(phrase.start) && ends.has(phrase.end) &&
          phrase.start < phrase.end && text.slice(phrase.start, phrase.end) === phrase.surface &&
          phrase.gloss_zh.trim())) throw new Error('Invalid phrase annotations');
      ids.add(id);
    }
  }
}

function SentenceLine({ sentence, translated, toggle, select, lookup }: {
  sentence: Sentence; translated: boolean; toggle: () => void;
  select: (lookup: Lookup) => void; lookup: Lookup | null;
}) {
  const id = useId();
  let cursor = 0;
  return <span className="sentence-line">
    <span lang="en" className="sentence-text">{sentence.tokens.map(token => {
      const gap = sentence.text.slice(cursor, token.start);
      cursor = token.end;
      return <span key={token.start}>{gap}<button type="button" className="reader-word"
        aria-expanded={lookup?.token === token} onClick={event => select({ token, sentence, trigger: event.currentTarget })}
      >{token.surface}</button></span>;
    })}{sentence.text.slice(cursor)}</span>
    <button type="button" className="sentence-toggle" aria-expanded={translated} aria-controls={id}
      aria-label={translated ? '收起句译' : '展开句译'} onClick={toggle}>译</button>
    <span className="sentence-translation" id={id} lang="zh-CN" hidden={!translated}>{sentence.translation_zh}</span>
    {sentence.separator_after}
  </span>;
}

function ReadingBody({ article }: { article: Article }) {
  const applySettings = useCallback((values: {fontSize:number; lineHeight:number; readingWidth:number; theme:'light'|'dark'|'system'}) => {
    const reader = document.querySelector<HTMLElement>('.reader');
    if (!reader) return;
    reader.style.setProperty('--reading-font-size', values.fontSize + 'px');
    reader.style.setProperty('--reading-line-height', String(values.lineHeight));
    reader.style.setProperty('--reading-width', values.readingWidth + 'ch');
    const app = reader.closest<HTMLElement>('.app');
    if (app && values.theme !== 'system') {
      app.dataset.theme = values.theme;
      window.dispatchEvent(new CustomEvent('reading-theme-change', {detail: values.theme}));
    }
  }, []);
  const [translated, setTranslated] = useState(() => new Set<string>());
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [meaning, setMeaning] = useState(0);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [savedWords, setSavedWords] = useState<Vocab[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [temporary, setTemporary] = useState(false);
  const [resumeNotice, setResumeNotice] = useState('');
  const [completed, setCompleted] = useState(false);
  const [savingCompleted, setSavingCompleted] = useState(false);
  const completedRef = useRef(false);
  const lastSentence = useRef('');

  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const headingId = useId();
  const allIds = article.paragraphs.flatMap(paragraph => paragraph.sentences.map(sentence => sentence.id));
  const allShown = translated.size === allIds.length;
  const phrases = lookup ? matchingPhrases(lookup.sentence.phrases, lookup.token) : [];
  const phrase = phrases[meaning];

  useEffect(() => {
    let active = true;
    const refresh = () => {
      setTemporary(isTemporary());
      void all('vocab').then(items => { if (active) setSavedWords(items); });
      void all('favorites').then(items => { if (active) setFavorites(items); });
    };
    refresh();
    window.addEventListener('reading-storage-change', refresh);
    return () => { active = false; window.removeEventListener('reading-storage-change', refresh); };
  }, []);

  useEffect(() => {
    let active = true;
    let track = () => {};
    let restoring = false;
    void all('progress').then(items => {
      if (!active) return;
      const saved = items.find(item => item.articleId === article.id);
      const candidates = [...document.querySelectorAll<HTMLElement>('[data-sentence-id]')];
      if (saved) {
        const target = candidates.find(item => item.dataset.sentenceId === saved.sentenceId);
        completedRef.current = saved.completed;
        setCompleted(saved.completed);
        if (target) {
          lastSentence.current = saved.sentenceId;
          restoring = true;
          requestAnimationFrame(() => {
            if (!active) return;
            target.scrollIntoView({ block: 'center', behavior: 'instant' });
            setResumeNotice(saved.revision === article.revision ? '已恢复上次阅读位置。' : '文章已更新，已按句子恢复阅读位置。');
            requestAnimationFrame(() => { restoring = false; });
          });
        } else setResumeNotice('文章已更新，原阅读位置不可用，已回到文章开头。');
      }
      track = () => {
        if (restoring) return;
        const visible = candidates.find(item => item.getBoundingClientRect().bottom > 100 && item.getBoundingClientRect().top < innerHeight);
        if (!visible) return;
        const sentenceId = visible.dataset.sentenceId!;
        if (lastSentence.current === sentenceId) return;
        lastSentence.current = sentenceId;
        void put('progress', { articleId: article.id, revision: article.revision, sentenceId, completed: completedRef.current, updatedAt: new Date().toISOString() });
      };
      if (!saved) track();
      window.addEventListener('scroll', track, { passive: true });
    });
    return () => { active = false; window.removeEventListener('scroll', track); };
  }, [article]);
  const selectedId = lookup ? JSON.stringify([article.id, lookup.sentence.id, phrase ? 'phrase' : 'word', phrase?.start ?? lookup.token.start, phrase?.end ?? lookup.token.end]) : '';
  const favorite = favorites.some(item => item.articleId === article.id);

  useEffect(() => {
    if (!lookup) return;
    closeButton.current?.focus({ preventScroll: true });
    function place() {
      if (!panel.current || !lookup) return;
      const rect = lookup.trigger.getBoundingClientRect();
      const bounds = panel.current.getBoundingClientRect();
      panel.current.dataset.edge = rect.bottom + bounds.height + 24 > innerHeight ? 'top' : 'bottom';
      const column = lookup.trigger.closest('.reader')!.getBoundingClientRect();
      const side = column.right + bounds.width + 24 <= innerWidth;
      const left = side ? column.right + 12 : rect.left;
      panel.current.style.setProperty('--lookup-left', Math.max(12, Math.min(left, innerWidth - bounds.width - 12)) + 'px');
      const top = side ? rect.top : rect.bottom + bounds.height + 12 <= innerHeight ? rect.bottom + 8 : rect.top - bounds.height - 8;
      panel.current.style.setProperty('--lookup-top', Math.max(12, Math.min(top, innerHeight - bounds.height - 12)) + 'px');
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setLookup(null);
      lookup?.trigger.focus({ preventScroll: true });
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Element && !panel.current?.contains(event.target) && !event.target.closest('.reader-word')) {
        if (panel.current?.contains(document.activeElement)) lookup?.trigger.focus({ preventScroll: true });
        setLookup(null);
      }
    }
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    document.addEventListener('keydown', onEscape);
    document.addEventListener('pointerdown', outside);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place);
      document.removeEventListener('keydown', onEscape);
      document.removeEventListener('pointerdown', outside);
    };
  }, [lookup]);

  return <div className="reader">
    {temporary && <p role="alert">本机存储不可用，当前仅为临时记录，关闭页面后可能丢失。请检查浏览器存储设置。</p>}
    {resumeNotice && <p role="status">{resumeNotice}</p>}
    <div className="reader-actions"><button type="button" className="filter" onClick={() => { void (favorite ? remove('favorites', article.id) : put('favorites', {articleId: article.id, createdAt: new Date().toISOString()})); }}>{favorite ? '取消收藏文章' : '收藏文章'}</button>
    <button type="button" className="filter" disabled={savingCompleted} onClick={async () => {
      const next = !completed;
      completedRef.current = next;
      setSavingCompleted(true);
      try {
        await put('progress', {articleId: article.id, revision: article.revision, sentenceId: lastSentence.current || allIds[0], completed: next, updatedAt: new Date().toISOString()});
        setCompleted(next);
      } finally { setSavingCompleted(false); }
    }}>{completed ? '取消标记已读' : '标记已读'}</button></div>
    <ReadingSettings onChange={applySettings} />
    <Speech sentences={article.paragraphs.flatMap(paragraph => paragraph.sentences)} onCurrent={setSpeakingId} />
    <button type="button" className="filter" aria-pressed={allShown}
      onClick={() => setTranslated(allShown ? new Set() : new Set(allIds))}>全文译文</button>
    <div className="reader-body" aria-label="文章正文">
      {article.paragraphs.map(({ sentences }) => <p key={sentences[0].id}>{sentences.map(sentence =>
        <span key={sentence.id} data-sentence-id={sentence.id} className={speakingId === sentence.id ? 'speaking-sentence' : undefined}><SentenceLine sentence={sentence} translated={translated.has(sentence.id)}
          toggle={() => setTranslated(previous => {
            const next = new Set(previous);
            if (next.has(sentence.id)) next.delete(sentence.id);
            else next.add(sentence.id);
            return next;
          })}
          select={next => {
            setMeaning(0);
            setLookup(lookup?.trigger === next.trigger ? null : next);
          }} lookup={lookup} /></span>)}</p>)}
    </div>
    {lookup && <section ref={panel} className="lookup" role="dialog" aria-labelledby={headingId}>
      <div className="lookup-head">
        <h2 id={headingId} lang="en">{phrase ? phrase.surface : lookup.token.surface}</h2>
        <button type="button" ref={closeButton} aria-label="关闭词义" onClick={() => {
          setLookup(null);
          lookup.trigger.focus({ preventScroll: true });
        }}>×</button>
      </div>
      <p className="lookup-meta">{phrase ? '语境短语' : <><span lang="en">{lookup.token.lemma} · {lookup.token.pos}</span>{lookup.token.ipa && ' · ' + lookup.token.ipa}</>}</p>
      <p className="lookup-gloss" aria-live="polite">{phrase ? phrase.gloss_zh : lookup.token.gloss_zh}</p>
      <button type="button" onClick={() => {
        const existing = savedWords.some(item => item.id === selectedId);
        if (existing) { void remove('vocab', selectedId); return; }
        void put('vocab', { id: selectedId, lemma: phrase ? phrase.surface.toLowerCase() : lookup.token.lemma, surface: phrase ? phrase.surface : lookup.token.surface, pos: phrase ? '短语' : lookup.token.pos, gloss: phrase ? phrase.gloss_zh : lookup.token.gloss_zh, articleId: article.id, sentenceId: lookup.sentence.id, phraseSpan: phrase ? [phrase.start, phrase.end] : null, sentence: lookup.sentence.text, createdAt: new Date().toISOString() });
      }}>{savedWords.some(item => item.id === selectedId) ? '移出生词本' : '加入生词本'}</button>
      {phrases.length > 0 && <div className="lookup-options" role="group" aria-label="切换释义">
        {phrases.map((item, index) => <button key={item.start + ':' + item.end + ':' + index} type="button"
          aria-pressed={meaning === index} onClick={() => setMeaning(index)} lang="en">{item.surface}</button>)}
        <button type="button" aria-pressed={meaning === phrases.length} onClick={() => setMeaning(phrases.length)}>单词义</button>
      </div>}
    </section>}
  </div>;
}

export function Reader({ entry }: { entry: Entry }) {
  const [article, setArticle] = useState<Article | null>(null);
  const online = useOnline();
  const [failed, setFailed] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    const loader = createContentLoader(new URL(import.meta.env.BASE_URL + 'content/', document.baseURI));
    loader.loadArticle(entry).then(result => {
      if (!current) return;
      validateBody(result);
      setArticle(result);
    }).catch(error => { if (current) setFailed(error.message); });
    return () => { current = false; };
  }, [entry, attempt]);

  if (failed) return <div className="empty" role="alert">{failed === 'offline-corrupt' ? '离线副本已损坏，请联网重新获取。' :
    failed === 'offline-miss' || !online ? '当前无法联网，这篇文章未缓存。联网打开后即可保存离线副本。' : '无法加载这篇文章。'} <button type="button" onClick={() => {
    setFailed('');
    setAttempt(attempt + 1);
  }}>重试</button></div>;
  if (!article) return <p className="empty" role="status">正在加载正文…</p>;
  return <><OfflineArticle entry={entry} /><ReadingBody article={article} /></>;
}

