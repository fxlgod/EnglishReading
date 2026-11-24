import { useEffect, useMemo, useRef, useState } from 'react';
import { ReadingView } from './ReadingView';
import type { ReadingSelection } from './ReadingView';
import { createExtensionLoader, ExtensionContentError } from './core/extensions/load';
import type { GrammarExercise, GrammarPassage } from './core/extensions/contract';
import { actOnGrammar } from './core/extensions/grammar-session';
import { exactGrammarPolicy } from './core/extensions/grammar-policy';
import { sameBinding } from './core/extensions/grammar-scoring';
import { grammarProjection } from './core/extensions/grammar-projection';
import { extensionPersonalStore as store } from './core/extensions/personal-store';
import { personalKey } from './core/extensions/personal-contract';
import type { Attempt, Draft, ExtensionWord, ScoreBinding } from './core/extensions/personal-contract';
import { getTheme } from './theme';
import './grammar.css';

type Card = {exercise:GrammarExercise;draft?:Draft;latest?:Attempt;submitted:boolean};
type PageData={kind:'index';cards:Card[];offlineMisses:number;notice:string} | {kind:'exercise';exercise:GrammarExercise;passage:GrammarPassage;binding:ScoreBinding;session:Awaited<ReturnType<typeof actOnGrammar>>['value'];vocab:ExtensionWord[];notice:string};
const preview=import.meta.env.DEV;
const contentPath=preview?'tests/fixtures/grammar-preview/':'content/extensions/';
const openGrammar=()=>createExtensionLoader(new URL(import.meta.env.BASE_URL+contentPath,document.baseURI)).openGrammar();
function message(error:unknown) {
  if (error instanceof ExtensionContentError) {
    return {missing:preview?'找不到这套测试练习。':'暂无可用的语法填空练习。',withdrawn:'这套练习已撤回。',offline:'离线时无法打开这套练习。',
      unsupported:'当前版本无法打开这套练习。',invalid:preview?'测试练习数据校验失败。':'练习数据校验失败。',unavailable:'暂时无法加载练习。'}[error.code];
  }
  return error instanceof Error?error.message:'暂时无法打开练习。';
}
function statusNotice(status:Awaited<ReturnType<typeof store.save>>) {
  return status.mode==='temporary'?status.warning:'';
}

