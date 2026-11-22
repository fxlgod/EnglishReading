import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticleCandidate } from '../../tools/content/semantic_preflight.mjs';

test('detects contraction lemma missing components and gloss bleeding', () => {
  const badData = {
    candidate: {
      paragraphs: [
        {
          sentences: [
            {
              id: 's1',
              text: 'Don’t worry, you’ll never see it.',
              translation_zh: '别担心，你永远不会看到它。',
              tokens: [
                { surface: 'Don’t', lemma: 'do', pos: 'verb', gloss_zh: '不要' },
                { surface: 'worry', lemma: 'worry', pos: 'verb', gloss_zh: '担心' },
                { surface: 'you’ll', lemma: 'you will', pos: 'pronoun', gloss_zh: '你绝不会' },
                { surface: 'never', lemma: 'never', pos: 'adverb', gloss_zh: '从不' },
                { surface: 'see', lemma: 'see', pos: 'verb', gloss_zh: '看见' },
                { surface: 'it', lemma: 'it', pos: 'pronoun', gloss_zh: '它' }
              ]
            }
          ]
        }
      ]
    }
  };

  const res = checkArticleCandidate(badData, 'test-article');
  assert.equal(res.hasBlockers, true);
  const rules = res.issues.map(i => i.rule);
  assert.ok(rules.includes('contraction_lemma_missing_not'), 'should flag don’t missing not in lemma');
  assert.ok(rules.includes('contraction_gloss_semantic_bleeding'), 'should flag you’ll absorbing never');
});

test('distinguishes existential there from locative there in relative clauses', () => {
  // Case A: Existential error (there was a king, there was no sign)
  const existentialBad = {
    candidate: {
      paragraphs: [
        {
          sentences: [
            {
              id: 's1',
              text: 'There was a king.',
              translation_zh: '从前有一位国王。',
              tokens: [
                { surface: 'There', lemma: 'there', pos: 'pronoun', gloss_zh: '那里' },
                { surface: 'was', lemma: 'be', pos: 'verb', gloss_zh: '有' },
                { surface: 'a', lemma: 'a', pos: 'article', gloss_zh: '一个' },
                { surface: 'king', lemma: 'king', pos: 'noun', gloss_zh: '国王' }
              ]
            }
          ]
        }
      ]
    }
  };
  const resBad = checkArticleCandidate(existentialBad, 'test-existential');
  assert.equal(resBad.hasBlockers, true);
  assert.ok(resBad.issues.map(i => i.rule).includes('existential_there_locative_error'));

  // Case B: Real locative there in relative clause (they observed there were young)
  const locativeGood = {
    candidate: {
      paragraphs: [
        {
          sentences: [
            {
              id: 's2',
              text: 'Most of the hawksbills they observed there were young.',
              translation_zh: '他们观察到的大多数玳瑁海龟都是幼龟。',
              tokens: [
                { surface: 'Most', lemma: 'most', pos: '代词', gloss_zh: '大多数' },
                { surface: 'of', lemma: 'of', pos: '介词', gloss_zh: '在……之中' },
                { surface: 'the', lemma: 'the', pos: '冠词', gloss_zh: '那些' },
                { surface: 'hawksbills', lemma: 'hawksbill', pos: '名词', gloss_zh: '玳瑁海龟' },
                { surface: 'they', lemma: 'they', pos: '代词', gloss_zh: '他们' },
                { surface: 'observed', lemma: 'observe', pos: '动词', gloss_zh: '观察到' },
                { surface: 'there', lemma: 'there', pos: '副词', gloss_zh: '在那里' },
                { surface: 'were', lemma: 'be', pos: '动词', gloss_zh: '是' },
                { surface: 'young', lemma: 'young', pos: '形容词', gloss_zh: '年轻的' }
              ]
            }
          ]
        }
      ]
    }
  };
  const resGood = checkArticleCandidate(locativeGood, 'test-locative');
  assert.equal(resGood.hasBlockers, false, 'locative there in relative clause must not be flagged');
});

