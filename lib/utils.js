/**
 * Pure utility functions — testable in Node.js without DOM.
 * Parallel copy of functions from shared.js; NOT imported by the browser code.
 */

export function toJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const days = 355666 + (365 * gy) + Math.floor((gy + 3) / 4) - Math.floor((gy + 99) / 100) + Math.floor((gy + 399) / 400) + gd + g_d_m[gm - 1];
  let jy = -1595 + (33 * Math.floor(days / 12053));
  let daysLeft = days % 12053;
  jy += 4 * Math.floor(daysLeft / 1461);
  daysLeft = daysLeft % 1461;
  if (daysLeft > 365) {
    jy += Math.floor((daysLeft - 1) / 365);
    daysLeft = (daysLeft - 1) % 365;
  }
  let jm, jd;
  if (daysLeft < 186) {
    jm = 1 + Math.floor(daysLeft / 31);
    jd = 1 + (daysLeft % 31);
  } else {
    jm = 7 + Math.floor((daysLeft - 186) / 30);
    jd = 1 + ((daysLeft - 186) % 30);
  }
  return { jy, jm, jd };
}

export function formatJalaliDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jd = toJalali(y, m, d);
  const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  return `${jd.jd} ${months[jd.jm - 1]} ${jd.jy}`;
}

export function matchField(cellValue, query, field) {
  const cell = (cellValue || '').toString().trim();
  const q = query.trim();
  if (!q) return true;
  if (field === 'نام درس' || field === 'نام استاد') {
    return cell.includes(q);
  }
  return cell === q;
}

export const DAY_NAMES = {
  'شنبه': 'شنبه',
  'يكشنبه': 'یکشنبه',
  'یکشنبه': 'یکشنبه',
  'دوشنبه': 'دوشنبه',
  'سه شنبه': 'سه‌شنبه',
  'سه‌شنبه': 'سه‌شنبه',
  'چهارشنبه': 'چهارشنبه',
  'پنج شنبه': 'پنجشنبه',
  'پنجشنبه': 'پنجشنبه'
};

export function normalizeDay(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  return DAY_NAMES[trimmed] || null;
}

export function parseSchedule(scheduleStr) {
  if (!scheduleStr || !scheduleStr.trim()) return [];
  const slots = [];
  const regex = /(شنبه|يكشنبه|یکشنبه|دوشنبه|سه شنبه|سه‌شنبه|چهارشنبه|پنج شنبه|پنجشنبه)\s+[^\d]+(\d{1,2}:\d{2})\s+تا\s+(\d{1,2}:\d{2})/g;
  let match;
  while ((match = regex.exec(scheduleStr)) !== null) {
    const day = normalizeDay(match[1]);
    if (day) {
      slots.push({ day, start: match[2], end: match[3] });
    }
  }
  return slots;
}

export function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function esc(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escAttr(str) {
  return (str || '').toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