export default function GrammarPage({id}:{id:string|undefined}) {
  const [dark,setDark]=useState(false);
  useEffect(()=>{void getTheme().then(setDark);},[]);
  const [data,setData]=useState<PageData>();
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const mainRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    let active=true;
    async function load() {
      const grammar=await openGrammar();
      if (!id) {
        const {records,status}=await store.snapshot();
        const refs=grammar.manifest.entries.filter(ref=>ref.kind==='exercise');
        const exercises=await Promise.all(refs.map(async ref=>{
          try {
            const exercise=await grammar.loadCatalogueExercise(ref.id);
            const binding={exerciseSha256:ref.sha256,passageSha256:exercise.passage_ref.sha256,keySha256:exercise.key_ref.sha256};
            const matches=(row:Draft|Attempt)=>row.source.id===ref.id && row.source.revision===ref.revision &&
              (!row.binding || sameBinding(row.binding,binding));
            const draft=records.drafts.find(matches);
            const attempts=records.attempts.filter(matches).sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt));
            return {exercise,draft,latest:attempts[0],submitted:attempts.some(row=>row.attemptId===draft?.attemptId)};
          } catch (error) {
            if (error instanceof ExtensionContentError && error.code==='offline') return null;
            throw error;
          }
        }));
        const cards=exercises.filter(card=>card!==null);
        return {kind:'index',cards,offlineMisses:refs.length-cards.length,notice:statusNotice(status)} as const;
      }
      const exercise=await grammar.loadExercise(id);
      const passage=await grammar.loadPassage(id);
      const ref=grammar.manifest.entries.find(entry=>entry.kind==='exercise' && entry.id===id)!;
      const binding={exerciseSha256:ref.sha256,passageSha256:exercise.passage_ref.sha256,keySha256:exercise.key_ref.sha256};
      const source={kind:'exercise' as const,id,revision:exercise.revision};
      const {value:session,status}=await actOnGrammar({source,binding},{kind:'open'});
      const {records}=await store.snapshot();
      return {kind:'exercise',exercise,passage,binding,session,
        vocab:records.vocab.filter(row=>row.source.kind==='exercise' && row.source.id===id && row.source.revision===exercise.revision),
        notice:statusNotice(status)} as const;
    }
    void load().then(result=>{if(active)setData(result);},error=>{if(active)setError(message(error));});
    return ()=>{active=false;};
  },[id,retry]);
  return <div className="app grammar-preview" data-theme={dark?'dark':'light'}>
    <a className="skip" href="#grammar-main" onClick={event=>{event.preventDefault();mainRef.current?.focus();}}>跳到正文</a>
    <header className="header"><a href="#/" className="brand">EnglishReading</a>
      <nav aria-label="页面导航"><a href="#/grammar">语法填空</a><a href="#/library">分级书库</a></nav>
    </header>
    <main id="grammar-main" ref={mainRef} tabIndex={-1} className="library-main">
      {error?<div role="alert" className="empty">{error} <button type="button" onClick={()=>{setError('');setRetry(count=>count+1);}}>重试</button></div>:
        !data?<p role="status">正在加载练习…</p>:
        data.kind==='index'?<section className="section">{preview && <p className="kicker">开发预览 · 虚构夹具</p>}<h1>语法填空</h1>
          {data.notice && <p role="status">{data.notice}</p>}
          {data.offlineMisses>0 && <p role="status">离线时仅显示已保存的试题信息。联网后可查看完整目录。</p>}
          {data.cards.length>0 ? <div className="article-grid grammar-catalogue">{data.cards.map(({exercise,draft,latest,submitted})=>{
            const continuing=!!draft && !submitted && (draft.revealed || draft.inputs.some(item=>item.input.trim()) || !!latest);
            const action=continuing?'继续练习':submitted?'查看成绩':latest?'打开练习':'开始练习';
            return <article className="article-card" key={exercise.id}>
              <h2 lang="en">{exercise.title}</h2>
              <p>{exercise.blanks.length} 空 · {exercise.difficulty}</p>
              {exercise.knowledge_tags.length>0 && <p>考点：{exercise.knowledge_tags.slice(0,3).join('、')}</p>}
              <p>{continuing?'练习中':latest?'已完成':'未开始'}
                {latest && <> · {latest.revealed?'最近学习成绩':'最近无提示成绩'} {latest.score} / {latest.maxScore}</>}</p>
              <a className="primary" href={'#/grammar/'+exercise.id} aria-label={preview?'打开虚构测试练习':action+'：'+exercise.title}>{preview?'打开虚构测试练习':action}</a>
            </article>;
          })}</div>:!data.offlineMisses && <p className="empty">暂无可用练习。</p>}
        </section>:<Exercise data={data}/>}
    </main>
  </div>;
}

