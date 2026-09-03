// Deterministic pre-pass for the grader (WORK_ORDER §D): normalise and exact-match against
// row names and the alias table. Exact hits are final without the model.

import type { QuizQuestion } from './types.ts';

/** Lowercase, strip diacritics and punctuation, collapse whitespace. "Tjeckien!" -> "tjeckien". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/đ/g, 'd')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Spellings that count as the row itself: the name, the name without "(...)", and its aliases. */
export function rowVariants(name: string, aliases: readonly string[] = []): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const n = normalize(s);
    if (n) out.add(n);
  };
  add(name);
  const sansParen = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (sansParen && sansParen !== name) add(sansParen);
  for (const a of aliases) add(a);
  return [...out];
}

export type PrepassHit = { kind: 'hit'; rowIndex: number } | { kind: 'ambiguous'; rowIndexes: number[] } | { kind: 'none' };

export interface PrepassIndex {
  lookup(text: string): PrepassHit;
}

/** Build the variant -> row index map once per question. */
export function buildPrepass(question: Pick<QuizQuestion, 'rows' | 'aliases'>): PrepassIndex {
  const map = new Map<string, Set<number>>();
  question.rows.forEach((row, i) => {
    for (const v of rowVariants(row.name, question.aliases[row.name] ?? [])) {
      let set = map.get(v);
      if (!set) {
        set = new Set();
        map.set(v, set);
      }
      set.add(i);
    }
  });
  return {
    lookup(text: string): PrepassHit {
      const n = normalize(text);
      if (!n) return { kind: 'none' };
      const set = map.get(n);
      if (!set || set.size === 0) return { kind: 'none' };
      if (set.size === 1) return { kind: 'hit', rowIndex: [...set][0]! };
      return { kind: 'ambiguous', rowIndexes: [...set].sort((a, b) => a - b) };
    },
  };
}