test('distinguishes future be going to from physical destination going to', () => {
  // Case A: Future aspect with literal motion error
  const futureBad = {
    candidate: {
      paragraphs: [
        {
          sentences: [
            {
              id: 's1',
              text: 'I am going to fly.',
              translation_zh: '我要飞了。',
              tokens: [
                { surface: 'I', lemma: 'I', pos: '代词', gloss_zh: '我' },
                { surface: 'am', lemma: 'be', pos: '助动词', gloss_zh: '助动词' },
                { surface: 'going', lemma: 'go', pos: '动词', gloss_zh: '去；与 be ... to 共同构成将来表达（be going to）' },
                { surface: 'to', lemma: 'to', pos: '不定式标记', gloss_zh: '去' },
                { surface: 'fly', lemma: 'fly', pos: '动词', gloss_zh: '飞' }
              ]
            }
          ]
        }
      ]
    }
  };
  const resBad = checkArticleCandidate(futureBad, 'test-future');
  assert.equal(resBad.hasBlockers, true);
  assert.ok(resBad.issues.map(i => i.rule).includes('be_going_to_literal_movement'));

  // Case B: Physical destination (going to the big city)
  const destinationGood = {
    candidate: {
      paragraphs: [
        {
          sentences: [
            {
              id: 's2',
              text: 'I was going to the big city.',
              translation_zh: '我那时正前往大城市。',
              tokens: [
                { surface: 'I', lemma: 'I', pos: '代词', gloss_zh: '我' },
                { surface: 'was', lemma: 'be', pos: '助动词', gloss_zh: '与going构成过去进行时表打算' },
                { surface: 'going', lemma: 'go', pos: '动词', gloss_zh: '前往；去' },
                { surface: 'to', lemma: 'to', pos: '介词', gloss_zh: '前往' },
                { surface: 'the', lemma: 'the', pos: '冠词', gloss_zh: '那座' },
                { surface: 'big', lemma: 'big', pos: '形容词', gloss_zh: '大的' },
                { surface: 'city', lemma: 'city', pos: '名词', gloss_zh: '城市' }
              ]
            }
          ]
        }
      ]
    }
  };
  const resGood = checkArticleCandidate(destinationGood, 'test-destination');
  assert.equal(resGood.hasBlockers, false, 'physical motion going to [place] must not be flagged');
});

test('detects did absorbing negation from not, without false positives on grammatical explanations', () => {
  // Case A: did glossed as "不（过去时助动词）"
  const didBad = {
    candidate: {
      paragraphs: [
        {
          sentences: [
            {
              id: 's1',
              text: 'They did not want to leave.',
              translation_zh: '他们不想离开。',
              tokens: [
                { surface: 'They', lemma: 'they', pos: '代词', gloss_zh: '他们' },
                { surface: 'did', lemma: 'do', pos: '助动词', gloss_zh: '不（过去时助动词）' },
                { surface: 'not', lemma: 'not', pos: '否定副词', gloss_zh: '不' },
                { surface: 'want', lemma: 'want', pos: '动词', gloss_zh: '想要' },
                { surface: 'to', lemma: 'to', pos: '不定式标记', gloss_zh: '去' },
                { surface: 'leave', lemma: 'leave', pos: '动词', gloss_zh: '离开' }
              ]
            }
          ]
        }
      ]
    }
  };
  const resBad = checkArticleCandidate(didBad, 'test-did');
  assert.equal(resBad.hasBlockers, true);
  assert.ok(resBad.issues.map(i => i.rule).includes('do_did_not_negation_bleeding'));

  // Case B: Proper grammatical explanation "助动词，用于过去时否定句" (must not flag)
  const didGood = {
    candidate: {
      paragraphs: [
        {
          sentences: [
            {
              id: 's2',
              text: 'They did not want to leave.',
              translation_zh: '他们不想离开。',
              tokens: [
                { surface: 'They', lemma: 'they', pos: '代词', gloss_zh: '他们' },
                { surface: 'did', lemma: 'do', pos: '助动词', gloss_zh: '助动词，用于过去时否定句' },
                { surface: 'not', lemma: 'not', pos: '否定副词', gloss_zh: '不' },
                { surface: 'want', lemma: 'want', pos: '动词', gloss_zh: '想要' },
                { surface: 'to', lemma: 'to', pos: '不定式标记', gloss_zh: '去' },
                { surface: 'leave', lemma: 'leave', pos: '动词', gloss_zh: '离开' }
              ]
            }
          ]
        }
      ]
    }
  };
  const resGood = checkArticleCandidate(didGood, 'test-did-good');
  assert.equal(resGood.hasBlockers, false, 'grammatical explanation mentioning 否定句 must not be flagged');
});

