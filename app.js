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
    'نام کلاس درس', 'مکان برگزاری', 'نام گروه آموزشی'
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
    } catch (err) {
      console.error('Failed to load semesters:', err);
      semesters = [];
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
    try {
      const res = await fetch(`data/${nemesterId}/courses.json`);
      const data = await res.json();

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
    }

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
      if (LONG_COLS.has(col)) th.classList.add('col-long');
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      th.appendChild(arrow);

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
        const className = (c['نام کلاس درس'] || '').trim();
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
        const cls = LONG_COLS.has(col) ? ' class="col-long"' : '';
        const title = LONG_COLS.has(col) ? ` title="${esc(val)}"` : '';
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
      });
    }

    // Gender
    const gender = params.get('gender');
    if (gender && ['برادران', 'خواهران'].includes(gender)) {
      currentGender = gender;
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

    doc.setFont('helvetica');
    doc.setFontSize(14);
    doc.text('Course List', 40, 35);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`${filteredCourses.length} results`, 40, 52);
    doc.setTextColor(0);

    const head = [tableColumns];
    const body = filteredCourses.map((c) => tableColumns.map((col) => c[col] || ''));

    doc.autoTable({
      head,
      body,
      startY: 60,
      styles: { fontSize: 7, cellPadding: 4, halign: 'center', overflow: 'linebreak' },
      headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 250] },
      margin: { top: 60 },
    });

    doc.save('courses.pdf');
  }

  // ── Export: XLSX ───────────────────────────────────────────────
  function exportXlsx() {
    if (!filteredCourses.length) return;

    const data = filteredCourses.map((c) => tableColumns.map((col) => c[col] || ''));
    const ws = XLSX.utils.aoa_to_sheet([tableColumns, ...data]);
    ws['!cols'] = tableColumns.map(() => ({ wch: 20 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Courses');
    XLSX.writeFile(wb, 'courses.xlsx');
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
      $$('.cat-btn').forEach((b) => b.classList.remove('active'));
      $$('.cat-btn[data-cat="همه"]').forEach((b) => b.classList.add('active'));
      $$('.btn-add').forEach((btn) => btn.classList.remove('visible'));
      loadCourses(semesterSelect.value);
    });

    // Category buttons
    $$('.cat-btn[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentCategory = btn.dataset.cat;
        $$('.cat-btn[data-cat]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        applyFilters();
      });
    });

    // Gender buttons
    $$('.cat-btn[data-gender]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentGender = btn.dataset.gender;
        $$('.cat-btn[data-gender]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
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

      $$('.cat-btn').forEach((b) => b.classList.remove('active'));
      $$('.cat-btn[data-cat="همه"]').forEach((b) => b.classList.add('active'));
      $$('.cat-btn[data-gender="همه"]').forEach((b) => b.classList.add('active'));

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

    // Hash change for back/forward navigation
    window.addEventListener('hashchange', () => {
      activeFilters = [];
      sortField = null;
      sortDir = 'asc';
      currentCategory = 'همه';
      $$('.cat-btn').forEach((b) => b.classList.remove('active'));
      $$('.cat-btn[data-cat="همه"]').forEach((b) => b.classList.add('active'));
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
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
