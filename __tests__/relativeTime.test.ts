import {formatRelativeTime} from '../src/relativeTime';

const NOW = new Date('2026-08-25T12:00:00').getTime();

describe('formatRelativeTime', () => {
  it('formats sub-minute as now', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('now');
    expect(formatRelativeTime(NOW, NOW)).toBe('now');
  });

  it('formats minutes and hours', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
  });

  it('formats days under a week', () => {
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2d ago');
  });

  it('falls back to a date a week out', () => {
    const ts = new Date('2026-05-10T08:00:00').getTime();
    expect(formatRelativeTime(ts, NOW)).toBe('May 10');
  });

  it('includes the year for other years', () => {
    const ts = new Date('2024-05-10T08:00:00').getTime();
    expect(formatRelativeTime(ts, NOW)).toBe('May 10, 2024');
  });
});
