import { requireValid, validateExercise } from './contract.ts';
import { exactGrammarPolicy } from './grammar-policy.ts';
import type { GrammarExercise, GrammarPassage, GrammarKey } from './contract.ts';
import type { Attempt, Draft, ScoreBinding } from './personal-contract.ts';

export type ValidatedScoring = {exercise:GrammarExercise;passage:GrammarPassage;key:GrammarKey;binding:ScoreBinding};
export function sameBinding(a:ScoreBinding,b:ScoreBinding) {
  return a.exerciseSha256===b.exerciseSha256 && a.passageSha256===b.passageSha256 && a.keySha256===b.keySha256;
}
const exact = exactGrammarPolicy.normalize;

export function scoreAttempt(bundle:ValidatedScoring,draft:Draft,at:string):Attempt {
  const {exercise,passage,key,binding}=bundle;
  requireValid(draft.attemptId && draft.binding && sameBinding(draft.binding,binding) &&
    draft.source.id===exercise.id && draft.source.revision===exercise.revision &&
    exercise.score_policy_id===exactGrammarPolicy.id && passage.id===exercise.passage_ref.id && passage.revision===exercise.passage_ref.revision &&
    key.id===exercise.key_ref.id && key.revision===exercise.key_ref.revision &&
    binding.passageSha256===exercise.passage_ref.sha256 && binding.keySha256===exercise.key_ref.sha256,
    '题目、正文或答案版本不一致，无法评分。请保留草稿并重新打开试题。');
  validateExercise(exercise,passage,key);
  const answers=new Map(key.answers.map(record=>[record.blank_id,record]));
  const known=new Set(exercise.blanks.map(blank=>blank.id));
  const selected=draft.reviewBlankIds;
  const scope=new Set(selected ?? known);
  requireValid(scope.size>0 && (!selected || selected.length===scope.size) &&
    [...scope].every(id=>known.has(id)), '复练范围与当前题目不一致。');
  const inputs=new Map(draft.inputs.map(row=>[row.blankId,row.input]));
  requireValid(inputs.size===draft.inputs.length && [...inputs.keys()].every(id=>scope.has(id)), '草稿包含未知或重复空位。');
  const results:Attempt['results']=exercise.blanks.filter(blank=>scope.has(blank.id)).map(blank=>{
    const answer=answers.get(blank.id)!;
    const input=inputs.get(blank.id) ?? '';
    const normalized=exact(input);
    const correct=normalized!=='' && [answer.canonical_answer,...answer.accepted_variants].some(value=>exact(value)===normalized);
    return {blankId:blank.id,input,status:normalized===''?'unanswered':correct?'correct':'incorrect',
      points:correct?blank.points:0,maxPoints:blank.points,feedback:{canonical:answer.canonical_answer,
        variants:[...answer.accepted_variants],explanation:answer.explanation_zh,knowledgeTags:[...answer.knowledge_tags]}};
  });
  return {source:draft.source,attemptId:draft.attemptId,startedAt:draft.startedAt,submittedAt:at,
    revealed:draft.revealed,scorePolicyId:exercise.score_policy_id,binding,
    ...(selected && {reviewBlankIds:[...selected]}),
    score:results.reduce((sum,item)=>sum+item.points,0),maxScore:results.reduce((sum,item)=>sum+item.maxPoints,0),results};
}
