/**
 * Course Browser — Dynamic columns, نیمسال support, filtering, sorting, search, and export
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

  // Columns that get truncated with ellipsis
  const LONG_COLS = new Set([
    'نام درس', 'نام استاد', 'زمانبندی تشکیل کلاس',
    'نام کلاس', 'مکان برگزاری', 'نام گروه آموزشی'
  ]);

  // Columns that should be center-aligned (short values)
  const CENTER_COLS = new Set([
    'نوع درس', 'نوع واحد', 'جنسیت', 'ظرفیت', 'مقطع ارائه'
  ]);

  // ── DOM refs ───────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const tableHead = $('#courseTableHead');
  const tableBody = $('#courseTableBody');
  const resultsCount = $('#resultsCount');
  const activeFiltersEl = $('#activeFilters');
  const updateDateEl = $('#updateDate');
  const semesterSelect = $('#semesterSelect');
  const errorBanner = $('#errorBanner');
  const errorBannerText = $('#errorBannerText');
  const errorBannerClose = $('#errorBannerClose');

  // ── Error banner helpers ─────────────────────────────────────────
  function showError(message) {
    errorBannerText.textContent = message;
    errorBanner.classList.add('visible');
  }

  function hideError() {
    errorBanner.classList.remove('visible');
  }

  // ── Persian date helpers ───────────────────────────────────────
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
    const jd = toJalali(y, m, d);
    const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
    return `${jd.jd} ${months[jd.jm - 1]} ${jd.jy}`;
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

    // Populate dropdown
    semesterSelect.innerHTML = semesters.map((s) =>
      `<option value="${s.id}">${s.id} — ${s.title}</option>`
    ).join('');

    // Select latest (first in list, already sorted desc)
    if (semesters.length > 0) {
      semesterSelect.value = semesters[0].id;
    }
  }

  // ── Load courses for selected نیمسال ───────────────────────────
  async function loadCourses(nemesterId) {
    // Show skeleton loading
    const skeleton = $('#skeletonWrapper');
    if (skeleton) skeleton.classList.add('visible');

    try {
      const res = await fetch(`data/${nemesterId}/courses.json`);
      const data = await res.json();
      hideError();

      // New wrapper format
      if (data.دروس && Array.isArray(data.دروس)) {
        allCourses = data.دروس;

        // Extract columns from first course
        if (allCourses.length > 0) {
          tableColumns = Object.keys(allCourses[0]);
        }

        // Update date
        if (data['تاریخ به‌روزرسانی']) {
          updateDateEl.textContent = `آخرین به‌روزرسانی: ${formatJalaliDate(data['تاریخ به‌روزرسانی'])}`;
        }
      } else {
        // Legacy flat array format fallback
        allCourses = data;
        if (allCourses.length > 0) {
          tableColumns = Object.keys(allCourses[0]);
        }
        updateDateEl.textContent = '';
      }
    } catch (err) {
      console.error('Failed to load courses:', err);
      allCourses = [];
      tableColumns = [];
      showError('خطا در بارگذاری دروس. لطفاً اتصال اینترنت خود را بررسی کنید.');
    }

    // Hide skeleton, show table
    if (skeleton) skeleton.classList.remove('visible');

    buildTableHeader();
    applyFilters();
  }

  // ── Build dynamic table header ─────────────────────────────────
  function buildTableHeader() {
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

  // ── Filtering ──────────────────────────────────────────────────
  function applyFilters() {
    let result = allCourses;

    // Category filter
    if (currentCategory !== 'همه') {
      result = result.filter((c) => c['نوع واحد'] === currentCategory);
    }

    // Gender filter (only for همه/عمومی categories)
    if (currentCategory !== 'تخصصی' && currentGender !== 'همه') {
      result = result.filter((c) => {
        const gender = (c['جنسیت'] || '').trim();
        const className = (c['نام کلاس'] || '').trim();
        const unitType = (c['نوع واحد'] || '').trim();

        // Always include تخصصی courses (they have no gender assignment)
        if (unitType === 'تخصصی') return true;

        // For عمومی courses, match gender
        if (currentGender === 'خواهران') {
          return gender === 'زن' || className.includes('خواهران');
        }
        if (currentGender === 'برادران') {
          return gender === 'مرد' || className.includes('برادران');
        }
        return true;
      });
    }

    // Search filters: OR within each field, AND across fields
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

    // Show/hide gender filter based on category
    const genderFilterEl = $('#genderFilter');
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

    // Show clear button only when filters are active
    const hasActiveFilters = activeFilters.length > 0 || currentCategory !== 'همه' || currentGender !== 'همه';
    $('#btnClear').style.display = hasActiveFilters ? '' : 'none';
  }

  function matchField(cellValue, query, field) {
    const cell = (cellValue || '').toString().trim();
    const q = query.trim();
    if (!q) return true;
    // Partial match for text fields
    if (field === 'نام درس' || field === 'نام استاد') {
      return cell.includes(q);
    }
    // Exact match for code fields
    return cell === q;
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

  // ── Render ─────────────────────────────────────────────────────
  function renderTable() {
    if (filteredCourses.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="${tableColumns.length || 1}" class="empty-state">نتیجه‌ای یافت نشد</td></tr>`;
      return;
    }

    const rows = filteredCourses.map((c) => {
      const cells = tableColumns.map((col) => {
        let val = c[col] || '';
        const cls = LONG_COLS.has(col) ? ' class="col-long"' : CENTER_COLS.has(col) ? ' class="col-center"' : '';
        const title = LONG_COLS.has(col) ? ` title="${escAttr(val)}"` : '';
        // Badge for نوع واحد
        if (col === 'نوع واحد') {
          const badgeClass = val === 'عمومی' ? 'badge-general' : 'badge-specialized';
          val = `<span class="badge ${badgeClass}">${esc(val)}</span>`;
        } else {
          val = esc(val);
        }
        return `<td${cls}${title}>${val}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    });

    tableBody.innerHTML = rows.join('');
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = (str || '').toString();
    return d.innerHTML;
  }

  function escAttr(str) {
    return (str || '').toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function updateCount() {
    resultsCount.textContent = `${filteredCourses.length.toLocaleString('fa-IR')} نتیجه یافت شد`;
  }

  // ── Chips ──────────────────────────────────────────────────────
  function renderChips() {
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

  // ── URL state ──────────────────────────────────────────────────
  function updateUrl() {
    const params = new URLSearchParams();
    const sem = semesterSelect.value;
    if (sem) params.set('sem', sem);
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
    // Reset to defaults first so stale state never leaks through
    currentCategory = 'همه';
    currentGender = 'همه';
    activeFilters = [];
    sortField = null;
    sortDir = 'asc';

    // Reset button active classes
    $$('.cat-btn').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    $$('.cat-btn[data-cat="همه"]').forEach((b) => {
      b.classList.add('active');
      b.setAttribute('aria-pressed', 'true');
    });
    $$('.cat-btn[data-gender="همه"]').forEach((b) => {
      b.classList.add('active');
      b.setAttribute('aria-pressed', 'true');
    });

    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);

    // Semester
    const sem = params.get('sem');
    if (sem) {
      semesterSelect.value = sem;
    }

    // Category
    const cat = params.get('cat');
    if (cat && ['عمومی', 'تخصصی'].includes(cat)) {
      currentCategory = cat;
      $$('.cat-btn[data-cat]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.cat === cat);
        btn.setAttribute('aria-pressed', btn.dataset.cat === cat ? 'true' : 'false');
      });
    }

    // Gender
    const gender = params.get('gender');
    if (gender && ['برادران', 'خواهران'].includes(gender)) {
      currentGender = gender;
      $$('.cat-btn[data-gender]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.gender === gender);
        btn.setAttribute('aria-pressed', btn.dataset.gender === gender ? 'true' : 'false');
      });
    }

    // Filters
    const filterStrings = params.getAll('f');
    activeFilters = filterStrings.map((s) => {
      const [field, ...rest] = s.split(':');
      return { field, value: rest.join(':') };
    });

    // Sort
    const sf = params.get('sort');
    const sd = params.get('dir');
    if (sf && (sd === 'asc' || sd === 'desc')) {
      sortField = sf;
      sortDir = sd;
      // Restore sort indicator on column header
      $$('.table-wrapper th').forEach((t) => t.classList.remove('sort-asc', 'sort-desc'));
      const activeTh = $(`.table-wrapper th[data-sort="${sortField}"]`);
      if (activeTh) {
        activeTh.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    }
  }

  // ── Add filter from input ──────────────────────────────────────
  function addFilter(field) {
    const input = $(`[data-field="${field}"]`);
    if (!input || input.tagName !== 'INPUT') return;
    const val = input.value.trim();
    if (!val) return;

    // Don't duplicate
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

  // ── Export: PDF (Browser Print) ─────────────────────────────────
  // Columns to hide in PDF output
  const PDF_HIDDEN_COLS = new Set(['کد گروه آموزشی', 'نام گروه آموزشی', 'سطح ارائه']);

  function exportPdf() {
    if (!filteredCourses.length) return;

    // Temporarily hide unwanted columns by index
    const hiddenCells = [];
    $$('.table-wrapper th, .table-wrapper td').forEach((el) => {
      const colIndex = Array.from(el.parentElement.children).indexOf(el);
      const colName = tableColumns[colIndex];
      if (PDF_HIDDEN_COLS.has(colName)) {
        el.style.display = 'none';
        hiddenCells.push(el);
      }
    });

    document.body.classList.add('printing');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing');
      // Restore hidden cells
      hiddenCells.forEach((el) => { el.style.display = ''; });
    }, 1000);
  }

  // ── Export: XLSX (ExcelJS) ─────────────────────────────────────
  async function exportXlsx() {
    if (!filteredCourses.length) return;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Courses', {
      views: [{ rightToLeft: true }]
    });

    // Add header row
    ws.addRow(tableColumns);
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF404040' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
    headerRow.height = 22;

    // Add data rows
    const narrowCols = ['ظرفیت', 'کد درس', 'کد ارائه', 'جنسیت', 'نوع درس', 'نوع واحد', 'مقطع ارائه', 'سطح ارائه', 'کد گروه آموزشی'];
    filteredCourses.forEach((c) => {
      ws.addRow(tableColumns.map((col) => c[col] || ''));
    });

    // Style data rows — alternating colors, vertical center, center short columns
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const isEven = r % 2 === 0;
      row.height = 20;
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const colName = tableColumns[colNum - 1];
        cell.alignment = {
          horizontal: narrowCols.includes(colName) ? 'center' : 'right',
          vertical: 'center'
        };
        if (isEven) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        }
      });
    }

    // Auto-fit column widths (capped)
    ws.columns.forEach((col, i) => {
      const colName = tableColumns[i];
      let maxLen = colName.length;
      col.eachCell({ includeEmpty: false }, (cell) => {
        const val = (cell.value || '').toString();
        maxLen = Math.max(maxLen, val.length);
      });
      let cap = 40;
      if (narrowCols.includes(colName)) cap = 15;
      if (colName.includes('زمانبندی')) cap = 80;
      col.width = Math.min(maxLen + 2, cap);
    });

    // Freeze header row + RTL
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];

    // Auto filter
    ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + tableColumns.length)}1` };

    // Download
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'courses.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Event listeners ────────────────────────────────────────────
  async function init() {
    // Restore URL state first
    restoreFromUrl();

    // Load semesters, then courses
    await loadSemesters();
    const sem = semesterSelect.value;
    if (sem) {
      await loadCourses(sem);
    }

    // Semester dropdown
    semesterSelect.addEventListener('change', () => {
      sortField = null;
      sortDir = 'asc';
      activeFilters = [];
      currentCategory = 'همه';
      currentGender = 'همه';
      $$('.cat-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      $$('.cat-btn[data-cat="همه"]').forEach((b) => {
        b.classList.add('active');
        b.setAttribute('aria-pressed', 'true');
      });
      $$('.cat-btn[data-gender="همه"]').forEach((b) => {
        b.classList.add('active');
        b.setAttribute('aria-pressed', 'true');
      });
      $$('.btn-add').forEach((btn) => btn.classList.remove('visible'));
      loadCourses(semesterSelect.value);
    });

    // Category buttons
    $$('.cat-btn[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentCategory = btn.dataset.cat;
        $$('.cat-btn[data-cat]').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        applyFilters();
      });
    });

    // Gender buttons
    $$('.cat-btn[data-gender]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentGender = btn.dataset.gender;
        $$('.cat-btn[data-gender]').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        applyFilters();
      });
    });

    // Search inputs — show + button on input, Enter to apply
    $$('.search-field input').forEach((input) => {
      const field = input.dataset.field;
      input.addEventListener('input', () => {
        if (input.value.trim()) {
          showAddButton(field);
        } else {
          hideAddButton(field);
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addFilter(field);
        }
      });
    });

    // + buttons
    $$('.btn-add').forEach((btn) => {
      btn.addEventListener('click', () => {
        addFilter(btn.dataset.field);
      });
    });

    // Remove chip
    activeFiltersEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip-remove');
      if (!chip) return;
      const index = parseInt(chip.dataset.index, 10);
      activeFilters.splice(index, 1);
      applyFilters();
    });

    // Clear filters
    $('#btnClear').addEventListener('click', () => {
      currentCategory = 'همه';
      currentGender = 'همه';
      activeFilters = [];
      sortField = null;
      sortDir = 'asc';

      $$('.cat-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      $$('.cat-btn[data-cat="همه"]').forEach((b) => {
        b.classList.add('active');
        b.setAttribute('aria-pressed', 'true');
      });
      $$('.cat-btn[data-gender="همه"]').forEach((b) => {
        b.classList.add('active');
        b.setAttribute('aria-pressed', 'true');
      });

      $$('.search-field input').forEach((input) => {
        input.value = '';
      });
      $$('.btn-add').forEach((btn) => btn.classList.remove('visible'));
      $$('.table-wrapper th').forEach((t) => t.classList.remove('sort-asc', 'sort-desc'));

      applyFilters();
    });

    // Export buttons
    $('#btnPdf').addEventListener('click', exportPdf);
    $('#btnXlsx').addEventListener('click', exportXlsx);

    // Error banner close
    errorBannerClose.addEventListener('click', hideError);

    // Hash change for back/forward navigation
    window.addEventListener('hashchange', () => {
      restoreFromUrl();
      loadCourses(semesterSelect.value);
    });

    // Scroll to top button
    const scrollTopBtn = $('#scrollTop');
    window.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('visible', window.scrollY > 400);
    });
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // ── Theme Toggle ──────────────────────────────────────────────
    const themeToggle = $('#themeToggle');
    const htmlEl = document.documentElement;

    // Restore saved theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    htmlEl.setAttribute('data-theme', savedTheme);
    themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

    themeToggle.addEventListener('click', () => {
      const newTheme = htmlEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      htmlEl.setAttribute('data-theme', newTheme);
      themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
      localStorage.setItem('theme', newTheme);
    });
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
