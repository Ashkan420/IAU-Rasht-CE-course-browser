/**
 * Shared utilities for IAU Course Browser & Schedule Builder
 * Exposes window.IAU global namespace
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────
  let allCourses = [];
  let filteredCourses = [];
  let currentCategory = 'همه';
  let currentGender = 'همه';
  let activeFilters = []; // { field, value }
  let sortField = null;
  let sortDir = 'asc'; // 'asc' | 'desc'
  let tableColumns = []; // dynamically from JSON keys
  let semesters = [];

  // ── Constants ──────────────────────────────────────────────────
  const LONG_COLS = new Set([
    'نام درس', 'نام استاد', 'زمانبندی تشکیل کلاس',
    'نام کلاس', 'مکان برگزاری', 'نام گروه آموزشی'
  ]);

  const CENTER_COLS = new Set([
    'نوع درس', 'نوع واحد', 'جنسیت', 'ظرفیت', 'مقطع ارائه'
  ]);

  // ── DOM helpers ────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Error banner helpers ──────────────────────────────────────
  function showError(message) {
    const banner = $('#errorBanner');
    const text = $('#errorBannerText');
    if (!banner || !text) return;
    text.textContent = message;
    banner.classList.add('visible');
  }

  function hideError() {
    const banner = $('#errorBanner');
    if (banner) banner.classList.remove('visible');
  }

  // ── XSS-safe helpers ─────────────────────────────────────────
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = (str || '').toString();
    return d.innerHTML;
  }

  function escAttr(str) {
    return (str || '').toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Persian date helpers ──────────────────────────────────────
  function toJalali(gy, gm, gd) {
    const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const gy2 = (gm > 2) ? (gy + 1) : gy;
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

  function formatJalaliDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const jalali = toJalali(y, m, d);
    const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
    return `${jalali.jd} ${months[jalali.jm - 1]} ${jalali.jy}`;
  }

  // ── Load semesters ─────────────────────────────────────────────
  async function loadSemesters() {
    try {
      const res = await fetch('data/semesters.json');
      semesters = await res.json();
      hideError();
    } catch (err) {
      console.error('Failed to load semesters:', err);
      semesters = [];
      showError('خطا در بارگذاری لیست نیمسال‌ها. لطفاً اتصال اینترنت خود را بررسی کنید.');
    }

    const semesterSelect = $('#semesterSelect');
    if (!semesterSelect) return;

    semesterSelect.innerHTML = semesters.map((s) =>
      `<option value="${s.id}">${s.id} — ${s.title}</option>`
    ).join('');

    if (semesters.length > 0) {
      semesterSelect.value = semesters[0].id;
    }
  }

  // ── Load courses for selected نیمسال ───────────────────────────
  async function loadCourses(semesterId) {
    const skeleton = $('#skeletonWrapper');
    if (skeleton) skeleton.classList.add('visible');

    try {
      const res = await fetch(`data/${semesterId}/courses.json`);
      const data = await res.json();
      hideError();

      if (data.دروس && Array.isArray(data.دروس)) {
        allCourses = data.دروس;
        const updateDateEl = $('#updateDate');
        if (data['تاریخ به‌روزرسانی'] && updateDateEl) {
          updateDateEl.textContent = `آخرین به‌روزرسانی: ${formatJalaliDate(data['تاریخ به‌روزرسانی'])}`;
        }
      } else {
        allCourses = data;
        const updateDateEl = $('#updateDate');
        if (updateDateEl) updateDateEl.textContent = '';
      }
      if (allCourses.length > 0) {
        tableColumns = Object.keys(allCourses[0]);
      }
    } catch (err) {
      console.error('Failed to load courses:', err);
      allCourses = [];
      tableColumns = [];
      showError('خطا در بارگذاری دروس. لطفاً اتصال اینترنت خود را بررسی کنید.');
    }

    if (skeleton) skeleton.classList.remove('visible');

    // Notify that data is ready
    _coursesLoadedCallbacks.forEach(function (fn) { fn(); });
  }

  // ── Filtering ──────────────────────────────────────────────────
  function matchField(cellValue, query, field) {
    const cell = (cellValue || '').toString().trim();
    const q = query.trim();
    if (!q) return true;
    if (field === 'نام درس' || field === 'نام استاد') {
      return cell.includes(q);
    }
    return cell === q;
  }

  function genderMatches(course, gender) {
    if (!gender || gender === 'همه') return true;
    if ((course['نوع واحد'] || '').trim() === 'تخصصی') return true;
    var g = (course['جنسیت'] || '').trim();
    var cn = (course['نام کلاس'] || '').trim();
    if (gender === 'خواهران') return g === 'زن' || cn.includes('خواهران');
    if (gender === 'برادران') return g === 'مرد' || cn.includes('برادران');
    return true;
  }

  function applyFilters() {
    let result = allCourses;

    if (currentCategory !== 'همه') {
      result = result.filter((c) => c['نوع واحد'] === currentCategory);
    }

    if (currentCategory !== 'تخصصی' && currentGender !== 'همه') {
      result = result.filter((c) => genderMatches(c, currentGender));
    }

    const grouped = {};
    for (const f of activeFilters) {
      if (!grouped[f.field]) grouped[f.field] = [];
      grouped[f.field].push(f.value);
    }
    for (const [field, values] of Object.entries(grouped)) {
      result = result.filter((c) =>
        values.some((v) => matchField(c[field], v, field))
      );
    }

    filteredCourses = result;
    applySort(false);
    renderTable();
    renderChips();
    updateCount();
    updateUrl();

    // Show/hide gender filter
    const genderFilterEl = $('#genderFilter');
    if (genderFilterEl) {
      if (currentCategory === 'تخصصی') {
        genderFilterEl.classList.remove('visible');
        currentGender = 'همه';
        genderFilterEl.querySelectorAll('.cat-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.gender === 'همه');
          b.setAttribute('aria-pressed', b.dataset.gender === 'همه' ? 'true' : 'false');
        });
      } else {
        genderFilterEl.classList.add('visible');
      }
    }

    // Show clear button
    const hasActiveFilters = activeFilters.length > 0 || currentCategory !== 'همه' || currentGender !== 'همه';
    const btnClear = $('#btnClear');
    if (btnClear) btnClear.style.display = hasActiveFilters ? '' : 'none';

    // Notify filter change listeners (e.g. schedule table)
    _filtersChangedCallbacks.forEach(function (fn) { fn(); });
  }

  // ── Sorting ────────────────────────────────────────────────────
  function applySort(rerender = true) {
    if (!sortField) return;
    filteredCourses.sort((a, b) => {
      const va = (a[sortField] || '').toString();
      const vb = (b[sortField] || '').toString();
      const numA = parseFloat(va);
      const numB = parseFloat(vb);
      if (!isNaN(numA) && !isNaN(numB)) {
        return sortDir === 'asc' ? numA - numB : numB - numA;
      }
      return sortDir === 'asc' ? va.localeCompare(vb, 'fa') : vb.localeCompare(va, 'fa');
    });
    if (rerender) renderTable();
  }

  // ── Table Header Builder ───────────────────────────────────────
  function buildTableHeader() {
    const tableHead = $('#courseTableHead');
    if (!tableHead) return;
    const tr = tableHead.querySelector('tr');
    tr.innerHTML = '';
    tableColumns.forEach((col) => {
      const th = document.createElement('th');
      th.dataset.sort = col;
      th.textContent = col;
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'columnheader');
      if (LONG_COLS.has(col)) th.classList.add('col-long');
      if (CENTER_COLS.has(col)) th.classList.add('col-center');
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      th.appendChild(arrow);

      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          th.click();
        }
      });

      th.addEventListener('click', () => {
        if (sortField === col) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortField = col;
          sortDir = 'asc';
        }
        $$('.table-wrapper th').forEach((t) => t.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        applySort(true);
        updateUrl();
      });

      tr.appendChild(th);
    });
  }

  // ── Table Rendering ────────────────────────────────────────────
  function renderCourseCells(course, columns, excludeCols) {
    excludeCols = excludeCols || new Set();
    return columns
      .filter(function (col) { return !excludeCols.has(col); })
      .map(function (col) {
        var val = course[col] || '';
        var cls = LONG_COLS.has(col) ? ' class="col-long"' : CENTER_COLS.has(col) ? ' class="col-center"' : '';
        var title = LONG_COLS.has(col) ? ' title="' + escAttr(val) + '"' : '';
        if (col === 'نوع واحد') {
          var badgeClass = val === 'عمومی' ? 'badge-general' : 'badge-specialized';
          val = '<span class="badge ' + badgeClass + '">' + esc(val) + '</span>';
        } else {
          val = esc(val);
        }
        return '<td' + cls + title + '>' + val + '</td>';
      }).join('');
  }
  function renderTable() {
    const tableBody = $('#courseTableBody');
    if (!tableBody) return;

    if (filteredCourses.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="${tableColumns.length || 1}" class="empty-state">نتیجه‌ای یافت نشد</td></tr>`;
      return;
    }

    const rows = filteredCourses.map((c) => {
      const cells = renderCourseCells(c, tableColumns);
      return `<tr>${cells}</tr>`;
    });

    tableBody.innerHTML = rows.join('');
  }

  // ── Chips ──────────────────────────────────────────────────────
  function renderChips() {
    const activeFiltersEl = $('#activeFilters');
    if (!activeFiltersEl) return;

    if (activeFilters.length === 0) {
      activeFiltersEl.classList.remove('has-filters');
      activeFiltersEl.innerHTML = '';
      return;
    }

    activeFiltersEl.classList.add('has-filters');
    activeFiltersEl.innerHTML = activeFilters
      .map(
        (f, i) =>
          `<span class="filter-chip">
            <span class="chip-label">${esc(f.field)}:</span> ${esc(f.value)}
            <button class="chip-remove" data-index="${i}" title="حذف فیلتر">×</button>
          </span>`
      )
      .join('');
  }

  function updateCount() {
    const resultsCount = $('#resultsCount');
    if (resultsCount) {
      resultsCount.textContent = `${filteredCourses.length.toLocaleString('fa-IR')} نتیجه یافت شد`;
    }
  }

  // ── URL state ──────────────────────────────────────────────────
  function updateUrl() {
    const params = new URLSearchParams();
    const semesterSelect = $('#semesterSelect');
    const sem = semesterSelect ? semesterSelect.value : '';
    if (sem) params.set('sem', sem);

    // Mode
    const mode = getCurrentMode();
    if (mode !== 'browser') params.set('mode', mode);

    if (currentCategory !== 'همه') params.set('cat', currentCategory);
    if (currentGender !== 'همه') params.set('gender', currentGender);
    activeFilters.forEach((f) => params.append('f', `${f.field}:${f.value}`));
    if (sortField) {
      params.set('sort', sortField);
      params.set('dir', sortDir);
    }
    const hash = params.toString();
    history.replaceState(null, '', hash ? '#' + hash : window.location.pathname);
  }

  function restoreFromUrl() {
    currentCategory = 'همه';
    currentGender = 'همه';
    activeFilters = [];
    sortField = null;
    sortDir = 'asc';

    resetFilterButtons();

    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);

    const sem = params.get('sem');
    if (sem) {
      const semesterSelect = $('#semesterSelect');
      if (semesterSelect) semesterSelect.value = sem;
    }

    const cat = params.get('cat');
    if (cat && ['عمومی', 'تخصصی'].includes(cat)) {
      currentCategory = cat;
      $$('.cat-btn[data-cat]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.cat === cat);
        btn.setAttribute('aria-pressed', btn.dataset.cat === cat ? 'true' : 'false');
      });
    }

    const gender = params.get('gender');
    if (gender && ['برادران', 'خواهران'].includes(gender)) {
      currentGender = gender;
      $$('.cat-btn[data-gender]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.gender === gender);
        btn.setAttribute('aria-pressed', btn.dataset.gender === gender ? 'true' : 'false');
      });
    }

    const filterStrings = params.getAll('f');
    activeFilters = filterStrings.map((s) => {
      const [field, ...rest] = s.split(':');
      return { field, value: rest.join(':') };
    });

    const sf = params.get('sort');
    const sd = params.get('dir');
    if (sf && (sd === 'asc' || sd === 'desc')) {
      sortField = sf;
      sortDir = sd;
      $$('.table-wrapper th').forEach((t) => t.classList.remove('sort-asc', 'sort-desc'));
      const activeTh = $(`.table-wrapper th[data-sort="${sortField}"]`);
      if (activeTh) {
        activeTh.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    }

    // Restore mode
    const mode = params.get('mode');
    if (mode === 'schedule') {
      switchMode('schedule');
    }
  }

  // ── Filter management ─────────────────────────────────────────
  function addFilter(field) {
    const input = $(`[data-field="${field}"]`);
    if (!input || input.tagName !== 'INPUT') return;
    const val = input.value.trim();
    if (!val) return;

    const exists = activeFilters.some((f) => f.field === field && f.value === val);
    if (!exists) {
      activeFilters.push({ field, value: val });
    }
    input.value = '';
    hideAddButton(field);
    applyFilters();
  }

  function showAddButton(field) {
    const btn = $(`.btn-add[data-field="${field}"]`);
    if (btn) btn.classList.add('visible');
  }

  function hideAddButton(field) {
    const btn = $(`.btn-add[data-field="${field}"]`);
    if (btn) btn.classList.remove('visible');
  }

  function resetFilterButtons() {
    $$('.cat-btn').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    $$('.cat-btn[data-cat="همه"], .cat-btn[data-gender="همه"]').forEach((b) => {
      b.classList.add('active');
      b.setAttribute('aria-pressed', 'true');
    });
  }

  // ── Mode Switching ─────────────────────────────────────────────
  let currentMode = 'browser';

  function switchMode(mode) {
    currentMode = mode;
    const browserMode = $('#browserMode');
    const scheduleMode = $('#scheduleMode');
    const tabs = $$('.mode-tab');
    const exportBtns = $$('.btn-export');

    tabs.forEach((t) => {
      t.classList.toggle('active', t.dataset.mode === mode);
      t.setAttribute('aria-selected', t.dataset.mode === mode ? 'true' : 'false');
    });

    if (browserMode) browserMode.classList.toggle('mode-hidden', mode !== 'browser');
    if (scheduleMode) scheduleMode.classList.toggle('mode-hidden', mode !== 'schedule');

    // Hide browser-only elements in schedule mode
    exportBtns.forEach((btn) => { btn.style.display = mode === 'browser' ? '' : 'none'; });

    // Notify mode change
    _modeChangeCallbacks.forEach(function (fn) { fn(mode); });
  }

  function getCurrentMode() {
    return currentMode;
  }

  // ── Schedule parsing ──────────────────────────────────────────
  const DAY_NAMES = {
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

  const DAY_ORDER = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه'];

  function normalizeDay(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();
    return DAY_NAMES[trimmed] || null;
  }

  function parseSchedule(scheduleStr) {
    if (!scheduleStr || !scheduleStr.trim()) return [];

    const slots = [];
    // Match: dayName  از  HH:MM  تا  HH:MM
    // Handles multi-word day names and multiple slots in one string
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

  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // ── Timetable positioning ─────────────────────────────────────
  var TT_HOURS_START = 7;
  var TT_HOURS_END = 22;
  var TT_TOTAL_MIN = (TT_HOURS_END - TT_HOURS_START) * 60; // 900
  var TT_GRID_END_MIN = TT_HOURS_END * 60;                 // 1320
  var TT_DAY_LABEL_WIDTH = 32;

  function timetableScaleFactor(overlayEl) {
    if (!overlayEl) return 1;
    return (overlayEl.offsetWidth - TT_DAY_LABEL_WIDTH) / overlayEl.offsetWidth;
  }

  function timetableLeftPct(endMinutes, scaleFactor) {
    return ((TT_GRID_END_MIN - endMinutes) / TT_TOTAL_MIN) * 100 * scaleFactor;
  }

  function timetableWidthPct(durationMinutes, scaleFactor) {
    return (durationMinutes / TT_TOTAL_MIN) * 100 * scaleFactor;
  }

  // ── Callback hooks (setters push to arrays, not replace) ───────
  var _coursesLoadedCallbacks = [];
  var _modeChangeCallbacks = [];
  var _filtersChangedCallbacks = [];

  // ── Expose public API ─────────────────────────────────────────
  window.IAU = {
    // State
    get allCourses() { return allCourses; },
    set allCourses(v) { allCourses = v; },
    get filteredCourses() { return filteredCourses; },
    set filteredCourses(v) { filteredCourses = v; },
    get semesters() { return semesters; },
    set semesters(v) { semesters = v; },
    get tableColumns() { return tableColumns; },
    set tableColumns(v) { tableColumns = v; },
    get activeFilters() { return activeFilters; },
    set activeFilters(v) { activeFilters = v; },
    get currentCategory() { return currentCategory; },
    set currentCategory(v) { currentCategory = v; },
    get currentGender() { return currentGender; },
    set currentGender(v) { currentGender = v; },
    get sortField() { return sortField; },
    set sortField(v) { sortField = v; },
    get sortDir() { return sortDir; },
    set sortDir(v) { sortDir = v; },

    // Constants
    LONG_COLS,
    CENTER_COLS,
    DAY_NAMES,
    DAY_ORDER,

    // Helpers
    $,
    $$,
    esc,
    escAttr,
    toJalali,
    formatJalaliDate,
    showError,
    hideError,

    // Data
    loadSemesters,
    loadCourses,

    // Filtering & Sorting
    applyFilters,
    applySort,
    matchField,
    genderMatches,

    // Rendering
    buildTableHeader,
    renderTable,
    renderCourseCells,
    renderChips,
    updateCount,

    // URL
    updateUrl,
    restoreFromUrl,

    // Filter management
    addFilter,
    showAddButton,
    hideAddButton,
    resetFilterButtons,

    // Mode
    switchMode,
    getCurrentMode,

    // Schedule parsing
    parseSchedule,
    timeToMinutes,
    minutesToTime,
    normalizeDay,

    // Timetable positioning
    TT_HOURS_START,
    TT_HOURS_END,
    TT_TOTAL_MIN,
    TT_GRID_END_MIN,
    timetableScaleFactor,
    timetableLeftPct,
    timetableWidthPct,

    // Callbacks
    get onCoursesLoaded() { return _coursesLoadedCallbacks; },
    set onCoursesLoaded(fn) { if (typeof fn === 'function') _coursesLoadedCallbacks.push(fn); },
    get onModeChange() { return _modeChangeCallbacks; },
    set onModeChange(fn) { if (typeof fn === 'function') _modeChangeCallbacks.push(fn); },
    get onFiltersChanged() { return _filtersChangedCallbacks; },
    set onFiltersChanged(fn) { if (typeof fn === 'function') _filtersChangedCallbacks.push(fn); }
  };
})();
