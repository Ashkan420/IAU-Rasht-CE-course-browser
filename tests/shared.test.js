import { describe, it, expect } from 'vitest';
import {
  toJalali, formatJalaliDate, matchField,
  normalizeDay, parseSchedule, timeToMinutes, minutesToTime, esc, escAttr
} from '../lib/utils.js';

describe('toJalali', () => {
  it('converts 2026-08-14 to Jalali', () => {
    const { jy, jm, jd } = toJalali(2026, 8, 14);
    expect(jy).toBe(1405);
    expect(jm).toBe(5);
    expect(jd).toBe(23);
  });

  it('converts 2024-01-01 to Jalali', () => {
    const { jy, jm, jd } = toJalali(2024, 1, 1);
    expect(jy).toBe(1402);
    expect(jm).toBe(10);
    expect(jd).toBe(11);
  });
});

describe('formatJalaliDate', () => {
  it('formats date string to Persian', () => {
    const result = formatJalaliDate('2026-08-14');
    expect(result).toContain('1405');
    expect(result).toContain('مرداد');
  });
});

describe('matchField', () => {
  it('exact match for code fields', () => {
    expect(matchField('1234', '1234', 'کد درس')).toBe(true);
    expect(matchField('1234', '123', 'کد درس')).toBe(false);
  });

  it('partial match for name fields', () => {
    expect(matchField('برنامه‌نویسی پیشرفته', 'برنامه', 'نام درس')).toBe(true);
    expect(matchField('دکتر محمدی', 'محمدی', 'نام استاد')).toBe(true);
  });

  it('empty query matches everything', () => {
    expect(matchField('anything', '', 'کد درس')).toBe(true);
  });

  it('handles null/undefined cell values', () => {
    expect(matchField(null, 'test', 'نام درس')).toBe(false);
    expect(matchField(undefined, 'test', 'نام درس')).toBe(false);
  });
});

describe('normalizeDay', () => {
  it('normalizes variant day names', () => {
    expect(normalizeDay('شنبه')).toBe('شنبه');
    expect(normalizeDay('يكشنبه')).toBe('یکشنبه');
    expect(normalizeDay('یکشنبه')).toBe('یکشنبه');
    expect(normalizeDay('سه شنبه')).toBe('سه‌شنبه');
    expect(normalizeDay('پنج شنبه')).toBe('پنجشنبه');
  });

  it('returns null for unknown days', () => {
    expect(normalizeDay('جمعه')).toBeNull();
    expect(normalizeDay('')).toBeNull();
    expect(normalizeDay(null)).toBeNull();
  });
});

describe('parseSchedule', () => {
  it('parses single schedule slot', () => {
    const result = parseSchedule('شنبه از 08:00 تا 10:00');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ day: 'شنبه', start: '08:00', end: '10:00' });
  });

  it('parses multiple slots', () => {
    const result = parseSchedule('شنبه از 08:00 تا 10:00 و یکشنبه از 14:00 تا 16:00');
    expect(result).toHaveLength(2);
  });

  it('returns empty for empty/null input', () => {
    expect(parseSchedule('')).toEqual([]);
    expect(parseSchedule(null)).toEqual([]);
    expect(parseSchedule('   ')).toEqual([]);
  });

  it('handles various day name spellings', () => {
    const result = parseSchedule('سه شنبه از 10:00 تا 12:00');
    expect(result).toHaveLength(1);
    expect(result[0].day).toBe('سه‌شنبه');
  });
});

describe('timeToMinutes / minutesToTime', () => {
  it('converts time string to minutes', () => {
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('converts minutes to time string', () => {
    expect(minutesToTime(510)).toBe('08:30');
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(1439)).toBe('23:59');
  });

  it('round-trips correctly', () => {
    for (let m = 0; m < 1440; m += 60) {
      expect(timeToMinutes(minutesToTime(m))).toBe(m);
    }
  });
});

describe('esc', () => {
  it('escapes HTML entities', () => {
    expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('handles null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('escAttr', () => {
  it('escapes attribute values', () => {
    expect(escAttr('value="test"')).toBe('value=&quot;test&quot;');
    expect(escAttr('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });
});
