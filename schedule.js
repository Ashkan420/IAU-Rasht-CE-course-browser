/**
 * Schedule Builder — timetable, course selection, conflict detection, statistics
 * Depends on shared.js via window.IAU
 */
(function () {
  'use strict';

  var S = window.IAU;
  var $ = S.$;
  var $$ = S.$$;
  var esc = S.esc;
  var escAttr = S.escAttr;

  // ── Constants ──────────────────────────────────────────────────
  var HOURS_START = 7;
  var HOURS_END = 22;
  var HOURS_COUNT = HOURS_END - HOURS_START; // 15

  var TIMETABLE_COLORS = [
    { bg: 'rgba(129,140,248,0.25)', border: 'rgba(129,140,248,0.5)', text: '#a5b4fc' },
    { bg: 'rgba(52,211,153,0.25)', border: 'rgba(52,211,153,0.5)', text: '#6ee7b7' },
    { bg: 'rgba(251,191,36,0.25)', border: 'rgba(251,191,36,0.5)', text: '#fcd34d' },
    { bg: 'rgba(244,114,182,0.25)', border: 'rgba(244,114,182,0.5)', text: '#f9a8d4' },
    { bg: 'rgba(56,189,248,0.25)', border: 'rgba(56,189,248,0.5)', text: '#7dd3fc' },
    { bg: 'rgba(167,139,250,0.25)', border: 'rgba(167,139,250,0.5)', text: '#c4b5fd' },
    { bg: 'rgba(248,113,113,0.25)', border: 'rgba(248,113,113,0.5)', text: '#fca5a5' },
    { bg: 'rgba(74,222,128,0.25)', border: 'rgba(74,222,128,0.5)', text: '#86efac' },
  ];

  // Columns to hide in the schedule course table
  var SCHEDULE_HIDDEN_COLS = new Set([
    'نوع واحد', 'جنسیت', 'مقطع ارائه', 'مکان برگزاری',
    'نام گروه آموزشی', 'کد گروه آموزشی', 'سطح ارائه'
  ]);

  // ── State ──────────────────────────────────────────────────────
  var selectedSections = []; // Array of full course objects
  var courseCodeIndex = {};  // courseCode -> [course, course, ...]
  var sectionIndex = {};     // sectionCode -> course
  var colorMap = {};         // courseCode -> color index
  var nextColor = 0;

  // ── Indexing ───────────────────────────────────────────────────
  function buildIndex() {
    courseCodeIndex = {};
    sectionIndex = {};
    S.allCourses.forEach(function (c) {
      var code = c['کد درس'];
      var section = c['کد ارائه'];
      if (!courseCodeIndex[code]) courseCodeIndex[code] = [];
      courseCodeIndex[code].push(c);
      if (section) sectionIndex[section] = c;
    });
  }

  function assignColor(courseCode) {
    if (colorMap[courseCode] !== undefined) return colorMap[courseCode];
    colorMap[courseCode] = nextColor % TIMETABLE_COLORS.length;
    nextColor++;
    return colorMap[courseCode];
  }

  // ── Timetable ──────────────────────────────────────────────────
  var QUARTER_COLS = HOURS_COUNT * 4; // 60 columns (15min each)

  function buildTimetable() {
    var timetable = $('#timetable');
    if (!timetable) return;

    var html = '';

    // Header row: hours reversed (21→07), day label at end (right side)
    html += '<div class="tt-row tt-header">';
    for (var hi = 0; hi < HOURS_COUNT; hi++) {
      var hour = HOURS_END - 1 - hi; // 21, 20, 19, ..., 07
      html += '<div class="tt-cell tt-hour">' + S.minutesToTime(hour * 60) + '</div>';
    }
    html += '<div class="tt-cell tt-day-label tt-header-day">روز</div>';
    html += '</div>';

    // Day rows: 60 quarter-cells, day label at end (right), overlay on left
    S.DAY_ORDER.forEach(function (day) {
      html += '<div class="tt-row" data-day="' + day + '">';
      for (var q = 0; q < QUARTER_COLS; q++) {
        var cls = 'tt-cell tt-slot';
        if (q % 4 === 0) cls += ' tt-hour-mark';
        else if (q % 4 === 2) cls += ' tt-half-mark';
        html += '<div class="' + cls + '"></div>';
      }
      html += '<div class="tt-cell tt-day-label">' + day + '</div>';
      html += '<div class="tt-overlay"></div>';
      html += '</div>';
    });

    timetable.innerHTML = html;
  }

  function renderTimetableBlocks() {
    var timetable = $('#timetable');
    if (!timetable) return;

    // Remove old blocks and hatches
    timetable.querySelectorAll('.tt-block, .tt-hatch').forEach(function (el) { el.remove(); });

    var totalMin = HOURS_COUNT * 60;
    var gridEndMin = HOURS_END * 60; // 22:00 in absolute minutes

    // RTL block positioning: offset from grid end (21:00 = left edge)
    function rtlLeftPct(endMinutes) {
      return ((gridEndMin - endMinutes) / totalMin) * 100;
    }
    function widthPct(durationMinutes) {
      return (durationMinutes / totalMin) * 100;
    }

    selectedSections.forEach(function (course) {
      var slots = S.parseSchedule(course['زمانبندی تشکیل کلاس']);
      if (slots.length === 0) return;

      var colorIdx = assignColor(course['کد درس']);
      var color = TIMETABLE_COLORS[colorIdx];
      var sectionCode = course['کد ارائه'];
      var name = esc(course['نام درس']);
      var prof = esc(course['نام استاد']);

      // Group slots by day for hatch rendering
      var slotsByDay = {};
      slots.forEach(function (slot) {
        if (!slotsByDay[slot.day]) slotsByDay[slot.day] = [];
        slotsByDay[slot.day].push(slot);
      });

      Object.keys(slotsByDay).forEach(function (day) {
        var daySlots = slotsByDay[day];
        var dayRow = timetable.querySelector('.tt-row[data-day="' + day + '"]');
        if (!dayRow) return;
        var overlay = dayRow.querySelector('.tt-overlay');
        if (!overlay) return;

        // Sort by start time
        daySlots.sort(function (a, b) {
          return S.timeToMinutes(a.start) - S.timeToMinutes(b.start);
        });

        // Render blocks
        daySlots.forEach(function (slot) {
          var startMin = S.timeToMinutes(slot.start);
          var endMin = S.timeToMinutes(slot.end);
          var dur = endMin - startMin;

          var block = document.createElement('div');
          block.className = 'tt-block';
          block.style.left = rtlLeftPct(endMin) + '%';
          block.style.width = widthPct(dur) + '%';
          block.style.background = color.bg;
          block.style.borderColor = color.border;
          block.style.color = color.text;
          block.dataset.section = sectionCode;

          block.innerHTML =
            '<span class="tt-block-name">' + name + '</span>' +
            '<span class="tt-block-prof">' + prof + '</span>' +
            '<span class="tt-block-time">' + slot.end + ' – ' + slot.start + '</span>';

          overlay.appendChild(block);
        });

        // Render hatched connectors between consecutive blocks
        for (var j = 0; j < daySlots.length - 1; j++) {
          var gapStart = S.timeToMinutes(daySlots[j].end);
          var gapEnd = S.timeToMinutes(daySlots[j + 1].start);
          var gapDuration = gapEnd - gapStart;

          if (gapDuration > 0) {
            var hatch = document.createElement('div');
            hatch.className = 'tt-hatch';
            hatch.style.left = rtlLeftPct(gapEnd) + '%';
            hatch.style.width = widthPct(gapDuration) + '%';
            overlay.appendChild(hatch);
          }
        }
      });
    });
  }

  // ── Conflict detection ─────────────────────────────────────────
  function findConflict(newCourse) {
    var newSlots = S.parseSchedule(newCourse['زمانبندی تشکیل کلاس']);
    for (var i = 0; i < selectedSections.length; i++) {
      var existing = selectedSections[i];
      if (existing['کد درس'] === newCourse['کد درس']) continue; // same course, will replace
      var existSlots = S.parseSchedule(existing['زمانبندی تشکیل کلاس']);
      for (var j = 0; j < newSlots.length; j++) {
        for (var k = 0; k < existSlots.length; k++) {
          if (newSlots[j].day === existSlots[k].day) {
            var newStart = S.timeToMinutes(newSlots[j].start);
            var newEnd = S.timeToMinutes(newSlots[j].end);
            var existStart = S.timeToMinutes(existSlots[k].start);
            var existEnd = S.timeToMinutes(existSlots[k].end);
            if (newStart < existEnd && existStart < newEnd) {
              return existing;
            }
          }
        }
      }
    }
    return null;
  }

  function hasSchedule(course) {
    return S.parseSchedule(course['زمانبندی تشکیل کلاس']).length > 0;
  }

  // ── Course selection ───────────────────────────────────────────
  function addCourse(course) {
    if (!hasSchedule(course)) {
      showToast('این درس زمانبندی ندارد', 'warning');
      return;
    }

    // Check if same course already selected (replace)
    var existingIdx = -1;
    for (var i = 0; i < selectedSections.length; i++) {
      if (selectedSections[i]['کد درس'] === course['کد درس']) {
        existingIdx = i;
        break;
      }
    }

    if (existingIdx >= 0) {
      // Replace existing section of same course
      selectedSections[existingIdx] = course;
    } else {
      // Check conflict with other courses
      var conflict = findConflict(course);
      if (conflict) {
        showToast('تداخل زمانی با «' + conflict['نام درس'] + '»', 'error');
        highlightConflict(conflict['کد ارائه']);
        return;
      }
      selectedSections.push(course);
    }

    updateAll();
  }

  function removeCourse(sectionCode) {
    selectedSections = selectedSections.filter(function (c) {
      return c['کد ارائه'] !== sectionCode;
    });
    updateAll();
  }

  function changeGroup(courseCode) {
    var sections = courseCodeIndex[courseCode];
    if (!sections || sections.length <= 1) return;

    // Build alternatives list
    var currentSection = null;
    for (var i = 0; i < selectedSections.length; i++) {
      if (selectedSections[i]['کد درس'] === courseCode) {
        currentSection = selectedSections[i];
        break;
      }
    }

    var alternatives = sections.filter(function (s) {
      return !currentSection || s['کد ارائه'] !== currentSection['کد ارائه'];
    });

    if (alternatives.length === 0) {
      showToast('گروه دیگری موجود نیست', 'warning');
      return;
    }

    showGroupPicker(courseCode, alternatives, currentSection);
  }

  function showGroupPicker(courseCode, alternatives, current) {
    // Remove existing picker
    var existing = document.querySelector('.group-picker-overlay');
    if (existing) existing.remove();

    var courseName = alternatives[0]['نام درس'];
    var overlay = document.createElement('div');
    overlay.className = 'group-picker-overlay';

    var picker = document.createElement('div');
    picker.className = 'group-picker glass';

    var html = '<div class="group-picker-header">';
    html += '<h3>تغییر گروه — ' + esc(courseName) + '</h3>';
    html += '<button class="group-picker-close">&times;</button>';
    html += '</div>';
    html += '<div class="group-picker-list">';

    if (current) {
      html += '<div class="group-picker-item current">';
      html += '<div class="group-picker-info">';
      html += '<span class="group-label">گروه فعلی</span>';
      html += '<span>' + esc(current['نام کلاس'] || '—') + '</span>';
      html += '<span>' + esc(current['نام استاد'] || '—') + '</span>';
      html += '<span>' + esc(current['زمانبندی تشکیل کلاس'] || '—') + '</span>';
      html += '</div>';
      html += '</div>';
    }

    alternatives.forEach(function (alt) {
      html += '<div class="group-picker-item" data-section="' + escAttr(alt['کد ارائه']) + '">';
      html += '<div class="group-picker-info">';
      html += '<span>' + esc(alt['نام کلاس'] || '—') + '</span>';
      html += '<span>' + esc(alt['نام استاد'] || '—') + '</span>';
      html += '<span class="group-schedule">' + esc(alt['زمانبندی تشکیل کلاس'] || '—') + '</span>';
      html += '</div>';
      html += '<button class="btn btn-select">انتخاب</button>';
      html += '</div>';
    });

    html += '</div>';
    picker.innerHTML = html;
    overlay.appendChild(picker);
    document.body.appendChild(overlay);

    // Event handlers
    picker.querySelector('.group-picker-close').addEventListener('click', function () {
      overlay.remove();
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    var items = picker.querySelectorAll('.group-picker-item[data-section]');
    items.forEach(function (item) {
      item.querySelector('.btn-select').addEventListener('click', function () {
        var sectionCode = item.dataset.section;
        var newSection = sectionIndex[sectionCode];
        if (newSection) {
          // Replace: remove old, add new
          selectedSections = selectedSections.filter(function (c) {
            return c['کد درس'] !== courseCode;
          });

          // Check conflict before adding
          var conflict = findConflict(newSection);
          if (conflict) {
            showToast('تداخل زمانی با «' + conflict['نام درس'] + '»', 'error');
            highlightConflict(conflict['کد ارائه']);
            // Re-add old section
            if (current) selectedSections.push(current);
            updateAll();
          } else {
            selectedSections.push(newSection);
            updateAll();
          }
        }
        overlay.remove();
      });
    });
  }

  // ── Visual feedback ────────────────────────────────────────────
  function highlightConflict(sectionCode) {
    var row = document.querySelector('#scheduleCourseTableBody tr[data-section="' + sectionCode + '"]');
    if (!row) return;
    row.classList.add('conflict-flash');
    setTimeout(function () {
      row.classList.remove('conflict-flash');
    }, 1500);
  }

  // ── Toast notifications ────────────────────────────────────────
  function showToast(message, type) {
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add('toast-visible');
    });

    setTimeout(function () {
      toast.classList.remove('toast-visible');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  // ── Statistics ─────────────────────────────────────────────────
  function computeStats() {
    if (selectedSections.length === 0) {
      return null;
    }

    var daysPresent = {};
    var allStarts = [];
    var allEnds = [];
    var totalMinutes = 0;
    var daySchedule = {}; // day -> sorted array of {start, end, name}

    selectedSections.forEach(function (course) {
      var slots = S.parseSchedule(course['زمانبندی تشکیل کلاس']);
      slots.forEach(function (slot) {
        daysPresent[slot.day] = true;
        var s = S.timeToMinutes(slot.start);
        var e = S.timeToMinutes(slot.end);
        allStarts.push(s);
        allEnds.push(e);
        totalMinutes += (e - s);

        if (!daySchedule[slot.day]) daySchedule[slot.day] = [];
        daySchedule[slot.day].push({ start: s, end: e, name: course['نام درس'] });
      });
    });

    // Sort each day's schedule
    Object.keys(daySchedule).forEach(function (day) {
      daySchedule[day].sort(function (a, b) { return a.start - b.start; });
    });

    // Max gap
    var maxGap = 0;
    Object.keys(daySchedule).forEach(function (day) {
      var list = daySchedule[day];
      for (var i = 1; i < list.length; i++) {
        var gap = list[i].start - list[i - 1].end;
        if (gap > maxGap) maxGap = gap;
      }
    });

    var dayCount = Object.keys(daysPresent).length;
    var hours = Math.floor(totalMinutes / 60);
    var mins = totalMinutes % 60;
    var totalHours = hours + ':' + String(mins).padStart(2, '0');

    return {
      courseCount: selectedSections.length,
      dayCount: dayCount,
      totalHours: totalHours,
      firstClass: allStarts.length > 0 ? S.minutesToTime(Math.min.apply(null, allStarts)) : '—',
      lastClass: allEnds.length > 0 ? S.minutesToTime(Math.max.apply(null, allEnds)) : '—',
      maxGap: maxGap > 0 ? Math.floor(maxGap / 60) + ':' + String(maxGap % 60).padStart(2, '0') : '—'
    };
  }

  function renderStats() {
    var statsGrid = $('#statsGrid');
    if (!statsGrid) return;

    var stats = computeStats();
    if (!stats) {
      statsGrid.innerHTML = '<p class="empty-state-small">برای مشاهده آمار، درس اضافه کنید</p>';
      return;
    }

    statsGrid.innerHTML =
      '<div class="stat-card">' +
        '<div class="stat-value">' + stats.courseCount + '</div>' +
        '<div class="stat-label">تعداد دروس</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-value">' + stats.dayCount + '</div>' +
        '<div class="stat-label">روزهای حضور</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-value">' + stats.totalHours + '</div>' +
        '<div class="stat-label">ساعات حضور</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-value">' + stats.firstClass + '</div>' +
        '<div class="stat-label">اولین کلاس</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-value">' + stats.lastClass + '</div>' +
        '<div class="stat-label">آخرین کلاس</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-value">' + stats.maxGap + '</div>' +
        '<div class="stat-label">بیشترین فاصله</div>' +
      '</div>';
  }

  // ── Selected courses panel ─────────────────────────────────────
  function renderSelectedCourses() {
    var selectedList = $('#selectedList');
    if (!selectedList) return;

    if (selectedSections.length === 0) {
      selectedList.innerHTML = '<p class="empty-state-small">هنوز درسی اضافه نشده است</p>';
      return;
    }

    var html = '';
    selectedSections.forEach(function (course) {
      var sectionCode = course['کد ارائه'];
      var courseCode = course['کد درس'];
      var name = esc(course['نام درس']);
      var prof = esc(course['نام استاد'] || '—');
      var schedule = esc(course['زمانبندی تشکیل کلاس'] || '—');
      var altCount = (courseCodeIndex[courseCode] || []).length;

      html += '<div class="selected-card" data-section="' + escAttr(sectionCode) + '">';
      html += '<div class="selected-card-info">';
      html += '<div class="selected-card-name">' + name + '</div>';
      html += '<div class="selected-card-prof">' + prof + '</div>';
      html += '<div class="selected-card-schedule">' + schedule + '</div>';
      html += '</div>';
      html += '<div class="selected-card-actions">';
      if (altCount > 1) {
        html += '<button class="btn btn-sm btn-change" data-course="' + escAttr(courseCode) + '">تغییر گروه</button>';
      }
      html += '<button class="btn btn-sm btn-remove" data-section="' + escAttr(sectionCode) + '">حذف</button>';
      html += '</div>';
      html += '</div>';
    });

    selectedList.innerHTML = html;

    // Event delegation
    selectedList.addEventListener('click', function (e) {
      var changeBtn = e.target.closest('.btn-change');
      var removeBtn = e.target.closest('.btn-remove');
      if (changeBtn) {
        changeGroup(changeBtn.dataset.course);
      } else if (removeBtn) {
        removeCourse(removeBtn.dataset.section);
      }
    });
  }

  // ── Schedule course table ──────────────────────────────────────
  function buildScheduleTableHeader() {
    var thead = $('#scheduleCourseTableHead');
    if (!thead) return;
    var tr = thead.querySelector('tr');
    tr.innerHTML = '';

    S.tableColumns.forEach(function (col) {
      if (SCHEDULE_HIDDEN_COLS.has(col)) return;
      var th = document.createElement('th');
      th.textContent = col;
      if (S.LONG_COLS.has(col)) th.classList.add('col-long');
      if (S.CENTER_COLS.has(col)) th.classList.add('col-center');
      tr.appendChild(th);
    });

    // Action column
    var thAction = document.createElement('th');
    thAction.textContent = 'عملیات';
    thAction.classList.add('col-action');
    tr.appendChild(thAction);

    // AI select column
    var thAi = document.createElement('th');
    thAi.textContent = 'هوش مصنوعی';
    thAi.classList.add('col-ai');
    tr.appendChild(thAi);
  }

  function renderScheduleTable() {
    var tbody = $('#scheduleCourseTableBody');
    if (!tbody) return;

    var filtered = S.filteredCourses;

    if (filtered.length === 0) {
      var colCount = S.tableColumns.filter(function (c) { return !SCHEDULE_HIDDEN_COLS.has(c); }).length + 1;
      tbody.innerHTML = '<tr><td colspan="' + colCount + '" class="empty-state">نتیجه‌ای یافت نشد</td></tr>';
      return;
    }

    var selectedMap = {};
    selectedSections.forEach(function (c) {
      selectedMap[c['کد ارائه']] = true;
    });

    var rows = filtered.map(function (c) {
      var cells = '';
      S.tableColumns.forEach(function (col) {
        if (SCHEDULE_HIDDEN_COLS.has(col)) return;
        var val = c[col] || '';
        var cls = S.LONG_COLS.has(col) ? ' class="col-long"' :
                  S.CENTER_COLS.has(col) ? ' class="col-center"' : '';
        var title = S.LONG_COLS.has(col) ? ' title="' + escAttr(val) + '"' : '';
        if (col === 'نوع واحد') {
          var badgeClass = val === 'عمومی' ? 'badge-general' : 'badge-specialized';
          val = '<span class="badge ' + badgeClass + '">' + esc(val) + '</span>';
        } else {
          val = esc(val);
        }
        cells += '<td' + cls + title + '>' + val + '</td>';
      });

      // Action cell
      var sectionCode = c['کد ارائه'];
      var isSelected = selectedMap[sectionCode];
      var hasTime = hasSchedule(c);
      var actionHtml;
      if (isSelected) {
        actionHtml = '<button class="btn-icon btn-added" data-section="' + escAttr(sectionCode) + '" title="حذف از برنامه">✓</button>';
      } else if (hasTime) {
        actionHtml = '<button class="btn-icon btn-add-course" data-section="' + escAttr(sectionCode) + '" title="افزودن به برنامه">+</button>';
      } else {
        actionHtml = '<span class="btn-icon btn-no-schedule" title="زمانبندی ندارد">—</span>';
      }
      cells += '<td class="col-action">' + actionHtml + '</td>';

      // AI select checkbox
      var courseCode = c['کد درس'];
      var isDesiredCourse = isDesired(courseCode);
      var hasSchedule2 = hasSchedule(c);
      if (hasSchedule2) {
        cells += '<td class="col-ai"><input type="checkbox" class="ai-checkbox" data-course="' + S.escAttr(courseCode) + '"' + (isDesiredCourse ? ' checked' : '') + ' title="انتخاب برای هوش مصنوعی"></td>';
      } else {
        cells += '<td class="col-ai"></td>';
      }

      return '<tr data-section="' + escAttr(sectionCode) + '">' + cells + '</tr>';
    });

    tbody.innerHTML = rows.join('');

    // Update count
    var countEl = $('#scheduleCourseCount');
    if (countEl) {
      countEl.textContent = selectedSections.length + ' درس انتخاب شده';
    }

    // Event delegation for add/remove buttons
    tbody.addEventListener('click', handleScheduleTableClick);
  }

  function handleScheduleTableClick(e) {
    var addBtn = e.target.closest('.btn-add-course');
    var removeBtn = e.target.closest('.btn-added');
    var aiCheck = e.target.closest('.ai-checkbox');
    if (addBtn) {
      var course = sectionIndex[addBtn.dataset.section];
      if (course) addCourse(course);
    } else if (removeBtn) {
      removeCourse(removeBtn.dataset.section);
    } else if (aiCheck) {
      toggleDesiredCourse(aiCheck.dataset.course);
    }
  }

  // ── Update all views ───────────────────────────────────────────
  function updateAll() {
    renderTimetableBlocks();
    renderSelectedCourses();
    renderStats();
    renderScheduleTable();
  }

  // ── Initialize schedule mode ───────────────────────────────────
  function initScheduleMode() {
    buildIndex();
    buildTimetable();
    buildScheduleTableHeader();
    renderScheduleTable();
    renderStats();
    renderSelectedCourses();
    initAiGenerator();
  }

  // ── Callbacks ──────────────────────────────────────────────────
  S.onCoursesLoaded = function () {
    buildIndex();
    buildScheduleTableHeader();
    renderScheduleTable();
  };

  S.onModeChange = function (mode) {
    if (mode === 'schedule') {
      buildIndex();
      buildScheduleTableHeader();
      renderScheduleTable();
      renderTimetableBlocks();
      renderSelectedCourses();
      renderStats();
      renderAiCourseTags();
    }
  };

  S.onFiltersChanged = function () {
    renderScheduleTable();
  };

  // ══════════════════════════════════════════════════════════════
  // AI SCHEDULE GENERATOR
  // ══════════════════════════════════════════════════════════════

  var AI_WORKER_URL = 'https://iau-schedule-worker.ashkan-ebi2.workers.dev';

  var desiredCourses = []; // Array of course codes the user wants for AI
  var aiResults = [];     // Schedules returned by Gemini
  var selectedAiSchedule = null; // Currently previewed AI schedule

  // ── Desired courses management ─────────────────────────────────
  function toggleDesiredCourse(courseCode) {
    var idx = desiredCourses.indexOf(courseCode);
    if (idx >= 0) {
      desiredCourses.splice(idx, 1);
    } else {
      desiredCourses.push(courseCode);
    }
    renderAiCourseTags();
    renderScheduleTable(); // Update checkboxes
  }

  function isDesired(courseCode) {
    return desiredCourses.indexOf(courseCode) >= 0;
  }

  function renderAiCourseTags() {
    var container = $('#aiCourseList');
    if (!container) return;

    if (desiredCourses.length === 0) {
      container.innerHTML = '<p class="ai-empty">از جدول زیر دروس مورد نظر خود را انتخاب کنید</p>';
      return;
    }

    var html = '';
    desiredCourses.forEach(function (code) {
      // Find course name from allCourses
      var course = null;
      for (var i = 0; i < S.allCourses.length; i++) {
        if (S.allCourses[i]['کد درس'] === code) {
          course = S.allCourses[i];
          break;
        }
      }
      var name = course ? course['نام درس'] : code;
      html += '<span class="ai-course-tag">';
      html += S.esc(name);
      html += '<button class="tag-remove" data-code="' + S.escAttr(code) + '" title="حذف">×</button>';
      html += '</span>';
    });
    container.innerHTML = html;

    // Event delegation
    container.onclick = function (e) {
      var removeBtn = e.target.closest('.tag-remove');
      if (removeBtn) {
        toggleDesiredCourse(removeBtn.dataset.code);
      }
    };
  }

  // ── AI Generation ──────────────────────────────────────────────
  function buildAiPayload() {
    var courseGroups = {};
    desiredCourses.forEach(function (code) {
      courseGroups[code] = [];
    });

    S.allCourses.forEach(function (c) {
      var code = c['کد درس'];
      if (courseGroups[code] && c['زمانبندی تشکیل کلاس']) {
        courseGroups[code].push({
          courseCode: c['کد درس'],
          sectionCode: c['کد ارائه'],
          courseName: c['نام درس'],
          instructor: c['نام استاد'],
          schedule: c['زمانبندی تشکیل کلاس']
        });
      }
    });

    var courses = [];
    Object.keys(courseGroups).forEach(function (code) {
      var sections = courseGroups[code];
      if (sections.length > 0) {
        courses.push({
          courseCode: code,
          courseName: sections[0].courseName,
          sections: sections
        });
      }
    });

    return {
      goal: $('#aiGoal').value,
      courses: courses
    };
  }

  async function generateSchedule() {
    if (desiredCourses.length === 0) {
      showAiError('لطفاً حداقل یک درس انتخاب کنید');
      return;
    }

    if (!AI_WORKER_URL) {
      showAiError('آدرس سرویس هوش مصنوعی تنظیم نشده است');
      return;
    }

    var payload = buildAiPayload();
    if (payload.courses.length === 0) {
      showAiError('درس انتخاب شده زمانبندی ندارند');
      return;
    }

    showAiLoading(true);
    hideAiError();
    hideAiResults();

    try {
      var response = await fetch(AI_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        var errText = await response.text();
        throw new Error('خطای سرور: ' + response.status);
      }

      var data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.schedules || !Array.isArray(data.schedules) || data.schedules.length === 0) {
        throw new Error('برنامه‌ای تولید نشد. لطفاً دروس دیگری امتحان کنید.');
      }

      aiResults = data.schedules;
      selectedAiSchedule = 0;
      renderAiResults();
      showAiResults();
    } catch (err) {
      console.error('AI generation failed:', err);
      showAiError(err.message || 'خطا در تولید برنامه');
    } finally {
      showAiLoading(false);
    }
  }

  // ── AI Results Rendering ───────────────────────────────────────
  function renderAiResults() {
    var tabsEl = $('#aiTabs');
    var previewEl = $('#aiPreview');
    if (!tabsEl || !previewEl) return;

    // Render tabs
    var tabsHtml = '';
    aiResults.forEach(function (schedule, i) {
      var activeClass = i === selectedAiSchedule ? ' active' : '';
      tabsHtml += '<button class="ai-tab' + activeClass + '" data-index="' + i + '">';
      tabsHtml += S.esc(schedule.title || ('گزینه ' + (i + 1)));
      tabsHtml += '</button>';
    });
    tabsEl.innerHTML = tabsHtml;

    // Tab click handlers
    tabsEl.onclick = function (e) {
      var tab = e.target.closest('.ai-tab');
      if (!tab) return;
      selectedAiSchedule = parseInt(tab.dataset.index, 10);
      renderAiResults();
    };

    // Render preview timetable for selected schedule
    var schedule = aiResults[selectedAiSchedule];
    if (!schedule) return;

    // Build a mini timetable (same as main: RTL, 60 cols + overlay)
    var html = '<div class="timetable">';
    // Header: reversed hours (21→07), day label at end
    html += '<div class="tt-row tt-header">';
    for (var hi = 0; hi < HOURS_COUNT; hi++) {
      var hour = HOURS_END - 1 - hi;
      html += '<div class="tt-cell tt-hour">' + S.minutesToTime(hour * 60) + '</div>';
    }
    html += '<div class="tt-cell tt-day-label tt-header-day">روز</div>';
    html += '</div>';
    // Day rows: 60 cells, day label at end, overlay on left
    S.DAY_ORDER.forEach(function (day) {
      html += '<div class="tt-row" data-day="' + day + '">';
      for (var q = 0; q < QUARTER_COLS; q++) {
        var cls = 'tt-cell tt-slot';
        if (q % 4 === 0) cls += ' tt-hour-mark';
        else if (q % 4 === 2) cls += ' tt-half-mark';
        html += '<div class="' + cls + '"></div>';
      }
      html += '<div class="tt-cell tt-day-label">' + day + '</div>';
      html += '<div class="tt-overlay"></div>';
      html += '</div>';
    });
    html += '</div>';

    previewEl.innerHTML = html;

    // Place course blocks
    if (schedule.courses) {
      var colorIdx = 0;
      schedule.courses.forEach(function (entry) {
        // Find the full course object by sectionCode
        var course = sectionIndex[entry.sectionCode];
        if (!course) return;

        var slots = S.parseSchedule(course['زمانبندی تشکیل کلاس']);
        var color = TIMETABLE_COLORS[colorIdx % TIMETABLE_COLORS.length];
        colorIdx++;

        var totalMin = HOURS_COUNT * 60;
        var gridEndMin = HOURS_END * 60;

        // Group by day for hatch rendering
        var slotsByDay = {};
        slots.forEach(function (slot) {
          if (!slotsByDay[slot.day]) slotsByDay[slot.day] = [];
          slotsByDay[slot.day].push(slot);
        });

        Object.keys(slotsByDay).forEach(function (day) {
          var daySlots = slotsByDay[day];
          var dayRow = previewEl.querySelector('.tt-row[data-day="' + day + '"]');
          if (!dayRow) return;
          var overlay = dayRow.querySelector('.tt-overlay');
          if (!overlay) return;

          daySlots.sort(function (a, b) {
            return S.timeToMinutes(a.start) - S.timeToMinutes(b.start);
          });

          daySlots.forEach(function (slot) {
            var endMin = S.timeToMinutes(slot.end);
            var dur = endMin - S.timeToMinutes(slot.start);

            var block = document.createElement('div');
            block.className = 'tt-block';
            block.style.left = ((gridEndMin - endMin) / totalMin * 100) + '%';
            block.style.width = (dur / totalMin * 100) + '%';
            block.style.background = color.bg;
            block.style.borderColor = color.border;
            block.style.color = color.text;

            block.innerHTML =
              '<span class="tt-block-name">' + S.esc(course['نام درس']) + '</span>' +
              '<span class="tt-block-time">' + slot.end + ' – ' + slot.start + '</span>';

            overlay.appendChild(block);
          });

          // Hatched connectors
          for (var j = 0; j < daySlots.length - 1; j++) {
            var gapStart = S.timeToMinutes(daySlots[j].end);
            var gapEnd = S.timeToMinutes(daySlots[j + 1].start);
            var gapDur = gapEnd - gapStart;
            if (gapDur > 0) {
              var hatch = document.createElement('div');
              hatch.className = 'tt-hatch';
              hatch.style.left = ((gridEndMin - gapEnd) / totalMin * 100) + '%';
              hatch.style.width = (gapDur / totalMin * 100) + '%';
              overlay.appendChild(hatch);
            }
          }
        });
      });
    }

    // Summary
    if (schedule.summary) {
      previewEl.innerHTML += '<div style="text-align:center;padding:8px;color:var(--text-muted);font-size:0.8rem;">' + S.esc(schedule.summary) + '</div>';
    }
  }

  function loadAiSchedule() {
    if (selectedAiSchedule === null || !aiResults[selectedAiSchedule]) return;

    var schedule = aiResults[selectedAiSchedule];
    if (!schedule.courses) return;

    // Clear current selections
    selectedSections = [];

    // Add each course from the AI schedule
    schedule.courses.forEach(function (entry) {
      var course = sectionIndex[entry.sectionCode];
      if (course) {
        selectedSections.push(course);
      }
    });

    updateAll();
    showToast('برنامه بارگذاری شد', 'info');
  }

  // ── AI UI Helpers ──────────────────────────────────────────────
  function showAiLoading(show) {
    var el = $('#aiLoading');
    var btn = $('#btnGenerate');
    if (el) el.style.display = show ? 'flex' : 'none';
    if (btn) btn.disabled = show;
  }

  function showAiError(msg) {
    var el = $('#aiError');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  function hideAiError() {
    var el = $('#aiError');
    if (el) el.style.display = 'none';
  }

  function showAiResults() {
    var el = $('#aiResults');
    if (el) el.style.display = 'block';
  }

  function hideAiResults() {
    var el = $('#aiResults');
    if (el) el.style.display = 'none';
  }

  // ── AI Event Bindings ──────────────────────────────────────────
  function initAiGenerator() {
    var btnGenerate = $('#btnGenerate');
    var btnLoad = $('#btnLoadSchedule');

    if (btnGenerate) {
      btnGenerate.addEventListener('click', generateSchedule);
    }
    if (btnLoad) {
      btnLoad.addEventListener('click', loadAiSchedule);
    }

    renderAiCourseTags();
  }

  // ── Start ──────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScheduleMode);
  } else {
    initScheduleMode();
  }
})();
