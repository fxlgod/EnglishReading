import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Speech } from './Speech';
import type { SpeechSentence } from './Speech';
import { ReadingSettings } from './ReadingSettings';
import type { ReadingLayout, Sentence } from './core/content/types';
import { matchingPhrases } from './core/content/words';
import type { Span } from './core/content/words';
import './reader.css';

type Token = Sentence['tokens'][number];
type Phrase = Sentence['phrases'][number];
type Lookup = { token: Token; sentence: Sentence; trigger: HTMLButtonElement };
export type ReadingSelection = { sentence: Sentence; token: Token; phrase: Phrase | undefined };

type RenderText = (sentence: Sentence, renderWord: (token: Token) => ReactNode) => ReactNode;

type ReadingViewProps = {
  paragraphs: readonly { sentences: readonly Sentence[] }[];
  rootRef: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
  vocabulary: {
    isSaved: (selection: ReadingSelection) => boolean;
    toggle: (selection: ReadingSelection) => void;
  };
  projection?: {
    renderText: RenderText;
    speechSentences: readonly SpeechSentence[];
  };
  layout?: ReadingLayout;
  canLookup?: (sentence: Sentence, span: Span) => boolean;
  canTranslate?: (sentence: Sentence) => boolean;
};

function originalText(sentence: Sentence, renderWord: (token: Token) => ReactNode, renderSlice: (start:number,end:number)=>ReactNode) {
  let cursor = 0;
  return <>{sentence.tokens.map(token => {
    const gap = renderSlice(cursor, token.start);
    cursor = token.end;
    return <span key={token.start}>{gap}{renderWord(token)}</span>;
  })}{renderSlice(cursor, sentence.text.length)}</>;
}

function SentenceLine({ sentence, translated, toggle, select, lookup, renderText, canLookup, showTranslation, emphasis }: {
  sentence: Sentence; translated: boolean; toggle: () => void;
  select: (lookup: Lookup) => void; lookup: Lookup | null;
  renderText: RenderText | undefined;
  canLookup: ReadingViewProps['canLookup'];
  showTranslation: boolean;
  emphasis: ReadingLayout['emphasis'];
}) {
  const id = useId();
  function renderSlice(start:number,end:number): ReactNode {
    const spans=emphasis.filter(span=>span.start<end && span.end>start);
    if (!spans.length) return sentence.text.slice(start,end);
    let cursor=start;
    return <>{spans.map(span=>{
      const left=Math.max(start,span.start);
      const right=Math.min(end,span.end);
      const plain=sentence.text.slice(cursor,left);
      cursor=right;
      const Emphasis=span.tag;
      return <Fragment key={left}>{plain}<Emphasis>{sentence.text.slice(left,right)}</Emphasis></Fragment>;
    })}{sentence.text.slice(cursor,end)}</>;
  }
  function renderWord(token: Token) {
    if (canLookup && !canLookup(sentence, token)) return token.surface;
    return <button type="button" className="reader-word"
      aria-expanded={lookup?.token === token} onClick={event => select({ token, sentence, trigger: event.currentTarget })}
    >{renderSlice(token.start,token.end)}</button>;
  }
  return <span className="sentence-line">
    <span lang="en" className="sentence-text">{renderText ? renderText(sentence,renderWord) : originalText(sentence,renderWord,renderSlice)}</span>
    {showTranslation && <>
      <button type="button" className="sentence-toggle" aria-expanded={translated} aria-controls={id}
        aria-label={translated ? '收起句译' : '展开句译'} onClick={toggle}>译</button>
      <span className="sentence-translation" id={id} lang="zh-CN" hidden={!translated}>{sentence.translation_zh}</span>
    </>}
    {sentence.separator_after}
  </span>;
}

