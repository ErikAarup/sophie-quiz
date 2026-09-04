import { describe, expect, it } from 'vitest';
import { formatClock, formatValue, parseSwedishNumber } from '../../src/shared/format.ts';

describe('parseSwedishNumber', () => {
  it('reads space-grouped integers and comma decimals', () => {
    expect(parseSwedishNumber('83 577 100')).toBe(83_577_100);
    expect(parseSwedishNumber('678,9')).toBeCloseTo(678.9);
    expect(parseSwedishNumber('0,49')).toBeCloseTo(0.49);
  });
  it('rejects text values', () => {
    expect(parseSwedishNumber('ca 16')).toBeNull();
    expect(parseSwedishNumber('-')).toBeNull();
  });
});

describe('formatValue', () => {
  it('abbreviates millions Swedish-style and drops a count unit (§C example)', () => {
    expect(formatValue('83 577 100', 'invånare')).toBe('83,6 milj');
    expect(formatValue('10 749 600', 'invånare')).toBe('10,7 milj');
    expect(formatValue('18 044 000', 'invånare')).toBe('18,0 milj');
  });
  it('keeps a real unit after the abbreviation', () => {
    expect(formatValue('2 923 710 708', 'USD')).toBe('2,9 mdr USD');
    expect(formatValue('17 098 246', 'km²')).toBe('17,1 milj km²');
  });
  it('shows small numbers raw with their unit', () => {
    expect(formatValue('8 849', 'm')).toBe('8 849 m');
    expect(formatValue('160', 'miljoner')).toBe('160 miljoner');
    expect(formatValue('0,49', 'km²')).toBe('0,49 km²');
  });
  it('passes non-numeric values through', () => {
    expect(formatValue('ca 16', 'miljoner besökare')).toBe('ca 16 miljoner besökare');
    expect(formatValue('-', 'x')).toBe('');
  });
});

describe('formatClock', () => {
  it('rounds up to whole seconds and never goes below 0:00', () => {
    expect(formatClock(150_000)).toBe('2:30');
    expect(formatClock(149_200)).toBe('2:30');
    expect(formatClock(107_000)).toBe('1:47');
    expect(formatClock(900)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-5_000)).toBe('0:00');
  });
});