function Exercise({data}:{data:Extract<PageData,{kind:'exercise'}>}) {
  const {exercise,passage}=data;
  const rootRef=useRef<HTMLDivElement>(null);
  const [session,setSession]=useState(data.session);
  const [draft,setDraft]=useState(data.session.draft);
  const current=useRef(draft);
  const savedDraft=useRef(draft);
  const [study,setStudy]=useState(false);
  const [confirmation,setConfirmation]=useState<'study'|'restart'|'retry'|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState(data.notice);
  const [error,setError]=useState('');
  const [vocab,setVocab]=useState(data.vocab);
  const [historyId,setHistoryId]=useState('');
  const queue=useRef<Promise<void>>(Promise.resolve());
  const projection=useMemo(()=>grammarProjection(exercise,passage),[exercise,passage]);
  const answers=new Map(draft.inputs.map(item=>[item.blankId,item.input]));
  const scope={source:draft.source,binding:data.binding};
  const retryIds=session.wrong.filter(row=>row.state==='pending').map(row=>row.blankId);
  function updateDraft(next:Draft) {
    current.current=next;
    setDraft(next);
  }
  function show(result:Awaited<ReturnType<typeof actOnGrammar>>) {
    setSession(result.value);
    savedDraft.current=result.value.draft;
    setNotice(statusNotice(result.status));
    setError('');
  }
  function change(blankId:string,input:string) {
    const edits=new Map(current.current.inputs.map(row=>[row.blankId,row.input]));
    edits.set(blankId,input);
    const inputs=[...edits].map(([blankId,input])=>({blankId,input}));
    updateDraft({...current.current,inputs});
    queue.current=queue.current.then(async()=>{
      try {
        const result=await actOnGrammar(scope,{kind:'edit',expected:savedDraft.current,inputs});
        show(result);
        if(current.current.inputs===inputs) updateDraft(result.value.draft);
      } catch(error) {setError(message(error));}
    });
  }
  function afterQueue() {
    return queue.current.then(()=>{
      if(JSON.stringify(current.current.inputs)!==JSON.stringify(savedDraft.current.inputs)) {
        throw new Error('当前输入尚未保存。请重试编辑或复制输入后重新打开试题。');
      }
    });
  }
  async function confirm() {
    setBusy(true);
    try {
      await afterQueue();
      const expected=savedDraft.current;
      const result=await actOnGrammar(scope,confirmation==='study'?{kind:'reveal',expected}:
        {kind:'restart',expected,...(confirmation==='retry'&&{reviewBlankIds:retryIds})});
      show(result);
      updateDraft(result.value.draft);
      setStudy(confirmation==='study');
      setHistoryId('');
      setConfirmation(null);
    } catch(error) {setError(message(error));}
    finally {setBusy(false);}
  }
  async function submit() {
    setBusy(true);
    try {
      await afterQueue();
      const bundle=await (await openGrammar()).loadScoring(exercise.id);
      const result=await actOnGrammar(scope,{kind:'submit',expected:savedDraft.current,bundle});
      show(result);
      updateDraft(result.value.draft);
    } catch(error) {setError(message(error));}
    finally {setBusy(false);}
  }
  function wordRow({sentence,token,phrase}:ReadingSelection):ExtensionWord {
    const item=phrase??token;
    return {source:draft.source,sentenceId:sentence.id,kind:phrase?'phrase':'word',start:item.start,end:item.end,
      surface:item.surface,lemma:phrase?phrase.surface.toLowerCase():token.lemma,pos:phrase?'短语':token.pos,
      gloss:item.gloss_zh,sentence:study?sentence.text:projection.vocabularyContext(sentence),createdAt:new Date().toISOString()};
  }
  const vocabulary={
    isSaved:(selection:ReadingSelection)=>vocab.some(row=>personalKey(row)===personalKey(wordRow(selection))),
    toggle:async(selection:ReadingSelection)=>{
      const row=wordRow(selection);
      const key=personalKey(row);
      const saved=vocab.some(word=>personalKey(word)===key);
      try {
        const status=saved?await store.remove('vocab',row):await store.save({vocab:[row]});
        setVocab(previous=>[...previous.filter(word=>personalKey(word)!==key),...(saved?[]:[row])]);
        setNotice(statusNotice(status));
      } catch(error) {setError(message(error));}
    },
  };
  return <section className="section grammar-exercise">
    {preview && <p className="kicker">开发预览 · 虚构夹具</p>}
    <h1>{exercise.title}</h1>
    <section className="grammar-state" aria-labelledby="grammar-rules-title">
      <h2 id="grammar-rules-title">作答规则</h2>
      <p id="grammar-rules">{exactGrammarPolicy.instructions} {exactGrammarPolicy.matching}</p>
    </section>
    <p className="grammar-state" role="status">{study?'学习模式':session.attempt?'已交卷':'练习模式'}{draft.revealed?' · 本次已揭示原文，按学习记录':''}</p>
    {!study && !session.attempt && <p className="grammar-state">交卷后可查看答案。含空位的句译可在学习模式查看。</p>}
    {notice && <p className="empty" role="status">{notice}</p>}
    {error && <p className="empty" role="alert">{error}</p>}
    <div className="grammar-actions">
      {!study && !session.attempt && <button className="filter" type="button" aria-describedby="grammar-rules" onClick={()=>void submit()} disabled={busy||confirmation!==null}>交卷</button>}
      {study?<button className="filter" type="button" onClick={()=>setStudy(false)} disabled={busy||confirmation!==null}>返回练习模式</button>:
        <button className="filter" type="button" onClick={()=>setConfirmation('study')} disabled={busy||confirmation!==null}>查看原文与译文</button>}
      {retryIds.length>0 && <button className="filter" type="button" onClick={()=>setConfirmation('retry')} disabled={busy||confirmation!==null}>复练待巩固的错题</button>}
      <button className="filter" type="button" onClick={()=>setConfirmation('restart')} disabled={busy||confirmation!==null}>重新开始</button>
    </div>
    {confirmation && <div className="grammar-confirm">
      <p>{confirmation==='restart'?'清空本套输入并开始一次新的练习？':confirmation==='retry'?'开始一次独立的错题复练？历史成绩会保留。':'查看原文会显示空位答案。本次将标记为学习记录，已填写内容会保留。'}</p>
      <button type="button" className="filter" onClick={()=>void confirm()} disabled={busy}>{confirmation==='restart'?'确认清空并重新开始':confirmation==='retry'?'确认开始复练':'确认查看原文'}</button>
      <button type="button" className="filter" onClick={()=>setConfirmation(null)} disabled={busy}>取消</button>
    </div>}
    <ReadingView key={study?'study':'practice'} paragraphs={passage.paragraphs} rootRef={rootRef} vocabulary={vocabulary}
      canLookup={study?undefined:projection.canLookup} canTranslate={study?undefined:projection.canTranslate}
      projection={study?undefined:{speechSentences:projection.speechSentences,renderText:(sentence,renderWord)=>{
        let cursor=0;
        const pieces=projection.segments(sentence).map(segment=>{
          const gap=sentence.text.slice(cursor,segment.start);
          cursor=segment.end;
          if ('token' in segment) return <span key={segment.start}>{gap}{renderWord(segment.token)}</span>;
          const blank=segment.blank;
          if(draft.reviewBlankIds && !draft.reviewBlankIds.includes(blank.id)) return <span key={segment.start}>{gap}<span aria-label={`第 ${blank.order} 空不在本次复练范围`}>〔—〕</span></span>;
          const cue=projection.cue(blank);
          return <span key={segment.start}>{gap}<label className="grammar-blank">
            <span aria-hidden="true" className="grammar-number">{blank.order}</span>
            <input type="text" inputMode="text" autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={2048}
              aria-label={`第 ${blank.order} 空${cue?`，提示词：${cue}`:''}`} aria-describedby="grammar-rules" disabled={busy || !!session.attempt}
              value={answers.get(blank.id) ?? ''} onChange={event=>change(blank.id,event.currentTarget.value)}/>
            {cue && <span className="grammar-cue" aria-hidden="true">({cue})</span>}
          </label></span>;
        });
        return <>{pieces}{sentence.text.slice(cursor)}</>;
      }}}/>
    {session.attempt && <ScoreFeedback attempt={session.attempt} exercise={exercise}/>}
    {session.wrong.length>0 && <section className="grammar-results">
      <h2>错题记录</h2><ul>{session.wrong.map(row=><li key={row.blankId}>第 {exercise.blanks.find(blank=>blank.id===row.blankId)?.order??'—'} 空
        {' · '}{row.state==='resolved'?'已巩固':'待巩固'}
        {study && <button type="button" className="filter" onClick={()=>setHistoryId(row.attemptId)}>查看作答解析</button>}</li>)}</ul>
    </section>}
    {session.history.length>0 && <section className="grammar-results">
      <h2>本版本作答历史</h2><ul>{session.history.map(item=><li key={item.attemptId}>
        {category(item)} · {item.score}/{item.maxScore}
        {study && <button type="button" className="filter" onClick={()=>setHistoryId(item.attemptId)}>查看历史解析</button>}
      </li>)}</ul>
      {study && historyId && <ScoreFeedback attempt={session.history.find(item=>item.attemptId===historyId)!} exercise={exercise}/>}
    </section>}
  </section>;
}


function category(attempt:Attempt) {
  return attempt.revealed?'学习记录':attempt.reviewBlankIds?'错题复练':'无提示成绩';
}
function ScoreFeedback({attempt,exercise}:{attempt:Attempt;exercise:GrammarExercise}) {
  return <section className="grammar-results"><h2>作答反馈</h2>
    <p role="status">{category(attempt)} · {attempt.score} / {attempt.maxScore}</p>
    <ol>{attempt.results.map(result=><li key={result.blankId}>
      <h3>第 {exercise.blanks.find(blank=>blank.id===result.blankId)?.order??'—'} 空</h3>
      <p>{result.points}/{result.maxPoints} 分 · 你的填写：{result.input.trim()?result.input:'（空白）'}</p>
      {result.feedback && <><p>标准答案：{result.feedback.canonical}</p>
        {result.feedback.variants.length>0 && <p>可接受写法：{result.feedback.variants.join('、')}</p>}
        <p>{result.feedback.explanation}</p><p>知识点：{result.feedback.knowledgeTags.join('、')}</p></>}
    </li>)}</ol>
  </section>;
}
