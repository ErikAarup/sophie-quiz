// Deterministic pre-pass for the grader (WORK_ORDER §D): normalise and exact-match against
// row names and the alias table. Exact hits are final without the model.

import type { QuizQuestion } from './types.ts';

/**
 * Emoji and flag sequences become stable ASCII tokens ("😂" -> "e1f602") so an emoji-only answer
 * can be an exact hit against an alias that is the emoji itself. Variation selectors and skin tones
 * are dropped (👍🏽 = 👍); ZWJ sequences keep every part; repeats collapse ("😂😂" = "😂").
 */
const EMOJI_SEQ =
  /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:[\u{FE0E}\u{FE0F}]|[\u{1F3FB}-\u{1F3FF}]|\p{Regional_Indicator}|\u{200D}(?:\p{Extended_Pictographic}|\p{Regional_Indicator}))*/gu;
function emojiToTokens(text: string): string {
  return text.replace(EMOJI_SEQ, (m) => {
    const cps = [...m]
      .map((c) => c.codePointAt(0)!)
      .filter((cp) => cp !== 0xfe0e && cp !== 0xfe0f && !(cp >= 0x1f3fb && cp <= 0x1f3ff));
    return ` e${cps.map((cp) => cp.toString(16)).join('x')} `;
  });
}

/** Lowercase, strip diacritics and punctuation, collapse whitespace. "Tjeckien!" -> "tjeckien"; "😂😂" -> "e1f602". */
export function normalize(text: string): string {
  return emojiToTokens(text)
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
    .replace(/\b(e[0-9a-fx]+)(?: \1)+\b/g, '$1')
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
