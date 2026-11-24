import type { Sentence } from '../content/types.ts';
import type { Span } from '../content/words.ts';
import type { GrammarExercise, GrammarPassage } from './contract.ts';

type Blank = GrammarExercise['blanks'][number];
type Annotation = Span & { gloss_zh?:string; lemma?:string; pos?:string; ipa?:string };

function normalize(value:string) {
  return value.normalize('NFKC').toLowerCase().replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
}

export function grammarProjection(exercise:GrammarExercise,passage:GrammarPassage) {
  const sentences=passage.paragraphs.flatMap(p=>p.sentences);
  const byId=new Map(sentences.map(sentence=>[sentence.id,sentence]));
  const bySentence=new Map<string,Blank[]>();
  const answers=exercise.blanks.map(blank=>{
    const before=bySentence.get(blank.sentence_id) ?? [];
    bySentence.set(blank.sentence_id,[...before,blank]);
    return normalize(byId.get(blank.sentence_id)!.text.slice(blank.start,blank.end));
  });
  const wordChar=/[\p{Script=Latin}\p{N}\p{M}_]/u;
  function reveals(value:string) {
    const normalized=normalize(value);
    return answers.some(answer=>{
      for(let i=normalized.indexOf(answer);i>=0;i=normalized.indexOf(answer,i+1)) {
        const after=i+answer.length;
        if ((i===0 || !wordChar.test(normalized[i-1])) && (after===normalized.length || !wordChar.test(normalized[after]))) return true;
      }
      return false;
    });
  }
  const blanks=(sentence:Sentence)=>bySentence.get(sentence.id) ?? [];
  function project(sentence:Sentence,marker:(blank:Blank)=>string) {
    let end=0;
    const parts=blanks(sentence).map(blank=>{
      const gap=sentence.text.slice(end,blank.start);
      end=blank.end;
      return gap+marker(blank);
    });
    return parts.join('')+sentence.text.slice(end);
  }
  return {
    segments(sentence:Sentence) {
      const ranges=blanks(sentence);
      return [...sentence.tokens.filter(token=>!ranges.some(blank=>token.start<blank.end && token.end>blank.start))
        .map(token=>({start:token.start,end:token.end,token})),
      ...ranges.map(blank=>({start:blank.start,end:blank.end,blank}))].sort((a,b)=>a.start-b.start);
    },
    cue(blank:Blank) {return blank.cue && !reveals(blank.cue)?blank.cue:undefined;},
    canLookup(sentence:Sentence,span:Annotation) {
      return !blanks(sentence).some(blank=>span.start<blank.end && span.end>blank.start) &&
        ![span.surface,span.gloss_zh,span.lemma,span.pos,span.ipa].some(value=>value && reveals(value));
    },
    canTranslate(sentence:Sentence) {
      return blanks(sentence).length===0 && !reveals(sentence.translation_zh);
    },
    speechSentences:sentences.map(sentence=>({id:sentence.id,text:project(sentence,blank=>' blank '+blank.order+' ')})),
    vocabularyContext:(sentence:Sentence)=>project(sentence,blank=>'■'.repeat(blank.end-blank.start)),
  };
}
