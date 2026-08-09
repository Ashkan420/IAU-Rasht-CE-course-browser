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

  // ── Export: PDF ────────────────────────────────────────────────
  function exportPdf() {
    if (!filteredCourses.length) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a4' });

    // Build an HTML table so the browser renders Vazirmatn (Persian) natively
    const headerRow = tableColumns.map((col) => `<th style="padding:8px 12px;background:#1e1e1e;color:#fff;font-weight:bold;border:1px solid #333;font-size:9px;">${esc(col)}</th>`).join('');
    const bodyRows = filteredCourses.map((c) => {
      const cells = tableColumns.map((col) => `<td style="padding:6px 10px;border:1px solid #ddd;font-size:8px;">${esc(c[col] || '')}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const html = `
      <div dir="rtl" style="font-family:Vazirmatn,sans-serif;padding:20px;">
        <h2 style="font-size:16px;margin-bottom:4px;">لیست دروس</h2>
        <p style="font-size:10px;color:#888;margin-bottom:16px;">${filteredCourses.length.toLocaleString('fa-IR')} نتیجه</p>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>${headerRow}</tr></thead>
          <tbody>${bodyRows.join('')}</tbody>
        </table>
      </div>`;

    doc.html(html, {
      callback: function (doc) {
        doc.save('courses.pdf');
      },
      x: 10,
      y: 10,
      width: 820,
      windowWidth: 1100,
    });
  }

  // ── Export: XLSX ───────────────────────────────────────────────
  function exportXlsx() {
    if (!filteredCourses.length) return;

    const data = filteredCourses.map((c) => tableColumns.map((col) => c[col] || ''));
    const ws = XLSX.utils.aoa_to_sheet([tableColumns, ...data]);

    // Auto-fit column widths (capped like scraper)
    const narrowCols = ['ظرفیت', 'کد درس', 'کد ارائه', 'جنسیت', 'نوع درس', 'نوع واحد', 'مقطع ارائه', 'سطح ارائه', 'کد گروه آموزشی'];
    tableColumns.forEach((col, i) => {
      let maxLen = col.length;
      for (const c of filteredCourses) {
        const val = (c[col] || '').toString();
        maxLen = Math.max(maxLen, val.length);
      }
      let cap = 40;
      if (narrowCols.includes(col)) cap = 15;
      if (col.includes('زمانبندی')) cap = 80;
      ws['!cols'][i] = { wch: Math.min(maxLen + 2, cap) };
    });

    // Freeze header row + auto filter
    ws.freeze_panes = 'A2';
    ws.auto_filter.ref = ws.dimensions;

    // RTL
    ws.sheet_view = ws.sheet_view || {};
    ws.sheet_view.rightToLeft = true;

    // Landscape A4 print settings
    ws.page_setup = { orientation: 'landscape', paperSize: 9, fitToWidth: 1, fitToHeight: 0 };
    ws.sheet_properties = { pageSetUpPr: { fitToPage: true } };

    // Style header row
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) {
        ws[addr].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
          fill: { fgColor: { rgb: '1E1E1E' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
        };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Courses');
    XLSX.writeFile(wb, 'courses.xlsx', { cellStyles: true });
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
