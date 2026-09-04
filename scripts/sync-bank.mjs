// Snapshot the vault's top-ten bank into data/bank.json (WORK_ORDER.md §4, §C).
// The only thing this repo ever reads from the vault. Never writes there.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source =
  process.env.BANK_PATH ?? 'C:\\Users\\erika\\_coach\\current\\sophie-quiz\\top-ten-bank.json';
const target = resolve(root, 'data', 'bank.json');

const raw = readFileSync(source, 'utf8');
const bank = JSON.parse(raw);

if (!Array.isArray(bank.lists) || bank.lists.length === 0) {
  console.error(`sync-bank: ${source} has no "lists" array`);
  process.exit(1);
}
for (const list of bank.lists) {
  for (const key of ['slug_en', 'title_sv', 'definition_sv', 'host_question_sv', 'verdict', 'items']) {
    if (!(key in list)) {
      console.error(`sync-bank: list ${list.slug_en ?? '?'} lacks "${key}"`);
      process.exit(1);
    }
  }
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(bank, null, 2) + '\n', 'utf8');
const usable = bank.lists.filter((l) => l.verdict === 'verified' || l.verdict === 'corrected').length;
console.log(
  `sync-bank: ${bank.lists.length} lists (${usable} verified/corrected), generated_on ${bank.generated_on} -> data/bank.json`,
);
