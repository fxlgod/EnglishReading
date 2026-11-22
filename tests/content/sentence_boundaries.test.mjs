import test from 'node:test';
import assert from 'node:assert/strict';
import {sentenceSpans} from '../../tools/content/sentence_boundaries.mjs';

test('ends each sentence after its closing quote and keeps UTF-16 positions', () => {
  const sentences = [
    '“I’ll keep the pot safe.”',
    '“Wouldn’t it be easier?”',
    '“I can have it all to myself!”',
    'He spun a long thread.'
  ];
  const text = sentences.join(' ');
  const spans = sentenceSpans(text);
  assert.deepEqual(spans.map(span=>span.text),sentences);
  for (const {start,end,text:expected} of spans) assert.equal(text.slice(start,end),expected);
  assert.equal(spans[1].start,sentences[0].length+1);
});

test('keeps lowercase speech attribution and common titles within the sentence', () => {
  const text = '"Wouldn’t it be easier?" he asked. Mr. Jones nodded.';
  assert.deepEqual(sentenceSpans(text).map(span=>span.text),[
    '"Wouldn’t it be easier?" he asked.', 'Mr. Jones nodded.'
  ]);
});
