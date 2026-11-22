import { useEffect, useRef, useState } from 'react';
import { useOnline } from './offline-client';
import type { Sentence } from './core/content/types';

type State = 'idle' | 'playing' | 'paused' | 'error';
export function Speech({ sentences, onCurrent }: { sentences: Sentence[]; onCurrent: (id: string | null) => void }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [remote, setRemote] = useState(false);
  const [rate, setRate] = useState(1);
  const [status, setStatus] = useState<State>('idle');
  const [index, setIndex] = useState<number | null>(null);
  const generation = useRef(0);
  const indexRef = useRef<number | null>(null);
  const supported = typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function';
  const online = useOnline();
  const playingRemote = useRef(false);
  const allowed = voices.filter(voice => voice.localService || (remote && online));
  const selected = allowed.find(voice => voice.voiceURI === voiceId) ?? allowed[0];

  useEffect(() => {
    if (!supported) return;
    const engine = window.speechSynthesis;
    function update() {
      const english = engine.getVoices().filter(voice => /^en(?:-|_|$)/i.test(voice.lang));
      english.sort((a, b) => Number(b.localService) - Number(a.localService));
      setVoices(english);
    }
    update();
    engine.addEventListener('voiceschanged', update);
    return () => {
      generation.current++;
      engine.cancel();
      engine.removeEventListener('voiceschanged', update);
    };
  }, [supported]);

  useEffect(() => {
    if (!online && playingRemote.current) {
      generation.current++;
      window.speechSynthesis.cancel();
      playingRemote.current = false;
      indexRef.current = null;
      setIndex(null);
      setStatus('idle');
      onCurrent(null);
    }
  }, [online, onCurrent]);

  function stop() {
    playingRemote.current = false;
    generation.current++;
    window.speechSynthesis.cancel();
    indexRef.current = null;
    setIndex(null);
    setStatus('idle');
    onCurrent(null);
  }

  function play(start: number, entire: boolean) {
    if (!selected || (!selected.localService && !navigator.onLine)) return;
    playingRemote.current = !selected.localService;
    const engine = window.speechSynthesis;
    const currentGeneration = ++generation.current;
    engine.cancel();
    function speakAt(position: number) {
      if (generation.current !== currentGeneration || (playingRemote.current && !navigator.onLine)) return;
      indexRef.current = position;
      setIndex(position);
      setStatus('playing');
      onCurrent(sentences[position].id);
      const utterance = new SpeechSynthesisUtterance(sentences[position].text);
      utterance.lang = selected.lang;
      utterance.voice = selected;
      utterance.rate = rate;
      utterance.onend = () => {
        if (generation.current !== currentGeneration) return;
        if (entire && position + 1 < sentences.length) speakAt(position + 1);
        else { playingRemote.current = false; indexRef.current = null; setIndex(null); setStatus('idle'); onCurrent(null); }
      };
      utterance.onerror = () => {
        if (generation.current !== currentGeneration) return;
        playingRemote.current = false; indexRef.current = null; setIndex(null); setStatus('error'); onCurrent(null);
      };
      engine.speak(utterance);
    }
    speakAt(start);
  }

  function pauseResume() {
    if (status === 'playing') { window.speechSynthesis.pause(); setStatus('paused'); }
    else if (status === 'paused') { window.speechSynthesis.resume(); setStatus('playing'); }
  }

  if (!supported) return <div className="speech-controls" role="status">此浏览器不支持系统朗读，可继续阅读正文。</div>;
  return <div className="speech-controls" aria-label="英语朗读">
    {!selected && <p role="status">{!online ? '离线朗读需要可用的本地英语音色。' : voices.length && !remote ? '没有本地英语音色，可在下方选择允许可能联网的系统音色。' : '暂无可用英语音色，请检查设备语音设置。'}</p>}
    {online && voices.some(voice => !voice.localService) && <label><input type="checkbox" checked={remote} onChange={event => {
      if (status === 'playing' || status === 'paused') stop();
      setVoiceId('');
      setRemote(event.target.checked);
    }} />允许可能联网的系统音色</label>}
    {allowed.length > 0 && <label>英语音色<select aria-label="英语音色" value={selected.voiceURI} onChange={event => {
      if (status === 'playing' || status === 'paused') stop();
      setVoiceId(event.target.value);
    }}>{allowed.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}（{voice.localService ? '设备本地' : '可能联网'}）</option>)}</select></label>}
    <label>语速<select aria-label="语速" value={rate} onChange={event => {
      if (status === 'playing' || status === 'paused') stop();
      setRate(Number(event.target.value));
    }}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label>
    <div className="speech-buttons">
      <button type="button" onClick={() => play(0, true)} disabled={!selected}>全文朗读</button>
      <button type="button" onClick={pauseResume} disabled={status !== 'playing' && status !== 'paused'}>{status === 'paused' ? '继续' : '暂停'}</button>
      <button type="button" onClick={stop} disabled={status !== 'playing' && status !== 'paused'}>停止</button>
      <button type="button" onClick={() => play((indexRef.current ?? 0) - 1, false)} disabled={!selected || index === null || index === 0}>上一句</button>
      <button type="button" onClick={() => play((indexRef.current ?? -1) + 1, false)} disabled={!selected || index === null || index >= sentences.length - 1}>下一句</button>
    </div>
    <div className="speech-sentences" aria-label="单句朗读">
      {sentences.map((sentence, i) => <button key={sentence.id} type="button" className="speech-sentence-button"
        aria-label={`朗读第 ${i + 1} 句`} onClick={() => play(i, false)} disabled={!selected}>第 {i + 1} 句</button>)}
    </div>
    {status === 'error' && <p role="alert">系统朗读失败，请检查设备语音设置后重试。</p>}
    <span className="speech-state" role="status">{status === 'playing' ? `正在朗读第 ${(index ?? 0) + 1} 句` : status === 'paused' ? '朗读已暂停' : ''}</span>
  </div>;
}
