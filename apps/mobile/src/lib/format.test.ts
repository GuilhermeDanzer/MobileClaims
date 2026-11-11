import { dateInputToIso, formatDateInput, maskDate } from './format';

describe('date input', () => {
  test('adds slashes as digits are typed', () => {
    const expected = ['', '1', '11', '11/0', '11/03', '11/03/2', '11/03/20', '11/03/202', '11/03/2026'];
    expected.forEach((value, length) => expect(maskDate('11032026'.slice(0, length))).toBe(value));
  });

  test('handles pasted text, excess digits, and deletion', () => {
    expect(maskDate('11/03/2026')).toBe('11/03/2026');
    expect(maskDate('11a03b2026')).toBe('11/03/2026');
    expect(maskDate('110320261234')).toBe('11/03/2026');
    expect(maskDate('abc')).toBe('');
    expect(maskDate('11/03/')).toBe('11/03');
    expect(maskDate('11/')).toBe('11');
  });

  test('round trips stored dates and preserves incomplete input', () => {
    expect(formatDateInput('2026-11-03')).toBe('11/03/2026');
    expect(dateInputToIso('11/03/2026')).toBe('2026-11-03');
    expect(formatDateInput(dateInputToIso('11/03/2026'))).toBe('11/03/2026');
    expect(dateInputToIso('11/03/202')).toBe('11/03/202');
    expect(formatDateInput('11/03/202')).toBe('11/03/202');
  });
});
