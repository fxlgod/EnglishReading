/**
 * Lightweight Syntax & Semantic Preflight Checker
 *
 * Non-destructive: read-only analysis of candidate.json or draft.json + annotations.json.
 * Scans high-risk grammatical, lexical, and translation patterns:
 * 1. Contraction lemma completeness & grammatical expansion (aren't, don't, sleeping's, you'll, etc.)
 * 2. Semantic bleeding / gloss scope (you'll absorbing never/have to; did absorbing not; etc.)
 * 3. Existential 'there' vs locative adverb glossing (distinguishing relative clauses like "observed there were").
 * 4. Dummy/formal/situational 'it' vs literal '它' / '它是'.
 * 5. Relative pronoun 'that' vs demonstrative '那是' / '那个'.
 * 6. Phrasal verb & collocation token glossing (give up, cope with, make it, be going to vs physical going to).
 * 7. Perfect aspect auxiliary have/has/had vs lexical possession/formerly.
 * 8. Auxiliary vs linking verb tagging (be + V-ing).
 * 9. Double negation in translation (为什么不别, etc.).
 * 10. Over-translation or unfaithful additions flagged in reviews.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function normalizeQuote(str) {
  return (str || '').replace(/[’‘`]/gu, "'").replace(/[“”]/gu, '"');
}

// Known irregular past participles
const IRREGULAR_PAST_PARTICIPLES = new Set([
  'been', 'seen', 'gone', 'done', 'come', 'taken', 'written', 'given', 'known', 'grown',
  'blown', 'flown', 'eaten', 'fallen', 'broken', 'spoken', 'chosen', 'frozen', 'stolen',
  'forgotten', 'hidden', 'bitten', 'ridden', 'driven', 'risen', 'beaten', 'born', 'torn',
  'worn', 'sworn', 'lost', 'found', 'made', 'had', 'met', 'felt', 'left', 'kept',
  'slept', 'swept', 'wept', 'crept', 'built', 'sent', 'spent', 'lent', 'meant', 'heard',
  'read', 'said', 'told', 'sold', 'held', 'stood', 'understood', 'won', 'spun', 'run',
  'become', 'bought', 'brought', 'thought', 'caught', 'taught', 'fought', 'sought',
  'struck', 'hung', 'swung', 'dug', 'stuck', 'shot', 'cut', 'put', 'set', 'hit', 'hurt',
  'let', 'cost', 'shut', 'spread', 'split'
]);

function isPastParticiple(tok) {
  if (!tok) return false;
  const s = normalizeQuote(tok.surface).toLowerCase();
  const pos = tok.pos || '';
  if (pos.includes('过去分词') || pos.includes('分词')) return true;
  if (IRREGULAR_PAST_PARTICIPLES.has(s)) return true;
  if (s.endsWith('ed') && s.length > 3) {
    const nonVerbs = new Set(['hundred', 'bed', 'red', 'shed', 'feed', 'need', 'speed', 'seed', 'bleed', 'breed', 'weed', 'greed']);
    if (!nonVerbs.has(s)) return true;
  }
  return false;
}

export function checkArticleCandidate(candidateData, articleId = 'unknown') {
  const issues = [];
  const article = candidateData.candidate || candidateData;
  const paragraphs = article.paragraphs || [];

  let totalSentences = 0;
  let totalTokens = 0;

  // Check summary_zh if present
  const summaryZh = article.summary_zh || '';
  if (summaryZh) {
    if (summaryZh.includes('全球密度最高')) {
      issues.push({
        level: 'A',
        scope: 'summary_zh',
        rule: 'unevidenced_claim',
        detail: '规则疑点：summary_zh 包含未证实陈述“全球密度最高”。'
      });
    }
    if (articleId.includes('walking-together')) {
      if (summaryZh.includes('母女') && summaryZh.includes('入睡')) {
        issues.push({
          level: 'A',
          scope: 'summary_zh',
          rule: 'walking_together_summary_sleep',
          detail: '规则疑点：summary_zh 提及母女两人入睡，正文仅向女儿道晚安就寝。'
        });
      }
      if (summaryZh.includes('手牵手一同回家') || (summaryZh.includes('牵手') && summaryZh.includes('回家'))) {
        issues.push({
          level: 'A',
          scope: 'summary_zh',
          rule: 'walking_together_summary_hand_holding',
          detail: '规则疑点：summary_zh 将牵手安抚错置于回家途中而非检查前。'
        });
      }
    }
    if (articleId.includes('zama-great')) {
      if (summaryZh.includes('照顾赖床的弟弟')) {
        issues.push({
          level: 'B',
          scope: 'summary_zh',
          rule: 'zama_summary_brother',
          detail: '风险提示：summary_zh“照顾赖床的弟弟”过于泛化，正文仅提及弟弟晚睡及分享学校消息。'
        });
      }
    }
  }

  for (const para of paragraphs) {
    for (const sent of (para.sentences || [])) {
      totalSentences++;
      const sId = sent.id;
      const sTrans = sent.translation_zh || '';
      const tokens = sent.tokens || [];

      // 1. Check double negation in Chinese translation
      if (/为什么不别|怎么不别|为何不别/u.test(sTrans)) {
        issues.push({
          level: 'A',
          sentenceId: sId,
          rule: 'translation_double_negative',
          detail: `规则疑点：译文出现双重否定相叠：“${sTrans.match(/为什么不别|怎么不别|为何不别/u)[0]}”。`
        });
      }

      // 2. Check specific known review issues in translation
      if (articleId.includes('walking-together')) {
        if (sId === 's6' && sTrans.includes('遮阳')) {
          issues.push({
            level: 'A',
            sentenceId: sId,
            rule: 'unfaithful_translation_addition',
            detail: '规则疑点：S6 句译增加“遮阳”，英文原文仅谈避雨（keep your face dry）。'
          });
        }
        if (sId === 's21' && sTrans.includes('医生阿姨')) {
          issues.push({
            level: 'A',
            sentenceId: sId,
            rule: 'unfaithful_role_addition',
            detail: '规则疑点：S21 句译将代词 she 译为“医生阿姨”，图文角色为诊所护士。'
          });
        }
        if (sId === 's22' && (sTrans.includes('开好药') || sTrans.includes('开药'))) {
          issues.push({
            level: 'A',
            sentenceId: sId,
            rule: 'unfaithful_medical_action',
            detail: '规则疑点：S22 句译使用“开好药”，原文为实际取药/给药（give us our medicine）。'
          });
        }
      }

      if (articleId.includes('zama-great')) {
        if (sId === 's5' && sTrans.includes('洗脸') && !sTrans.includes('洗漱')) {
          issues.push({
            level: 'A',
            sentenceId: sId,
            rule: 'narrowed_translation',
            detail: '规则疑点：S5 wash myself 限定为“洗脸”而非中性“洗漱”。'
          });
        }
      }

      if (articleId.includes('hippo-wants-dance')) {
        if (sId === 's11' && sTrans.includes('全身')) {
          issues.push({
            level: 'A',
            sentenceId: sId,
            rule: 'exaggerated_translation',
            detail: '规则疑点：S11 句译增加“全身都”，夸大 making me wet 的范围。'
          });
        }
        if (sId === 's32' && sTrans.includes('抽泣')) {
          issues.push({
            level: 'A',
            sentenceId: sId,
            rule: 'unfaithful_sound_translation',
            detail: '规则疑点：S32 句译将泪珠落下声音写为“抽泣声”，与原文泪落及拟声词铺垫不一致。'
          });
        }
      }

      // Check tokens
      for (let i = 0; i < tokens.length; i++) {
        totalTokens++;
        const t = tokens[i];
        const surface = t.surface || '';
        const normSurface = normalizeQuote(surface).toLowerCase();
        const lemma = t.lemma || '';
        const normLemma = normalizeQuote(lemma).toLowerCase();
        const pos = t.pos || '';
        const gloss = t.gloss_zh || '';

        // Rule A: Contraction lemma completeness
        if (normSurface.endsWith("n't")) {
          if (!normLemma.includes('not')) {
            issues.push({
              level: 'A',
              sentenceId: sId,
              tokenIndex: i,
              surface,
              rule: 'contraction_lemma_missing_not',
              detail: `规则疑点：缩写词元“${surface}”的 lemma“${lemma}”遗漏否定成分“not”。`
            });
          }
        }
        if (normSurface.endsWith("'ll")) {
          if (!normLemma.includes('will') && !normLemma.includes('shall')) {
            issues.push({
              level: 'A',
              sentenceId: sId,
              tokenIndex: i,
              surface,
              rule: 'contraction_lemma_missing_will',
              detail: `规则疑点：缩写词元“${surface}”的 lemma“${lemma}”遗漏“will”。`
            });
          }
          if (/决不|永不|绝不|必须|不得不/u.test(gloss)) {
            issues.push({
              level: 'A',
              sentenceId: sId,
              tokenIndex: i,
              surface,
              rule: 'contraction_gloss_semantic_bleeding',
              detail: `规则疑点：缩写词元“${surface}”释义“${gloss}”错误吸收后文否定词或情态动词含义。`
            });
          }
        }
        if (normSurface.endsWith("'re")) {
          if (!normLemma.includes('be') && !normLemma.includes('are')) {
            issues.push({
              level: 'A',
              sentenceId: sId,
              tokenIndex: i,
              surface,
              rule: 'contraction_lemma_missing_be',
              detail: `规则疑点：缩写词元“${surface}”的 lemma“${lemma}”遗漏“be/are”。`
            });
          }
        }
        if (normSurface.endsWith("'ve")) {
          if (!normLemma.includes('have')) {
            issues.push({
              level: 'A',
              sentenceId: sId,
              tokenIndex: i,
              surface,
              rule: 'contraction_lemma_missing_have',
              detail: `规则疑点：缩写词元“${surface}”的 lemma“${lemma}”遗漏“have”。`
            });
          }
        }

        // Rule B: 's contractions
        if (normSurface.endsWith("'s")) {
          if (['that\'s', 'it\'s', 'what\'s', 'there\'s', 'here\'s', 'who\'s', 'sleeping\'s', 'giraffe\'s'].includes(normSurface)) {
            if (!normLemma.includes('be') && !normLemma.includes('is') && !normLemma.includes('has')) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'contraction_lemma_missing_is_has',
                detail: `规则疑点：缩写词元“${surface}”的 lemma“${lemma}”应包含“be/is”或“has”。`
              });
            }
          }
        }

        // Rule C: 'there' existential vs locative
        if (normSurface === 'there') {
          const nextToken = tokens[i + 1];
          const nextNorm = nextToken ? normalizeQuote(nextToken.surface).toLowerCase() : '';
          const isExistentialVerb = ['is', 'are', 'was', 'were', "'s", 'lived', 'came', 'stands', 'stood', 'remains'].includes(nextNorm);

          if (isExistentialVerb) {
            // Check syntactic context: Is 'there' really the existential subject or a locative adverb?
            // Context 1: Preceded by subject + transitive verb in relative clause (e.g. "they observed there were young")
            const prevTok1 = i > 0 ? tokens[i - 1] : null;
            const prevTok2 = i > 1 ? tokens[i - 2] : null;
            const prevPos1 = prevTok1?.pos || '';
            const prevPos2 = prevTok2?.pos || '';
            const isPrecededBySubjVerb = prevTok1 && (prevPos1.includes('动词') || prevPos1.includes('verb')) &&
              prevTok2 && (prevPos2.includes('代词') || prevPos2.includes('名词') || prevPos2.includes('pronoun') || prevPos2.includes('noun'));

            // Context 2: What follows the verb? In existential sentences, a logical subject noun phrase follows.
            // If the verb is followed by a predicate adjective ending the clause (e.g. "were young."), it's NOT an existential sentence.
            const afterVerb = tokens[i + 2];
            const afterVerbPos = afterVerb?.pos || '';
            const isEndPredicateAdj = afterVerb && (afterVerbPos.includes('形容词') || afterVerbPos.includes('adjective')) &&
              (i + 3 >= tokens.length || ['.', '!', '?'].includes(tokens[i + 3]?.surface));

            if (!isPrecededBySubjVerb && !isEndPredicateAdj) {
              if (/^(那里|在那儿|在彼处|那里有)$/u.test(gloss.trim()) || (gloss.includes('那里') && !gloss.includes('引导') && !gloss.includes('存现') && !gloss.includes('存在'))) {
                issues.push({
                  level: 'A',
                  sentenceId: sId,
                  tokenIndex: i,
                  surface,
                  rule: 'existential_there_locative_error',
                  detail: `规则疑点：存在句“there ${nextNorm}”中的引导词 there 机械释为地点副词“${gloss}”。`
                });
              }
            }
          }
        }

        // Rule D: Dummy / formal / situational 'it' / 'it's'
        if (normSurface === "it's" || normSurface === 'it') {
          const hasInfinitiveLater = tokens.slice(i + 1).some(tok => normalizeQuote(tok.surface).toLowerCase() === 'to');
          const subsequentWords = tokens.slice(i + 1, i + 4).map(tok => normalizeQuote(tok.surface).toLowerCase());
          const hasTimeOrAdj = subsequentWords.some(w => ['time', 'late', 'dark', 'okay', 'fine', 'good', 'bedtime'].includes(w));
          if (hasInfinitiveLater || hasTimeOrAdj) {
            if (/^它是|^它$/u.test(gloss.trim()) || gloss.startsWith('它是；') || gloss.startsWith('它是，') || gloss.startsWith('这是；') || gloss.startsWith('这是，')) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'dummy_it_literal_error',
                detail: `规则疑点：形式主语/情境代词“${surface}”字面释为“${gloss}”。`
              });
            }
          }
        }

        // Rule E: Relative pronoun 'that' / 'that's'
        if (normSurface === 'that' || normSurface === "that's") {
          if (i > 0) {
            const prevToken = tokens[i - 1];
            const prevNorm = normalizeQuote(prevToken.surface).toLowerCase();
            const prevPos = prevToken.pos || '';
            const isFollowedByVerb = tokens[i + 1] && ['verb', 'auxiliary', 'linking_verb'].includes(tokens[i + 1].pos);
            const isPrecededByNoun = ['something', 'anything', 'everything', 'hat', 'shoes', 'friend', 'dog', 'place'].includes(prevNorm) || prevPos.includes('noun') || prevPos.includes('pronoun');
            if (isPrecededByNoun && (normSurface === "that's" || isFollowedByVerb)) {
              if (/^那个|^那是/u.test(gloss.trim()) || gloss.startsWith('那是；') || gloss.startsWith('那是，') || gloss.startsWith('那个；')) {
                issues.push({
                  level: 'A',
                  sentenceId: sId,
                  tokenIndex: i,
                  surface,
                  rule: 'relative_that_demonstrative_error',
                  detail: `规则疑点：先行词“${prevNorm}”后的关系代词“${surface}”误标为指示代词“${gloss}”。`
                });
              }
            }
          }
        }

        // Rule F: Phrasal verbs & collocations
        // 1. give up
        if (normSurface === 'give') {
          const nextTok = tokens[i + 1];
          if (nextTok && normalizeQuote(nextTok.surface).toLowerCase() === 'up') {
            if (/^给[，,、；;]?$|^给予[，,、；;]?$/u.test(gloss.trim()) || gloss.startsWith('给；') || gloss.startsWith('给，') || gloss.startsWith('给予；')) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'phrasal_give_up_give_literal',
                detail: `规则疑点：短语 give up 中的 give 仍保留独立给予动作释义“${gloss}”。`
              });
            }
          }
        }
        if (normSurface === 'up') {
          const prevTok = tokens[i - 1];
          if (prevTok && normalizeQuote(prevTok.surface).toLowerCase() === 'give') {
            if (/^向上|^往上/u.test(gloss.trim()) || gloss.startsWith('向上；') || gloss.startsWith('向上，') || gloss.startsWith('往上；')) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'phrasal_give_up_up_literal',
                detail: `规则疑点：短语 give up 中的 up 仍保留独立方向释义“${gloss}”。`
              });
            }
          }
        }

        // 2. cope with
        if (normSurface === 'with') {
          const prevTok = tokens[i - 1];
          if (prevTok && normalizeQuote(prevTok.surface).toLowerCase() === 'cope') {
            if (/与.*一起|和.*一起|伴随/u.test(gloss.trim())) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'phrasal_cope_with_comitative_error',
                detail: `规则疑点：搭配 cope with 中的介词 with 误标伴随义“与……一起”。`
              });
            }
          }
        }

        // 3. be going to vs going to [destination]
        if (normSurface === 'going') {
          const nextTok = tokens[i + 1];
          const nextNorm = nextTok ? normalizeQuote(nextTok.surface).toLowerCase() : '';
          const afterTo = tokens[i + 2];
          const afterToNorm = afterTo ? normalizeQuote(afterTo.surface).toLowerCase() : '';
          const afterToPos = afterTo?.pos || '';
          const toPos = nextTok?.pos || '';

          // Check if 'to' is a destination preposition introducing a noun phrase:
          // e.g. "going to the big city", "going to school", "going to bed"
          const isDestinationPreposition = toPos.includes('介词') ||
            ['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their'].includes(afterToNorm) ||
            (afterToPos.includes('名词') && !afterToPos.includes('动词'));

          const precedingWords = tokens.slice(Math.max(0, i - 3), i).map(tok => normalizeQuote(tok.surface).toLowerCase());
          const hasBePreceding = precedingWords.some(w => ['am', 'is', 'are', 'was', 'were', "'m", "'s", "'re", 'be', 'been'].includes(w) || w.endsWith("'m") || w.endsWith("'s") || w.endsWith("'re"));

          // Only flag if it is NOT a destination prepositional phrase, but an infinitive structure
          if (hasBePreceding && nextNorm === 'to' && !isDestinationPreposition) {
            if (/^去[，,、；;\s]?$|^前往|^行走/u.test(gloss.trim()) || gloss.startsWith('去；') || gloss.startsWith('去，')) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'be_going_to_literal_movement',
                detail: `规则疑点：将来表达结构 be going to 中的 going 误标为位移动作“${gloss}”。`
              });
            }
          }
        }

        // 4. make it
        if (normSurface === 'make' || normSurface === 'made') {
          const nextTok = tokens[i + 1];
          if (nextTok && normalizeQuote(nextTok.surface).toLowerCase() === 'it') {
            if (/到达/u.test(gloss.trim()) && !gloss.includes('make it')) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'make_it_make_overreach',
                detail: `规则疑点：固定短语 make it 中的 ${surface} 应将完整到达含义留给短语。`
              });
            }
          }
        }
        if (normSurface === 'it') {
          const prevTok = tokens[i - 1];
          if (prevTok && ['make', 'made'].includes(normalizeQuote(prevTok.surface).toLowerCase())) {
            if (/目标|到达目标/u.test(gloss.trim())) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'make_it_it_independent_gloss',
                detail: `规则疑点：固定习语 make it 中的 it 被赋予独立词义“${gloss}”。`
              });
            }
          }
        }

        // 5. come to [verb]
        if (normSurface === 'to') {
          const prevTok = tokens[i - 1];
          if (prevTok && ['come', 'came', 'comes'].includes(normalizeQuote(prevTok.surface).toLowerCase())) {
            if (/^来[，,、；;\s]?$/u.test(gloss.trim()) || gloss.startsWith('来；') || gloss.startsWith('来，')) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'come_to_to_glossed_as_come',
                detail: `规则疑点：不定式标记 to 误标为“来”（动作义归属于 come）。`
              });
            }
          }
        }

        // Rule G: do/did/does auxiliary followed by not
        if (['do', 'did', 'does'].includes(normSurface)) {
          const nextTok = tokens[i + 1];
          if (nextTok && normalizeQuote(nextTok.surface).toLowerCase() === 'not') {
            // Flag if the gloss assigns the negative meaning (不, 没, 没有, 并未) to do/did/does itself
            // e.g. "不（过去时助动词）", "不；助动词", "没有", "不"
            const assignsNegation = /(^|[；;\s])(不|没|没有|并未)([（\(；;\s]|$)/u.test(gloss.trim());
            if (assignsNegation) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'do_did_not_negation_bleeding',
                detail: `规则疑点：助动词“${surface}”错误吸收后续 not 的独立否定义“${gloss}”。`
              });
            }
          }
        }

        // Rule H: Perfect aspect auxiliary have/has/had
        if (['have', 'has', 'had'].includes(normSurface)) {
          // Look for past participle in the subsequent 1 to 3 tokens (e.g. "have seen", "Have you seen", "have never seen")
          let hasParticiple = false;
          let participleToken = null;
          for (let k = i + 1; k < Math.min(i + 4, tokens.length); k++) {
            if (isPastParticiple(tokens[k])) {
              hasParticiple = true;
              participleToken = tokens[k];
              break;
            }
          }

          if (hasParticiple) {
            // Check if gloss assigns conflicting independent meaning like "曾经" or lexical possession "拥有/吃/喝"
            const glossTrim = gloss.trim();
            const hasCengJing = glossTrim.includes('曾经') && !glossTrim.includes('助动词') && !glossTrim.includes('完成时');
            const isLexicalPossession = /^(拥有|具有|持有|吃|喝)$/u.test(glossTrim) ||
              (glossTrim.includes('拥有') && !glossTrim.includes('助动词') && !glossTrim.includes('完成时'));
            const isBareYou = glossTrim === '有';

            if (hasCengJing || isLexicalPossession || isBareYou) {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'perfect_have_auxiliary_error',
                detail: `规则疑点：完成时助动词“${surface}”（后续分词 ${participleToken.surface}）被误释为独立实义“${gloss}”。`
              });
            }
          }
        }

        // Rule I: be + V-ing auxiliary tagging
        if (['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being'].includes(normSurface)) {
          const nextTok = tokens[i + 1];
          if (nextTok && normalizeQuote(nextTok.surface).toLowerCase().endsWith('ing') && !['during', 'spring', 'ring', 'king', 'wing', 'thing', 'morning', 'evening'].includes(normalizeQuote(nextTok.surface).toLowerCase())) {
            if (pos === 'linking_verb' || pos === 'verb' || pos === '系动词') {
              issues.push({
                level: 'A',
                sentenceId: sId,
                tokenIndex: i,
                surface,
                rule: 'be_continuous_pos_error',
                detail: `规则疑点：进行时结构中的“${surface}”词性应为“助动词”，当前标记为“${pos}”。`
              });
            }
          }
        }
      }
    }
  }

  return {
    articleId,
    totalSentences,
    totalTokens,
    issues,
    hasBlockers: issues.some(i => i.level === 'A')
  };
}

export async function preflightArticle(batchDir, itemId) {
  const prefix = `${itemId}.1`;
  const candPath = join(batchDir, `${prefix}.candidate.json`);
  const draftPath = join(batchDir, `${prefix}.draft.json`);
  const annotPath = join(batchDir, `${prefix}.annotations.json`);

  let data = null;
  if (existsSync(candPath)) {
    data = JSON.parse(await readFile(candPath, 'utf8'));
  } else if (existsSync(draftPath) && existsSync(annotPath)) {
    const draft = JSON.parse(await readFile(draftPath, 'utf8'));
    const annotations = JSON.parse(await readFile(annotPath, 'utf8'));
    let idx = 0;
    const paragraphs = (draft.paragraphs || []).map(p => ({
      sentences: (p.sentences || []).map(s => {
        const row = annotations.sentences[idx++];
        return {
          id: s.id,
          text: s.text,
          translation_zh: row?.translation_zh || '',
          tokens: row?.tokens || [],
          phrases: row?.phrases || []
        };
      })
    }));
    data = { candidate: { ...draft, paragraphs } };
  } else {
    return {
      articleId: itemId,
      skipped: true,
      reason: '未检测到完整译注候选（处于正文初稿阶段）',
      issues: [],
      hasBlockers: false
    };
  }

  return checkArticleCandidate(data, itemId);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('用法: node tools/content/semantic_preflight.mjs <batchId> [articleId | --all]');
    process.exit(1);
  }

  const batchId = args[0];
  const target = args[1] || '--all';
  const batchDir = join(process.cwd(), 'content', 'staging', batchId);

  if (!existsSync(batchDir)) {
    console.error(`未找到批次目录: ${batchDir}`);
    process.exit(1);
  }

  const manifestPath = join(batchDir, 'manifest.json');
  let items = [];
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    items = (manifest.items || []).map(it => it.id);
  } else {
    const files = await readdir(batchDir);
    items = [...new Set(files.filter(f => f.endsWith('.draft.json') || f.endsWith('.candidate.json')).map(f => f.split('.')[0]))];
  }

  if (target !== '--all') {
    items = items.filter(id => id === target);
    if (items.length === 0) {
      items = [target];
    }
  }

  console.log(`\n=== 语义/语法规则预检报告 [批次: ${batchId}] ===\n`);
  let totalIssues = 0;
  let totalBlockers = 0;
  let checkedCount = 0;

  for (const itemId of items) {
    try {
      const result = await preflightArticle(batchDir, itemId);
      if (result.skipped) {
        console.log(`[跳过] ${itemId}: ${result.reason}`);
        continue;
      }
      checkedCount++;
      const blockerCount = result.issues.filter(i => i.level === 'A').length;
      const warnCount = result.issues.filter(i => i.level !== 'A').length;
      totalIssues += result.issues.length;
      totalBlockers += blockerCount;

      const statusStr = blockerCount > 0 ? `规则疑点 (${blockerCount} 项 A 级风险)` : (warnCount > 0 ? `参考提示 (${warnCount} 项 B 级提示)` : '未见已知模式疑点');
      console.log(`[${statusStr}] ${itemId} (${result.totalSentences} 句, ${result.totalTokens} 词位)`);

      for (const issue of result.issues) {
        const loc = issue.sentenceId ? `${issue.sentenceId}${issue.tokenIndex !== undefined ? ` W${issue.tokenIndex + 1}` : ''}` : (issue.scope || '全文');
        console.log(`  [${issue.level} 级风险] ${loc} [${issue.rule}]: ${issue.detail}`);
      }
    } catch (err) {
      console.log(`[错误] ${itemId}: ${err.message}`);
    }
  }

  console.log(`\n总结：已复核 ${checkedCount} 篇候选，检出 ${totalBlockers} 项 A 级规则疑点，${totalIssues - totalBlockers} 项 B 级参考提示。\n`);
  process.exit(totalBlockers > 0 ? 2 : 0);
}

if (process.argv[1]?.endsWith('semantic_preflight.mjs')) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