export function ReadingView({
  paragraphs, rootRef, children, vocabulary, projection, layout, canLookup, canTranslate,
}: ReadingViewProps) {
  const applySettings = useCallback((values: {fontSize:number; lineHeight:number; readingWidth:number; theme:'light'|'dark'|'system'}) => {
    const reader = rootRef.current;
    if (!reader) return;
    reader.style.setProperty('--reading-font-size', values.fontSize + 'px');
    reader.style.setProperty('--reading-line-height', String(values.lineHeight));
    reader.style.setProperty('--reading-width', values.readingWidth + 'ch');
    const app = reader.closest<HTMLElement>('.app');
    if (app && values.theme !== 'system') {
      app.dataset.theme = values.theme;
      window.dispatchEvent(new CustomEvent('reading-theme-change', {detail: values.theme}));
    }
  }, [rootRef]);
  const [translated, setTranslated] = useState(() => new Set<string>());
  const [selectedLookup, setLookup] = useState<Lookup | null>(null);
  const [meaning, setMeaning] = useState(0);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const headingId = useId();
  const sentences = paragraphs.flatMap(paragraph => paragraph.sentences);
  const translatable = canTranslate ? sentences.filter(canTranslate) : sentences;
  const allShown = translatable.every(sentence => translated.has(sentence.id));
  const lookup = selectedLookup && (!canLookup || canLookup(selectedLookup.sentence, selectedLookup.token)) ? selectedLookup : null;
  const phrases = lookup ? matchingPhrases(lookup.sentence.phrases, lookup.token)
    .filter(span => !canLookup || canLookup(lookup.sentence, span)) : [];
  const phrase = phrases[meaning];
  const selection = lookup && { sentence: lookup.sentence, token: lookup.token, phrase };
  const saved = selection && vocabulary.isSaved(selection);

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

  return <div className="reader" ref={rootRef}>
    {children}
    <ReadingSettings onChange={applySettings} />
    <Speech sentences={projection?.speechSentences ?? sentences} onCurrent={setSpeakingId} />
    {translatable.length > 0 && <button type="button" className="filter" aria-pressed={allShown}
      onClick={() => setTranslated(allShown ? new Set() : new Set(translatable.map(sentence => sentence.id)))}>全文译文</button>}
    <div className="reader-body" aria-label="文章正文">
      {paragraphs.map(({ sentences },index) => {
        const Block=layout?.blockquote.includes(index+1)?'blockquote':'p';
        const lines=sentences.map(sentence =>
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
          }} lookup={lookup} renderText={projection?.renderText} canLookup={canLookup}
          emphasis={layout?.emphasis.filter(span=>span.sentence_id===sentence.id) ?? []}
          showTranslation={!canTranslate || canTranslate(sentence)} /></span>);
        return <Fragment key={sentences[0].id}><Block>{lines}</Block>
          {layout?.breaks_after.includes(index+1) && <hr aria-label="分场线" />}
        </Fragment>;
      })}
    </div>
    {lookup && selection && <section ref={panel} className="lookup" role="dialog" aria-labelledby={headingId}>
      <div className="lookup-head">
        <h2 id={headingId} lang="en">{phrase ? phrase.surface : lookup.token.surface}</h2>
        <button type="button" ref={closeButton} aria-label="关闭词义" onClick={() => {
          setLookup(null);
          lookup.trigger.focus({ preventScroll: true });
        }}>×</button>
      </div>
      <p className="lookup-meta">{phrase ? '语境短语' : <><span lang="en">{lookup.token.lemma} · {lookup.token.pos}</span>{lookup.token.ipa && ' · ' + lookup.token.ipa}</>}</p>
      <p className="lookup-gloss" aria-live="polite">{phrase ? phrase.gloss_zh : lookup.token.gloss_zh}</p>
      <button type="button" onClick={() => vocabulary.toggle(selection)}>{saved ? '移出生词本' : '加入生词本'}</button>
      {phrases.length > 0 && <div className="lookup-options" role="group" aria-label="切换释义">
        {phrases.map((item, index) => <button key={item.start + ':' + item.end + ':' + index} type="button"
          aria-pressed={meaning === index} onClick={() => setMeaning(index)} lang="en">{item.surface}</button>)}
        <button type="button" aria-pressed={meaning === phrases.length} onClick={() => setMeaning(phrases.length)}>单词义</button>
      </div>}
    </section>}
  </div>;
}
