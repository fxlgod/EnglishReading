import { useEffect, useRef, useState } from 'react';
import { OfflineArticle } from './Offline';
import { useOnline } from './offline-client';
import { ReadingView } from './ReadingView';
import type { ReadingSelection } from './ReadingView';
import { all, put, remove, isTemporary } from './storage';
import type { Vocab, Favorite } from './storage';
import { createContentLoader } from './core/content/load';
import type { Article, Entry } from './core/content/types';
import { words } from './core/content/words';

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

function vocabularyId(articleId: string, { sentence, token, phrase }: ReadingSelection) {
  const span = phrase ?? token;
  return JSON.stringify([articleId, sentence.id, phrase ? 'phrase' : 'word', span.start, span.end]);
}

function ArticleReading({ article }: { article: Article }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [savedWords, setSavedWords] = useState<Vocab[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [temporary, setTemporary] = useState(false);
  const [resumeNotice, setResumeNotice] = useState('');
  const [completed, setCompleted] = useState(false);
  const [savingCompleted, setSavingCompleted] = useState(false);
  const completedRef = useRef(false);
  const lastSentence = useRef('');

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
      if (!active || !rootRef.current) return;
      const saved = items.find(item => item.articleId === article.id);
      const candidates = [...rootRef.current.querySelectorAll<HTMLElement>('[data-sentence-id]')];
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
  const favorite = favorites.some(item => item.articleId === article.id);

  function isSaved(selection: ReadingSelection) {
    return savedWords.some(item => item.id === vocabularyId(article.id, selection));
  }
  function toggleVocabulary(selection: ReadingSelection) {
    const id = vocabularyId(article.id, selection);
    if (isSaved(selection)) {
      void remove('vocab', id);
      return;
    }
    const { sentence, token, phrase } = selection;
    void put('vocab', {
      id, lemma: phrase ? phrase.surface.toLowerCase() : token.lemma,
      surface: phrase ? phrase.surface : token.surface,
      pos: phrase ? '短语' : token.pos, gloss: phrase ? phrase.gloss_zh : token.gloss_zh,
      articleId: article.id, sentenceId: sentence.id,
      phraseSpan: phrase ? [phrase.start, phrase.end] : null,
      sentence: sentence.text, createdAt: new Date().toISOString(),
    });
  }

  return <ReadingView paragraphs={article.paragraphs} rootRef={rootRef} vocabulary={{isSaved, toggle: toggleVocabulary}}>
    {temporary && <p role="alert">本机存储不可用，当前仅为临时记录，关闭页面后可能丢失。请检查浏览器存储设置。</p>}
    {resumeNotice && <p role="status">{resumeNotice}</p>}
    <div className="reader-actions"><button type="button" className="filter" onClick={() => { void (favorite ? remove('favorites', article.id) : put('favorites', {articleId: article.id, createdAt: new Date().toISOString()})); }}>{favorite ? '取消收藏文章' : '收藏文章'}</button>
    <button type="button" className="filter" disabled={savingCompleted} onClick={async () => {
      const next = !completed;
      completedRef.current = next;
      setSavingCompleted(true);
      try {
        await put('progress', {articleId: article.id, revision: article.revision, sentenceId: lastSentence.current || article.paragraphs[0].sentences[0].id, completed: next, updatedAt: new Date().toISOString()});
        setCompleted(next);
      } finally { setSavingCompleted(false); }
    }}>{completed ? '取消标记已读' : '标记已读'}</button></div>
  </ReadingView>;
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
  return <><OfflineArticle entry={entry} /><ArticleReading article={article} /></>;
}
