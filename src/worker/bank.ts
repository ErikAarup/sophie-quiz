// Builds the runtime quiz from the bundled data files (WORK_ORDER §B "Data", §C).
// Runtime-agnostic: used by the Worker, the unit tests and the live grader test.

import bankJson from '../../data/bank.json';
import quizJson from '../../data/quiz.json';
import aliasesJson from '../../data/aliases.json';
import { formatValue } from '../shared/format.ts';
import type { Quiz, QuizQuestion, QuizRow } from '../shared/types.ts';

interface BankItem {
  rank: number;
  name_sv: string;
  value: string;
  unit: string;
}

export interface BankList {
  no: number;
  slug_en: string;
  category: string;
  title_sv: string;
  definition_sv: string;
  host_question_sv: string;
  source_name: string;
  source_url: string;
  as_of: string;
  verdict: string;
  items: BankItem[];
}

interface Bank {
  generated_on: string;
  count: number;
  lists: BankList[];
}

interface QuizFile {
  questions: string[];
  durationSeconds: number;
}

type AliasFile = Record<string, Record<string, string[]> | string>;

export const bank = bankJson as unknown as Bank;
export const quizFile = quizJson as unknown as QuizFile;
export const aliasFile = aliasesJson as unknown as AliasFile;

export function listBySlug(slug: string): BankList | undefined {
  return bank.lists.find((l) => l.slug_en === slug);
}

export function buildQuestion(list: BankList, aliases: Record<string, string[]> = {}): QuizQuestion {
  const rows: QuizRow[] = [...list.items]
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.rank - b.item.rank || a.i - b.i)
    .map(({ item }) => ({
      rank: item.rank,
      name: item.name_sv,
      value: String(item.value ?? ''),
      unit: String(item.unit ?? ''),
      label: formatValue(String(item.value ?? ''), String(item.unit ?? '')),
    }));
  return {
    slug: list.slug_en,
    title: list.title_sv,
    question: list.host_question_sv,
    definition: list.definition_sv,
    source: list.source_name,
    rows,
    topCount: rows.filter((r) => r.rank <= 10).length,
    aliases,
  };
}

export interface BuildQuizOptions {
  /** Overrides quiz.json's durationSeconds (the e2e suite shortens the clock). */
  durationSeconds?: number | undefined;
}

/** Throws with a clear message if quiz.json names a slug that is missing or not verified/corrected. */
export function buildQuiz(opts: BuildQuizOptions = {}): Quiz {
  const questions = quizFile.questions.map((slug) => {
    const list = listBySlug(slug);
    if (!list) throw new Error(`quiz.json: no list with slug "${slug}" in data/bank.json (run npm run sync-bank?)`);
    if (list.verdict !== 'verified' && list.verdict !== 'corrected') {
      throw new Error(`quiz.json: list "${slug}" has verdict "${list.verdict}"; only verified/corrected lists may be used`);
    }
    if (list.items.length < 10) throw new Error(`quiz.json: list "${slug}" has only ${list.items.length} rows`);
    const aliases = aliasFile[slug];
    return buildQuestion(list, typeof aliases === 'object' ? aliases : {});
  });
  if (questions.length === 0) throw new Error('quiz.json: no questions');
  const seconds = opts.durationSeconds ?? quizFile.durationSeconds;
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`invalid question length ${seconds}`);
  return { questions, durationMs: Math.round(seconds * 1000) };
}
