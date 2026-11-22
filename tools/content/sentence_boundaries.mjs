import { words } from '../../src/core/content/words.ts';

// Return UTF-16 offsets. Keep a closing quote with its sentence and keep
// a lowercase dialogue attribution with the quoted speech.
export function sentenceSpans(text) {
  const protectedEnds = new Set(words(text).filter(word => word.surface.endsWith('.')).map(word => word.end));
  const spans = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?]+[”’"'\])]*(?:\s+)(?=[“‘"'(]*[A-Z])/gu)) {
    const punctuationEnd = match.index + 1;
    if (match[0][0] === '.' && protectedEnds.has(punctuationEnd)) continue;
    const end = match.index + match[0].trimEnd().length;
    spans.push({start, end, text: text.slice(start, end)});
    start = match.index + match[0].length;
  }
  spans.push({start, end:text.length, text:text.slice(start)});
  return spans;
}
