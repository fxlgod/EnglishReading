import { requireValid } from './contract.ts';
import { sameBinding, scoreAttempt } from './grammar-scoring.ts';
import type { ValidatedScoring } from './grammar-scoring.ts';
import { extensionPersonalStore as store, ExtensionStorageError } from './personal-store.ts';
import type { Attempt, Draft, PersonalRecords, ScoreBinding, WrongItem } from './personal-contract.ts';

type View = {draft:Draft;attempt?:Attempt;history:Attempt[];wrong:WrongItem[]};
type Scope = {source:Draft['source'];binding:ScoreBinding};
type Command =
  | {kind:'open'}
  | {kind:'edit';expected:Draft;inputs:Draft['inputs']}
  | {kind:'reveal';expected:Draft}
  | {kind:'restart';expected:Draft;reviewBlankIds?:string[]}
  | {kind:'submit';expected:Draft;bundle:ValidatedScoring};

export function actOnGrammar(scope:Scope,command:Command) {
  const now=Date.now();
  const candidateId=command.kind==='open'||command.kind==='restart'?crypto.randomUUID():undefined;
  return store.mutateGrammar<View>(scope.source,rows=>{
    let draft=rows.drafts[0];
    let attempts=rows.attempts;
    let wrong=rows.wrongItems;
    const changes:Partial<Pick<PersonalRecords,'drafts'|'attempts'|'wrongItems'>>={};
    const clock=(...times:string[])=>new Date(Math.max(now,...times.map(time=>Date.parse(time)+1))).toISOString();
    function fresh(reviewBlankIds?:string[]) {
      const time=clock(...(draft?[draft.updatedAt]:[]));
      return {source:scope.source,binding:scope.binding,attemptId:candidateId!,startedAt:time,updatedAt:time,
        revealed:false,inputs:[],...(reviewBlankIds&&{reviewBlankIds})};
    }
    function update(next:Draft) {draft=next;changes.drafts=[next];}
    function view(attempt=attempts.find(row=>row.attemptId===draft?.attemptId)) {
      if(!draft) throw new Error('未找到当前作答。');
      return {changes,value:{draft,attempt,history:[...attempts].sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt)),wrong}};
    }
    function conflict():never {throw new ExtensionStorageError('conflict','本次作答已在另一标签页变更。请重新打开试题，已提交成绩会保留。');}
    if (draft?.binding && !sameBinding(draft.binding,scope.binding)) {
      throw new ExtensionStorageError('conflict','同一版本的题目或答案哈希已改变。请保留原草稿并使用新版本题目。');
    }
    if (command.kind==='open') {
      if(!draft) update(fresh());
      else if(!draft.attemptId) update({...draft,attemptId:candidateId!,binding:scope.binding});
      return view();
    }
    const expected=command.expected;
    if (!draft || draft.attemptId!==expected.attemptId) return conflict();
    const committed=attempts.find(row=>row.attemptId===expected.attemptId);
    if(command.kind==='submit' && committed) {
      requireValid(committed.binding && sameBinding(committed.binding,scope.binding),'已保存成绩绑定不一致。');
      return view(committed);
    }
    if(command.kind==='restart') {
      const ids=command.reviewBlankIds;
      requireValid(!ids || (ids.length>0 && ids.every(id=>wrong.some(row=>row.blankId===id && row.state==='pending'))),
        '错题状态已改变，请重新打开试题。');
      update(fresh(ids));
      return view();
    }
    if(command.kind==='reveal') {
      if(!committed && !draft.revealed) update({...draft,revealed:true,updatedAt:clock(draft.updatedAt)});
      return view(committed);
    }
    if(committed || draft.updatedAt!==expected.updatedAt && command.kind==='edit') return conflict();
    if(command.kind==='edit') {
      update({...draft,updatedAt:clock(draft.updatedAt),inputs:command.inputs});
      return view();
    }
    if(draft.updatedAt!==expected.updatedAt || draft.revealed!==expected.revealed) return conflict();
    const attempt=scoreAttempt(command.bundle,draft,clock(draft.updatedAt));
    changes.attempts=[attempt];
    attempts=[...attempts,attempt];
    if(!attempt.revealed) {
      const byBlank=new Map(wrong.map(row=>[row.blankId,row]));
      const updates:WrongItem[]=[];
      for(const result of attempt.results) {
        const previous=byBlank.get(result.blankId);
        const time=previous?clock(attempt.submittedAt,previous.updatedAt):attempt.submittedAt;
        if(result.status!=='correct') updates.push({source:scope.source,blankId:result.blankId,attemptId:attempt.attemptId,state:'pending',updatedAt:time});
        else if(previous?.state==='pending') updates.push({...previous,state:'resolved',updatedAt:time});
      }
      for(const item of updates) byBlank.set(item.blankId,item);
      changes.wrongItems=updates;
      wrong=[...byBlank.values()];
    }
    return view(attempt);
  });
}
