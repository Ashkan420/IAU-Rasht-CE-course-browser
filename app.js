/**
 * Course Browser — Mode-specific logic (event bindings, export)
 * Shared utilities live in shared.js via window.IAU
 */
(function () {
  'use strict';

  const S = window.IAU;
  const { $, $$, esc, escAttr } = S;

  // ── Export: PDF (Browser Print) ─────────────────────────────────
  const PDF_HIDDEN_COLS = new Set(['کد گروه آموزشی', 'نام گروه آموزشی', 'سطح ارائه']);
  const PDF_NUM_COLS = new Set(['کد درس', 'کد ارائه', 'ظرفیت', 'کد گروه آموزشی']);

  function exportPdf() {
    if (!S.filteredCourses.length) return;

    const hiddenCells = [];
    $$('.table-wrapper th, .table-wrapper td').forEach((el) => {
      const colIndex = Array.from(el.parentElement.children).indexOf(el);
      const colName = S.tableColumns[colIndex];
      if (PDF_HIDDEN_COLS.has(colName)) {
        el.style.display = 'none';
        hiddenCells.push(el);
      }
      if (PDF_NUM_COLS.has(colName)) {
        el.classList.add('code');
      }
    });

    document.body.classList.add('printing');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing');
      hiddenCells.forEach((el) => { el.style.display = ''; });
      $$('.table-wrapper .code').forEach((el) => { el.classList.remove('code'); });
    }, 1000);
  }

  // ── Export: XLSX (ExcelJS) ─────────────────────────────────────
  async function exportXlsx() {
    if (!S.filteredCourses.length) return;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Courses', {
      views: [{ rightToLeft: true }]
    });

    ws.addRow(S.tableColumns);
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF404040' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
    headerRow.height = 22;

    const narrowCols = ['ظرفیت', 'کد درس', 'کد ارائه', 'جنسیت', 'نوع درس', 'نوع واحد', 'مقطع ارائه', 'سطح ارائه', 'کد گروه آموزشی'];
    S.filteredCourses.forEach((c) => {
      ws.addRow(S.tableColumns.map((col) => c[col] || ''));
    });

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const isEven = r % 2 === 0;
      row.height = 20;
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const colName = S.tableColumns[colNum - 1];
        cell.alignment = {
          horizontal: narrowCols.includes(colName) ? 'center' : 'right',
          vertical: 'center'
        };
        if (isEven) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        }
      });
    }

    ws.columns.forEach((col, i) => {
      const colName = S.tableColumns[i];
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

    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + S.tableColumns.length)}1` };

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'courses.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Init ───────────────────────────────────────────────────────
  async function init() {
    // Register callbacks BEFORE loadCourses
    S.onCoursesLoaded = function () {
      S.buildTableHeader();
      S.applyFilters();
    };
    S.onModeChange = function (mode) {
      // schedule.js registers its own handler via the array
    };

    S.restoreFromUrl();

    await S.loadSemesters();
    const semesterSelect = $('#semesterSelect');
    const sem = semesterSelect ? semesterSelect.value : '';
    if (sem) {
      await S.loadCourses(sem);
    }

    // Semester dropdown
    if (semesterSelect) {
      semesterSelect.addEventListener('change', () => {
        S.sortField = null;
        S.sortDir = 'asc';
        S.activeFilters = [];
        S.currentCategory = 'همه';
        S.currentGender = 'همه';
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
        S.loadCourses(semesterSelect.value);
      });
    }

    // Category buttons
    $$('.cat-btn[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.currentCategory = btn.dataset.cat;
        $$('.cat-btn[data-cat]').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        S.applyFilters();
      });
    });

    // Gender buttons
    $$('.cat-btn[data-gender]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.currentGender = btn.dataset.gender;
        $$('.cat-btn[data-gender]').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        S.applyFilters();
      });
    });

    // Search inputs
    $$('.search-field input').forEach((input) => {
      const field = input.dataset.field;
      input.addEventListener('input', () => {
        if (input.value.trim()) {
          S.showAddButton(field);
        } else {
          S.hideAddButton(field);
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          S.addFilter(field);
        }
      });
    });

    // + buttons
    $$('.btn-add').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.addFilter(btn.dataset.field);
      });
    });

    // Remove chip
    const activeFiltersEl = $('#activeFilters');
    if (activeFiltersEl) {
      activeFiltersEl.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip-remove');
        if (!chip) return;
        const index = parseInt(chip.dataset.index, 10);
        S.activeFilters.splice(index, 1);
        S.applyFilters();
      });
    }

    // Clear filters
    const btnClear = $('#btnClear');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        S.currentCategory = 'همه';
        S.currentGender = 'همه';
        S.activeFilters = [];
        S.sortField = null;
        S.sortDir = 'asc';

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

        S.applyFilters();
      });
    }

    // Export buttons
    const btnPdf = $('#btnPdf');
    const btnXlsx = $('#btnXlsx');
    if (btnPdf) btnPdf.addEventListener('click', exportPdf);
    if (btnXlsx) btnXlsx.addEventListener('click', exportXlsx);

    // Error banner close
    const errorBannerClose = $('#errorBannerClose');
    if (errorBannerClose) errorBannerClose.addEventListener('click', S.hideError);

    // Hash change
    window.addEventListener('hashchange', () => {
      S.restoreFromUrl();
      const semesterSelect = $('#semesterSelect');
      if (semesterSelect) S.loadCourses(semesterSelect.value);
    });

    // Scroll to top
    const scrollTopBtn = $('#scrollTop');
    if (scrollTopBtn) {
      window.addEventListener('scroll', () => {
        scrollTopBtn.classList.toggle('visible', window.scrollY > 400);
      });
      scrollTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Theme Toggle
    const themeToggle = $('#themeToggle');
    const htmlEl = document.documentElement;
    const savedTheme = localStorage.getItem('theme') || 'dark';
    htmlEl.setAttribute('data-theme', savedTheme);
    if (themeToggle) themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const newTheme = htmlEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        htmlEl.setAttribute('data-theme', newTheme);
        themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
        localStorage.setItem('theme', newTheme);
      });
    }

    // Mode switcher
    $$('.mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        S.switchMode(tab.dataset.mode);
        S.updateUrl();
      });
    });
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