test('detects perfect aspect have glossed as 曾经, without false positives on main verb have', () => {
  // Case A: Perfect auxiliary have glossed as "曾经"
  const haveBad = {
    candidate: {
      paragraphs: [
        {
          sentences: [
            {
              id: 's1',
              text: 'Have you seen it?',
              translation_zh: '你见过它吗？',
              tokens: [
                { surface: 'Have', lemma: 'have', pos: '助动词', gloss_zh: '曾经' },
                { surface: 'you', lemma: 'you', pos: '代词', gloss_zh: '你' },
                { surface: 'seen', lemma: 'see', pos: '动词', gloss_zh: '看见' },
                { surface: 'it', lemma: 'it', pos: '代词', gloss_zh: '它' }
              ]
            }
          ]
        }
      ]
    }
  };
  const resBad = checkArticleCandidate(haveBad, 'test-have');
  assert.equal(resBad.hasBlockers, true);
  assert.ok(resBad.issues.map(i => i.rule).includes('perfect_have_auxiliary_error'));

  // Case B: Proper perfect auxiliary explanation (must not flag)
  const haveGood = {
    candidate: {
      paragraphs: [
        {
          sentences: [
            {
              id: 's2',
              text: 'Have you seen it?',
              translation_zh: '你见过它吗？',
              tokens: [
                { surface: 'Have', lemma: 'have', pos: '助动词', gloss_zh: '助动词，与过去分词 seen 构成现在完成时，询问是否见过' },
                { surface: 'you', lemma: 'you', pos: '代词', gloss_zh: '你' },
                { surface: 'seen', lemma: 'see', pos: '动词', gloss_zh: '看见' },
                { surface: 'it', lemma: 'it', pos: '代词', gloss_zh: '它' }
              ]
            }
          ]
        }
      ]
    }
  };
  const resGood = checkArticleCandidate(haveGood, 'test-have-good');
  assert.equal(resGood.hasBlockers, false);

  // Case C: Main verb have meaning possession "有" (must not flag)
  const haveMain = {
    candidate: {
      paragraphs: [
        {
          sentences: [
            {
              id: 's3',
              text: 'I have a dog.',
              translation_zh: '我有一只狗。',
              tokens: [
                { surface: 'I', lemma: 'I', pos: '代词', gloss_zh: '我' },
                { surface: 'have', lemma: 'have', pos: '动词', gloss_zh: '有；拥有' },
                { surface: 'a', lemma: 'a', pos: '冠词', gloss_zh: '一只' },
                { surface: 'dog', lemma: 'dog', pos: '名词', gloss_zh: '狗' }
              ]
            }
          ]
        }
      ]
    }
  };
  const resMain = checkArticleCandidate(haveMain, 'test-have-main');
  assert.equal(resMain.hasBlockers, false, 'main verb have expressing possession must not be flagged');
});

