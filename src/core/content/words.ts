export interface Span {
  start: number;
  end: number;
  surface: string;
}

// Dotted initialisms and common titles keep their dots. Internal apostrophes
// and hyphens connect words; other punctuation is left in the original text.
export function words(text: string): Span[] {
  const pattern = /(?<![\p{L}\p{N}])(?:(?:[A-Za-z]\.){2,}|(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr)\.(?![\p{L}\p{N}])|\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’\-\u2010\u2011]\p{Script=Latin}[\p{Script=Latin}\p{M}]*)*)(?![\p{L}\p{N}])/giu;
  return Array.from(text.matchAll(pattern), ({ 0: surface, index: start }) => ({
    start, end: start + surface.length, surface,
  }));
}

export function matchingPhrases<T extends Span>(phrases: readonly T[], token: Span): T[] {
  return phrases.filter(span => span.start <= token.start && span.end >= token.end)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
}

