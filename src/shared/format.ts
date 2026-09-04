// Swedish-style display helpers shared by server (row labels) and clients (clock).

/** Units where an abbreviated number reads fine without the unit ("83,6 milj"). */
const COUNT_UNITS = new Set([
  'invånare',
  'passagerare',
  'besökare',
  'besökare/år',
  'personer',
  'registreringar',
  'exemplar',
  'användare',
  'anställda',
  'följare',
  'fordon',
  'åskådare',
  'biobesökare',
  'bärare',
  'nyfödda',
  'namngivna',
  'st',
]);

function oneDecimalSv(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

/** Parse a bank value like "83 577 100", "678,9", "0,49". Returns null for "ca 16", "-", etc. */
export function parseSwedishNumber(value: string): number | null {
  const cleaned = value.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Right-hand label for a reveal row (WORK_ORDER §C): "83,6 milj" for 83 577 100 invånare,
 * "2,9 mdr USD" for 2 923 710 708 USD, "8 849 m" for 8 849 m, raw text if not a number.
 */
export function formatValue(value: string, unit: string): string {
  const v = value.trim();
  const u = unit.trim();
  if (v === '' || v === '-') return '';
  const n = parseSwedishNumber(v);
  if (n === null) return u ? `${v} ${u}` : v;
  const suffix = COUNT_UNITS.has(u) ? '' : u;
  if (Math.abs(n) >= 1e9) return `${oneDecimalSv(n / 1e9)} mdr${suffix ? ' ' + suffix : ''}`;
  if (Math.abs(n) >= 1e6) return `${oneDecimalSv(n / 1e6)} milj${suffix ? ' ' + suffix : ''}`;
  return u ? `${v} ${u}` : v;
}

/** m:ss for a countdown; rounds up so 149 200 ms shows 2:30 and anything ≤ 0 shows 0:00. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