test('regression: 15 historical confirmed errors hit 15/15 and fixed counterparts have zero false positives', () => {
  // 15 historical error cases synthesized from the exact token definitions recorded in project logs:
  const historicalErrors = [
    // 1-3. Daisy a40130a4 S7 W3/W4, S16 W3
    { id: 'daisy-s7', text: 'She wouldn’t give up.', tokens: [
      { surface: 'give', lemma: 'give', pos: '动词', gloss_zh: '给；与 up 构成短语 give up 表示放弃' },
      { surface: 'up', lemma: 'up', pos: '副词', gloss_zh: '向上；与 give 构成短语 give up 表示放弃' }
    ]},
    { id: 'daisy-s16', text: 'I am never going to fly!', tokens: [
      { surface: 'am', lemma: 'be', pos: '助动词', gloss_zh: '助动词' },
      { surface: 'going', lemma: 'go', pos: '动词', gloss_zh: '去；与 be ... to 共同构成将来表达（be going to）' },
      { surface: 'to', lemma: 'to', pos: '不定式标记', gloss_zh: '去' },
      { surface: 'fly', lemma: 'fly', pos: '动词', gloss_zh: '飞翔' }
    ]},
    // 4. Daisy e456c99e S1 W13
    { id: 'daisy-s1', text: '... there lived a little chicken ...', tokens: [
      { surface: 'there', lemma: 'there', pos: '代词', gloss_zh: '那里' },
      { surface: 'lived', lemma: 'live', pos: '动词', gloss_zh: '住着' },
      { surface: 'a', lemma: 'a', pos: '冠词', gloss_zh: '一只' },
      { surface: 'chicken', lemma: 'chicken', pos: '名词', gloss_zh: '小鸡' }
    ]},
    // 5-8. Tortoise 0131caaf S11, S20, S27, S35 W6 (there was no sign)
    { id: 'tort-s11', text: 'but there was no sign of a house', tokens: [
      { surface: 'but', lemma: 'but', pos: '连词', gloss_zh: '但是' },
      { surface: 'there', lemma: 'there', pos: '引导词', gloss_zh: '那里' },
      { surface: 'was', lemma: 'be', pos: '动词', gloss_zh: '有' },
      { surface: 'no', lemma: 'no', pos: '限定词', gloss_zh: '没有' },
      { surface: 'sign', lemma: 'sign', pos: '名词', gloss_zh: '迹象' }
    ]},
    { id: 'tort-s20', text: 'but there was no sign of a house', tokens: [
      { surface: 'but', lemma: 'but', pos: '连词', gloss_zh: '但是' },
      { surface: 'there', lemma: 'there', pos: '引导词', gloss_zh: '那里' },
      { surface: 'was', lemma: 'be', pos: '动词', gloss_zh: '有' },
      { surface: 'no', lemma: 'no', pos: '限定词', gloss_zh: '没有' },
      { surface: 'sign', lemma: 'sign', pos: '名词', gloss_zh: '迹象' }
    ]},
    { id: 'tort-s27', text: 'but there was no sign of a house', tokens: [
      { surface: 'but', lemma: 'but', pos: '连词', gloss_zh: '但是' },
      { surface: 'there', lemma: 'there', pos: '引导词', gloss_zh: '那里' },
      { surface: 'was', lemma: 'be', pos: '动词', gloss_zh: '有' },
      { surface: 'no', lemma: 'no', pos: '限定词', gloss_zh: '没有' },
      { surface: 'sign', lemma: 'sign', pos: '名词', gloss_zh: '迹象' }
    ]},
    { id: 'tort-s35', text: 'but there was no sign of a house', tokens: [
      { surface: 'but', lemma: 'but', pos: '连词', gloss_zh: '但是' },
      { surface: 'there', lemma: 'there', pos: '引导词', gloss_zh: '那里' },
      { surface: 'was', lemma: 'be', pos: '动词', gloss_zh: '有' },
      { surface: 'no', lemma: 'no', pos: '限定词', gloss_zh: '没有' },
      { surface: 'sign', lemma: 'sign', pos: '名词', gloss_zh: '迹象' }
    ]},
    // 9. Zama 5d22b11e S6 W4
    { id: 'zama-s6', text: 'I can cope with cold water ...', tokens: [
      { surface: 'cope', lemma: 'cope', pos: '动词', gloss_zh: '应付' },
      { surface: 'with', lemma: 'with', pos: '介词', gloss_zh: '与……一起；对于' }
    ]},
    // 10-13. Tortoise 0131caaf S7, S14, S23, S31 W1 (Have)
    { id: 'tort-s7', text: 'Have you seen it?', tokens: [
      { surface: 'Have', lemma: 'have', pos: '助动词', gloss_zh: '曾经' },
      { surface: 'you', lemma: 'you', pos: '代词', gloss_zh: '你' },
      { surface: 'seen', lemma: 'see', pos: '动词', gloss_zh: '看见' },
      { surface: 'it', lemma: 'it', pos: '代词', gloss_zh: '它' }
    ]},
    { id: 'tort-s14', text: 'Have you seen it?', tokens: [
      { surface: 'Have', lemma: 'have', pos: '助动词', gloss_zh: '曾经' },
      { surface: 'you', lemma: 'you', pos: '代词', gloss_zh: '你' },
      { surface: 'seen', lemma: 'see', pos: '动词', gloss_zh: '看见' },
      { surface: 'it', lemma: 'it', pos: '代词', gloss_zh: '它' }
    ]},
    { id: 'tort-s23', text: 'Have you seen it?', tokens: [
      { surface: 'Have', lemma: 'have', pos: '助动词', gloss_zh: '曾经' },
      { surface: 'you', lemma: 'you', pos: '代词', gloss_zh: '你' },
      { surface: 'seen', lemma: 'see', pos: '动词', gloss_zh: '看见' },
      { surface: 'it', lemma: 'it', pos: '代词', gloss_zh: '它' }
    ]},
    { id: 'tort-s31', text: 'Have you seen it?', tokens: [
      { surface: 'Have', lemma: 'have', pos: '助动词', gloss_zh: '曾经' },
      { surface: 'you', lemma: 'you', pos: '代词', gloss_zh: '你' },
      { surface: 'seen', lemma: 'see', pos: '动词', gloss_zh: '看见' },
      { surface: 'it', lemma: 'it', pos: '代词', gloss_zh: '它' }
    ]},
    // 14-15. Holidays 6679c229 S24 W11, S34 W9 (did)
    { id: 'holi-s24', text: '... the cows did not get into trouble ...', tokens: [
      { surface: 'did', lemma: 'do', pos: '助动词', gloss_zh: '不（过去时助动词）' },
      { surface: 'not', lemma: 'not', pos: '否定副词', gloss_zh: '不；没有' },
      { surface: 'get', lemma: 'get', pos: '动词', gloss_zh: '陷入' }
    ]},
    { id: 'holi-s34', text: '... they did not want to leave ...', tokens: [
      { surface: 'did', lemma: 'do', pos: '助动词', gloss_zh: '不（过去时助动词）' },
      { surface: 'not', lemma: 'not', pos: '否定副词', gloss_zh: '不' },
      { surface: 'want', lemma: 'want', pos: '动词', gloss_zh: '想要' }
    ]}
  ];

  let flaggedCount = 0;
  for (const item of historicalErrors) {
    const data = { candidate: { paragraphs: [{ sentences: [{ id: item.id, text: item.text, tokens: item.tokens }] }] } };
    const res = checkArticleCandidate(data, item.id);
    if (res.hasBlockers) flaggedCount += res.issues.length;
  }
  assert.equal(flaggedCount, 15, `must hit all 15 historical errors (got ${flaggedCount})`);

  // 15 fixed counterparts
  const fixedCounterparts = [
    { id: 'daisy-s7-fix', text: 'She wouldn’t give up.', tokens: [
      { surface: 'give', lemma: 'give', pos: '动词', gloss_zh: '动词，与 up 构成短语 give up 表示放弃' },
      { surface: 'up', lemma: 'up', pos: '副词', gloss_zh: '副词小品词，与 give 构成短语 give up 表示放弃' }
    ]},
    { id: 'daisy-s16-fix', text: 'I am never going to fly!', tokens: [
      { surface: 'am', lemma: 'be', pos: '助动词', gloss_zh: '助动词' },
      { surface: 'going', lemma: 'go', pos: '动词', gloss_zh: '与 be ... to 共同构成将来表达结构（be going to），不表移动' },
      { surface: 'to', lemma: 'to', pos: '不定式标记', gloss_zh: '去' },
      { surface: 'fly', lemma: 'fly', pos: '动词', gloss_zh: '飞翔' }
    ]},
    { id: 'daisy-s1-fix', text: '... there lived a little chicken ...', tokens: [
      { surface: 'there', lemma: 'there', pos: '代词', gloss_zh: '存在句引导词，与 was 构成 there was 句型表示“存在”' },
      { surface: 'lived', lemma: 'live', pos: '动词', gloss_zh: '住着' },
      { surface: 'a', lemma: 'a', pos: '冠词', gloss_zh: '一只' },
      { surface: 'chicken', lemma: 'chicken', pos: '名词', gloss_zh: '小鸡' }
    ]},
    { id: 'tort-s11-fix', text: 'but there was no sign of a house', tokens: [
      { surface: 'but', lemma: 'but', pos: '连词', gloss_zh: '但是' },
      { surface: 'there', lemma: 'there', pos: '引导词', gloss_zh: '存在句引导词，不表具体地点；与 was 连用表示存在' },
      { surface: 'was', lemma: 'be', pos: '动词', gloss_zh: '存在；有' },
      { surface: 'no', lemma: 'no', pos: '限定词', gloss_zh: '没有' },
      { surface: 'sign', lemma: 'sign', pos: '名词', gloss_zh: '迹象' }
    ]},
    { id: 'tort-s20-fix', text: 'but there was no sign of a house', tokens: [
      { surface: 'but', lemma: 'but', pos: '连词', gloss_zh: '但是' },
      { surface: 'there', lemma: 'there', pos: '引导词', gloss_zh: '存在句引导词，不表具体地点；与 was 连用表示存在' },
      { surface: 'was', lemma: 'be', pos: '动词', gloss_zh: '存在；有' },
      { surface: 'no', lemma: 'no', pos: '限定词', gloss_zh: '没有' },
      { surface: 'sign', lemma: 'sign', pos: '名词', gloss_zh: '迹象' }
    ]},
    { id: 'tort-s27-fix', text: 'but there was no sign of a house', tokens: [
      { surface: 'but', lemma: 'but', pos: '连词', gloss_zh: '但是' },
      { surface: 'there', lemma: 'there', pos: '引导词', gloss_zh: '存在句引导词，不表具体地点；与 was 连用表示存在' },
      { surface: 'was', lemma: 'be', pos: '动词', gloss_zh: '存在；有' },
      { surface: 'no', lemma: 'no', pos: '限定词', gloss_zh: '没有' },
      { surface: 'sign', lemma: 'sign', pos: '名词', gloss_zh: '迹象' }
    ]},
    { id: 'tort-s35-fix', text: 'but there was no sign of a house', tokens: [
      { surface: 'but', lemma: 'but', pos: '连词', gloss_zh: '但是' },
      { surface: 'there', lemma: 'there', pos: '引导词', gloss_zh: '存在句引导词，不表具体地点；与 was 连用表示存在' },
      { surface: 'was', lemma: 'be', pos: '动词', gloss_zh: '存在；有' },
      { surface: 'no', lemma: 'no', pos: '限定词', gloss_zh: '没有' },
      { surface: 'sign', lemma: 'sign', pos: '名词', gloss_zh: '迹象' }
    ]},
    { id: 'zama-s6-fix', text: 'I can cope with cold water ...', tokens: [
      { surface: 'cope', lemma: 'cope', pos: '动词', gloss_zh: '应付' },
      { surface: 'with', lemma: 'with', pos: '介词', gloss_zh: '介词，与 cope 搭配引出应付对象' }
    ]},
    { id: 'tort-s7-fix', text: 'Have you seen it?', tokens: [
      { surface: 'Have', lemma: 'have', pos: '助动词', gloss_zh: '助动词，与过去分词 seen 构成现在完成时，询问是否见过' },
      { surface: 'you', lemma: 'you', pos: '代词', gloss_zh: '你' },
      { surface: 'seen', lemma: 'see', pos: '动词', gloss_zh: '看见' },
      { surface: 'it', lemma: 'it', pos: '代词', gloss_zh: '它' }
    ]},
    { id: 'tort-s14-fix', text: 'Have you seen it?', tokens: [
      { surface: 'Have', lemma: 'have', pos: '助动词', gloss_zh: '助动词，与过去分词 seen 构成现在完成时，询问是否见过' },
      { surface: 'you', lemma: 'you', pos: '代词', gloss_zh: '你' },
      { surface: 'seen', lemma: 'see', pos: '动词', gloss_zh: '看见' },
      { surface: 'it', lemma: 'it', pos: '代词', gloss_zh: '它' }
    ]},
    { id: 'tort-s23-fix', text: 'Have you seen it?', tokens: [
      { surface: 'Have', lemma: 'have', pos: '助动词', gloss_zh: '助动词，与过去分词 seen 构成现在完成时，询问是否见过' },
      { surface: 'you', lemma: 'you', pos: '代词', gloss_zh: '你' },
      { surface: 'seen', lemma: 'see', pos: '动词', gloss_zh: '看见' },
      { surface: 'it', lemma: 'it', pos: '代词', gloss_zh: '它' }
    ]},
    { id: 'tort-s31-fix', text: 'Have you seen it?', tokens: [
      { surface: 'Have', lemma: 'have', pos: '助动词', gloss_zh: '助动词，与过去分词 seen 构成现在完成时，询问是否见过' },
      { surface: 'you', lemma: 'you', pos: '代词', gloss_zh: '你' },
      { surface: 'seen', lemma: 'see', pos: '动词', gloss_zh: '看见' },
      { surface: 'it', lemma: 'it', pos: '代词', gloss_zh: '它' }
    ]},
    { id: 'holi-s24-fix', text: '... the cows did not get into trouble ...', tokens: [
      { surface: 'did', lemma: 'do', pos: '助动词', gloss_zh: '助动词（过去时）' },
      { surface: 'not', lemma: 'not', pos: '否定副词', gloss_zh: '不；没有' },
      { surface: 'get', lemma: 'get', pos: '动词', gloss_zh: '陷入' }
    ]},
    { id: 'holi-s34-fix', text: '... they did not want to leave ...', tokens: [
      { surface: 'did', lemma: 'do', pos: '助动词', gloss_zh: '助动词（过去时）' },
      { surface: 'not', lemma: 'not', pos: '否定副词', gloss_zh: '不' },
      { surface: 'want', lemma: 'want', pos: '动词', gloss_zh: '想要' }
    ]}
  ];

  let fixedFalsePositives = 0;
  for (const item of fixedCounterparts) {
    const data = { candidate: { paragraphs: [{ sentences: [{ id: item.id, text: item.text, tokens: item.tokens }] }] } };
    const res = checkArticleCandidate(data, item.id);
    if (res.hasBlockers) fixedFalsePositives += res.issues.length;
  }
  assert.equal(fixedFalsePositives, 0, `fixed counterparts must have zero false positives (got ${fixedFalsePositives})`);
});
