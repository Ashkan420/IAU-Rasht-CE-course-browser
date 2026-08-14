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

  // ── Sub-mode State ────────────────────────────────────────────
  var scheduleSubMode = 'manual'; // 'manual' | 'ai'
  var excludedInstructors = [];   // Array of instructor names to exclude from AI

  // ── Edit Mode State ────────────────────────────────────────────
  var editMode = false;
  var editCourseCode = null;      // Course code being edited
  var editPairedCode = null;      // Paired course code (حل تمرین etc.)
  var editCurrentSection = null;  // Currently selected section object

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

    // Remove old blocks, hatches, ghost blocks, and green hatches
    timetable.querySelectorAll('.tt-block, .tt-hatch, .tt-ghost, .tt-hatch-green').forEach(function (el) { el.remove(); });

    var scaleFactor = S.timetableScaleFactor(timetable.querySelector('.tt-overlay'));

    selectedSections.forEach(function (course) {
      var slots = S.parseSchedule(course['زمانبندی تشکیل کلاس']);
      if (slots.length === 0) return;

      var colorIdx = assignColor(course['کد درس']);
      var color = TIMETABLE_COLORS[colorIdx];
      var sectionCode = course['کد ارائه'];
      var name = esc(course['نام درس']);
      var prof = esc(course['نام استاد']);
      var isEditedCourse = editMode && course['کد درس'] === editCourseCode;

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
          block.style.left = S.timetableLeftPct(endMin, scaleFactor) + '%';
          block.style.width = S.timetableWidthPct(dur, scaleFactor) + '%';
          block.style.background = color.bg;
          block.style.borderColor = color.border;
          block.style.color = color.text;
          block.dataset.section = sectionCode;
          block.dataset.course = course['کد درس'];

          block.title = slot.start + ' – ' + slot.end;
          block.innerHTML =
            '<span class="tt-block-name">' + name + '</span>' +
            '<span class="tt-block-prof">' + prof + '</span>';

          // Scale font size based on block duration
          var nameSize = Math.min(0.8, Math.max(0.55, 0.55 + dur / 300 * 0.25));
          var profSize = Math.min(0.65, Math.max(0.5, 0.5 + dur / 300 * 0.15));
          block.querySelector('.tt-block-name').style.fontSize = nameSize + 'rem';
          block.querySelector('.tt-block-prof').style.fontSize = profSize + 'rem';

          // ── Edit mode styling ──
          if (editMode) {
            var isPairedToEdited = editPairedCode && course['کد درس'] === editPairedCode;
            if (isEditedCourse) {
              block.classList.add('tt-block-selected');
              // Add delete button
              var delBtn = document.createElement('button');
              delBtn.className = 'tt-block-delete';
              delBtn.textContent = '×';
              delBtn.title = 'حذف از برنامه';
              delBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                removeCourse(course['کد ارائه']);
              });
              block.appendChild(delBtn);
            } else if (isPairedToEdited) {
              // Paired course block — green accent, clickable to enter its own edit mode
              block.classList.add('clickable');
              block.style.background = 'rgba(52, 211, 153, 0.25)';
              block.style.borderColor = 'rgba(52, 211, 153, 0.5)';
              block.style.color = '#6ee7b7';
              block.addEventListener('click', function () {
                enterEditMode(course['کد درس']);
              });
            } else {
              block.classList.add('tt-block-dimmed');
            }
          } else {
            // Not in edit mode — clickable to enter edit mode
            block.classList.add('clickable');
            block.addEventListener('click', function () {
              enterEditMode(course['کد درس']);
            });
          }

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
            hatch.style.left = S.timetableLeftPct(gapEnd, scaleFactor) + '%';
            hatch.style.width = S.timetableWidthPct(gapDuration, scaleFactor) + '%';
            if (editMode && !isEditedCourse) {
              hatch.style.opacity = '0.15';
            }
            overlay.appendChild(hatch);
          }
        }
      });
    });

    // If in edit mode, render ghost blocks (green hatches render inside)
    if (editMode) {
      renderGhostBlocks();
    }
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

  // ── Paired courses (حل تمرین ↔ main) ──────────────────────────
  function findPairedCourse(course) {
    var section = course['کد ارائه'];
    if (!section) return null;
    var pairs = S.allCourses.filter(function (c) {
      return c['کد ارائه'] === section && c['کد درس'] !== course['کد درس'];
    });
    if (pairs.length === 0) return null;
    return pairs[0];
  }

  // ── Edit Mode (click-to-swap) ──────────────────────────────────
  function enterEditMode(courseCode) {
    var current = null;
    for (var i = 0; i < selectedSections.length; i++) {
      if (selectedSections[i]['کد درس'] === courseCode) {
        current = selectedSections[i];
        break;
      }
    }
    if (!current) return;

    var paired = findPairedCourse(current);
    if (paired && !hasSchedule(paired)) paired = null;

    editMode = true;
    editCourseCode = courseCode;
    editCurrentSection = current;
    editPairedCode = paired ? paired['کد درس'] : null;

    renderTimetableBlocks();
  }

  function exitEditMode() {
    editMode = false;
    editCourseCode = null;
    editPairedCode = null;
    editCurrentSection = null;
    renderTimetableBlocks();
  }

  function checkGhostConflict(section, slot) {
    var startMin = S.timeToMinutes(slot.start);
    var endMin = S.timeToMinutes(slot.end);

    for (var i = 0; i < selectedSections.length; i++) {
      var existing = selectedSections[i];
      if (existing['کد درس'] === editCourseCode) continue;
      if (editPairedCode && existing['کد درس'] === editPairedCode) continue;

      var existSlots = S.parseSchedule(existing['زمانبندی تشکیل کلاس']);
      for (var j = 0; j < existSlots.length; j++) {
        if (existSlots[j].day === slot.day) {
          var existStart = S.timeToMinutes(existSlots[j].start);
          var existEnd = S.timeToMinutes(existSlots[j].end);
          if (startMin < existEnd && existStart < endMin) {
            return existing;
          }
        }
      }
    }
    return null;
  }

  function computeAvailableSlots() {
    if (!editMode || !editCourseCode) return [];

    var sections = courseCodeIndex[editCourseCode] || [];
    var currentGender = S.currentGender;

    // Alternative sections of the main course (not the current one)
    var alternatives = sections.filter(function (s) {
      return s['کد ارائه'] !== editCurrentSection['کد ارائه'];
    });

    // For عمومی courses, filter by gender
    if (editCurrentSection['نوع واحد'] === 'عمومی' && currentGender && currentGender !== 'همه') {
      alternatives = alternatives.filter(function (s) {
        var gender = (s['جنسیت'] || '').trim();
        var className = (s['نام کلاس'] || '').trim();
        if (currentGender === 'خواهران') {
          return gender === 'زن' || className.includes('خواهران');
        }
        if (currentGender === 'برادران') {
          return gender === 'مرد' || className.includes('برادران');
        }
        return true;
      });
    }

    // Paired course alternatives
    var pairedAlternatives = [];
    if (editPairedCode) {
      var pairedSections = courseCodeIndex[editPairedCode] || [];
      var currentPaired = null;
      for (var i = 0; i < selectedSections.length; i++) {
        if (selectedSections[i]['کد درس'] === editPairedCode) {
          currentPaired = selectedSections[i];
          break;
        }
      }
      if (currentPaired) {
        pairedAlternatives = pairedSections.filter(function (s) {
          return s['کد ارائه'] !== currentPaired['کد ارائه'];
        });
      }
    }

    var ghosts = [];

    alternatives.forEach(function (section) {
      var slots = S.parseSchedule(section['زمانبندی تشکیل کلاس']);
      slots.forEach(function (slot) {
        var conflict = checkGhostConflict(section, slot);
        ghosts.push({
          section: section,
          slot: slot,
          isPaired: false,
          conflict: conflict
        });
      });
    });

    pairedAlternatives.forEach(function (section) {
      var slots = S.parseSchedule(section['زمانبندی تشکیل کلاس']);
      slots.forEach(function (slot) {
        var conflict = checkGhostConflict(section, slot);
        ghosts.push({
          section: section,
          slot: slot,
          isPaired: true,
          conflict: conflict
        });
      });
    });

    return ghosts;
  }

  function renderGhostBlocks() {
    var timetable = $('#timetable');
    if (!timetable) return;

    timetable.querySelectorAll('.tt-ghost').forEach(function (el) { el.remove(); });

    var ghosts = computeAvailableSlots();
    var scaleFactor = S.timetableScaleFactor(timetable.querySelector('.tt-overlay'));

    ghosts.forEach(function (ghost) {
      var day = ghost.slot.day;
      var dayRow = timetable.querySelector('.tt-row[data-day="' + day + '"]');
      if (!dayRow) return;
      var overlay = dayRow.querySelector('.tt-overlay');
      if (!overlay) return;

      var startMin = S.timeToMinutes(ghost.slot.start);
      var endMin = S.timeToMinutes(ghost.slot.end);
      var dur = endMin - startMin;

      var el = document.createElement('div');
      el.className = 'tt-ghost ' + (ghost.conflict ? 'tt-ghost-conflict' : 'tt-ghost-available');
      el.style.left = S.timetableLeftPct(endMin, scaleFactor) + '%';
      el.style.width = S.timetableWidthPct(dur, scaleFactor) + '%';
      el.dataset.section = ghost.section['کد ارائه'];
      el.dataset.course = ghost.section['کد درس'];

      // Show instructor name if block is wide enough
      if (dur >= 45) {
        var label = document.createElement('span');
        label.className = 'tt-ghost-label';
        label.textContent = ghost.section['نام استاد'] || ghost.section['نام کلاس'] || '';
        el.appendChild(label);
      }

      // Hover: tooltip + paired highlight + same-section ghost glow
      el.addEventListener('mouseenter', function () {
        if (ghost.conflict) {
          var tooltip = document.createElement('div');
          tooltip.className = 'tt-ghost-tooltip';
          tooltip.textContent = 'تداخل با «' + ghost.conflict['نام درس'] + '»';
          el.appendChild(tooltip);
        }
        highlightPairedBlocks(ghost.section);
        // Highlight all ghosts of same section on same day
        var row = el.closest('.tt-row');
        if (row) {
          row.querySelectorAll('.tt-ghost[data-section="' + ghost.section['کد ارائه'] + '"]').forEach(function (g) {
            g.classList.add('tt-ghost-hover');
          });
        }
      });

      el.addEventListener('mouseleave', function () {
        var tooltip = el.querySelector('.tt-ghost-tooltip');
        if (tooltip) tooltip.remove();
        clearPairedHighlights();
        timetable.querySelectorAll('.tt-ghost').forEach(function (g) {
          g.classList.remove('tt-ghost-hover');
        });
      });

      // Click: swap to this section
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        swapToSection(ghost.section);
      });

      overlay.appendChild(el);
    });

    // Render green hatches between same-section ghost blocks on same day
    renderAllGreenHatches(ghosts, timetable);
  }

  // ── Green hatches (rendered once in edit mode) ──────────────────
  function renderAllGreenHatches(ghosts, timetable) {
    var scaleFactor = S.timetableScaleFactor(timetable.querySelector('.tt-overlay'));

    // Group ghosts by day + section code
    var groups = {};
    ghosts.forEach(function (ghost) {
      var key = ghost.slot.day + '|' + ghost.section['کد ارائه'];
      if (!groups[key]) groups[key] = [];
      groups[key].push(ghost);
    });

    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      if (group.length < 2) return;

      var day = group[0].slot.day;
      var dayRow = timetable.querySelector('.tt-row[data-day="' + day + '"]');
      if (!dayRow) return;
      var overlay = dayRow.querySelector('.tt-overlay');
      if (!overlay) return;

      // Sort by start time
      group.sort(function (a, b) {
        return S.timeToMinutes(a.slot.start) - S.timeToMinutes(b.slot.start);
      });

      // Render green hatches between consecutive ghosts (same as grey hatch logic)
      for (var j = 0; j < group.length - 1; j++) {
        var gapStart = S.timeToMinutes(group[j].slot.end);
        var gapEnd = S.timeToMinutes(group[j + 1].slot.start);
        var gapDur = gapEnd - gapStart;

        if (gapDur > 0) {
          var hatch = document.createElement('div');
          hatch.className = 'tt-hatch-green';
          hatch.style.left = S.timetableLeftPct(gapEnd, scaleFactor) + '%';
          hatch.style.width = S.timetableWidthPct(gapDur, scaleFactor) + '%';
          overlay.appendChild(hatch);
        }
      }
    });
  }

  function highlightPairedBlocks(hoveredSection) {
    var timetable = $('#timetable');
    if (!timetable) return;

    // Find the paired course by section code (same کد ارائه, different کد درس)
    var paired = findPairedCourse(hoveredSection);
    if (!paired) return;

    // Find the paired course in selectedSections
    var found = null;
    for (var i = 0; i < selectedSections.length; i++) {
      if (selectedSections[i]['کد درس'] === paired['کد درس']) {
        // Prefer the exact matching section code
        if (selectedSections[i]['کد ارائه'] === paired['کد ارائه']) {
          found = selectedSections[i];
          break;
        }
        // Otherwise keep as fallback
        if (!found) found = selectedSections[i];
      }
    }

    if (found) {
      timetable.querySelectorAll('.tt-block[data-section="' + found['کد ارائه'] + '"]').forEach(function (block) {
        block.classList.add('tt-block-paired');
      });
    }
  }

  function clearPairedHighlights() {
    var timetable = $('#timetable');
    if (!timetable) return;
    timetable.querySelectorAll('.tt-block-paired').forEach(function (block) {
      block.classList.remove('tt-block-paired');
    });
  }

  function swapToSection(newSection) {
    if (!editMode) return;

    var courseCode = newSection['کد درس'];

    // Remove old section and its pair
    selectedSections = selectedSections.filter(function (c) {
      return c['کد درس'] !== courseCode;
    });
    if (editPairedCode) {
      selectedSections = selectedSections.filter(function (c) {
        return c['کد درس'] !== editPairedCode;
      });
    }

    // Add new section
    selectedSections.push(newSection);

    // Add paired section if exists and no conflict
    if (editPairedCode) {
      var pairedNew = findPairedCourse(newSection);
      if (pairedNew && hasSchedule(pairedNew)) {
        var pairConflict = findConflict(pairedNew);
        if (!pairConflict) {
          selectedSections.push(pairedNew);
        } else {
          showToast('حل تمرین تداخل زمانی دارد', 'warning');
        }
      }
    }

    exitEditMode();
    updateAll();
    showToast('گروه درس تغییر کرد', 'info');
  }

  // ── Course selection ───────────────────────────────────────────
  function addCourse(course) {
    if (!hasSchedule(course)) {
      showToast('این درس زمانبندی ندارد', 'warning');
      return;
    }

    // Find paired course (حل تمرین ↔ main)
    var paired = findPairedCourse(course);
    if (paired && !hasSchedule(paired)) paired = null; // skip if pair has no schedule

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
      // Also replace paired course if selected
      if (paired) {
        for (var j = 0; j < selectedSections.length; j++) {
          if (selectedSections[j]['کد درس'] === paired['کد درس']) {
            selectedSections[j] = paired;
            break;
          }
        }
      }
    } else {
      // Check conflict with other courses
      var conflict = findConflict(course);
      if (conflict) {
        showToast('تداخل زمانی با «' + conflict['نام درس'] + '»', 'error');
        highlightConflict(conflict['کد ارائه']);
        return;
      }
      selectedSections.push(course);
      // Auto-add paired course
      if (paired) {
        var pairConflict = findConflict(paired);
        if (!pairConflict) {
          selectedSections.push(paired);
        }
      }
    }

    // Exit edit mode when adding a course from the table
    if (editMode) exitEditMode();
    updateAll();
  }

  function removeCourse(sectionCode) {
    // Find the course being removed to identify its pair
    var removed = null;
    for (var i = 0; i < selectedSections.length; i++) {
      if (selectedSections[i]['کد ارائه'] === sectionCode) {
        removed = selectedSections[i];
        break;
      }
    }
    // Remove the course and its pair (same section code)
    selectedSections = selectedSections.filter(function (c) {
      return c['کد ارائه'] !== sectionCode;
    });
    // Also remove pair by course code if it exists
    if (removed) {
      var paired = findPairedCourse(removed);
      if (paired) {
        selectedSections = selectedSections.filter(function (c) {
          return c['کد درس'] !== paired['کد درس'];
        });
      }
    }
    // Exit edit mode if the edited course was removed
    if (editMode && removed && removed['کد درس'] === editCourseCode) {
      editMode = false;
      editCourseCode = null;
      editPairedCode = null;
      editCurrentSection = null;
    }
    updateAll();
  }

  function changeGroup(courseCode, currentGender) {
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
      if (currentSection && s['کد ارائه'] === currentSection['کد ارائه']) return false;
      // Filter عمومی by gender
      if (s['نوع واحد'] === 'عمومی' && currentGender && currentGender !== 'همه') {
        var gender = (s['جنسیت'] || '').trim();
        var className = (s['نام کلاس'] || '').trim();
        if (currentGender === 'خواهران' && gender !== 'زن' && !className.includes('خواهران')) return false;
        if (currentGender === 'برادران' && gender !== 'مرد' && !className.includes('برادران')) return false;
      }
      return true;
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

          // Also remove paired course
          var pairedOld = findPairedCourse(current);
          if (pairedOld) {
            selectedSections = selectedSections.filter(function (c) {
              return c['کد درس'] !== pairedOld['کد درس'];
            });
          }

          // Check conflict before adding
          var conflict = findConflict(newSection);
          if (conflict) {
            showToast('تداخل زمانی با «' + conflict['نام درس'] + '»', 'error');
            highlightConflict(conflict['کد ارائه']);
            // Re-add old section and its pair
            if (current) selectedSections.push(current);
            if (pairedOld) selectedSections.push(pairedOld);
            updateAll();
          } else {
            selectedSections.push(newSection);
            // Also add paired course for new section
            var pairedNew = findPairedCourse(newSection);
            if (pairedNew && hasSchedule(pairedNew)) {
              var pairConflict = findConflict(pairedNew);
              if (!pairConflict) {
                selectedSections.push(pairedNew);
              }
            }
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

    // Group courses by day
    var dayGroups = {};
    S.DAY_ORDER.forEach(function (d) { dayGroups[d] = []; });

    selectedSections.forEach(function (course) {
      var slots = S.parseSchedule(course['زمانبندی تشکیل کلاس']);
      var daysSeen = {};
      slots.forEach(function (slot) {
        if (!daysSeen[slot.day]) {
          daysSeen[slot.day] = true;
          if (dayGroups[slot.day]) {
            dayGroups[slot.day].push(course);
          }
        }
      });
    });

    // Sort each day's courses by earliest start time on that day
    S.DAY_ORDER.forEach(function (day) {
      dayGroups[day].sort(function (a, b) {
        var aSlots = S.parseSchedule(a['زمانبندی تشکیل کلاس']).filter(function (s) { return s.day === day; });
        var bSlots = S.parseSchedule(b['زمانبندی تشکیل کلاس']).filter(function (s) { return s.day === day; });
        var aStart = aSlots.length ? S.timeToMinutes(aSlots[0].start) : 9999;
        var bStart = bSlots.length ? S.timeToMinutes(bSlots[0].start) : 9999;
        return aStart - bStart;
      });
    });

    var html = '<table class="selected-table"><thead><tr>';
    html += '<th>روز</th><th>نام درس</th><th>استاد</th><th>زمان</th><th>عملیات</th>';
    html += '</tr></thead><tbody>';

    S.DAY_ORDER.forEach(function (day) {
      var courses = dayGroups[day];
      if (courses.length === 0) return;

      courses.forEach(function (course, idx) {
        html += '<tr>';
        if (idx === 0) {
          html += '<td class="day-cell" rowspan="' + courses.length + '">' + day + '</td>';
        }
        html += '<td>' + esc(course['نام درس']) + '</td>';
        html += '<td>' + esc(course['نام استاد'] || '—') + '</td>';
        html += '<td>' + esc(course['زمانبندی تشکیل کلاس'] || '—') + '</td>';
        html += '<td class="col-action">';
        var altCount = (courseCodeIndex[course['کد درس']] || []).length;
        if (altCount > 1) {
          html += '<button class="btn btn-sm btn-change" data-course="' + escAttr(course['کد درس']) + '">تغییر گروه</button> ';
        }
        html += '<button class="btn btn-sm btn-remove" data-section="' + escAttr(course['کد ارائه']) + '">حذف</button>';
        html += '</td></tr>';
      });
    });

    html += '</tbody></table>';
    selectedList.innerHTML = html;

    // Event delegation
    selectedList.addEventListener('click', function (e) {
      var changeBtn = e.target.closest('.btn-change');
      var removeBtn = e.target.closest('.btn-remove');
      if (changeBtn) {
        changeGroup(changeBtn.dataset.course, S.currentGender);
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

    // Single action column — content depends on sub-mode
    var thAction = document.createElement('th');
    thAction.classList.add('col-action');
    thAction.textContent = scheduleSubMode === 'manual' ? 'عملیات' : 'انتخاب';
    tr.appendChild(thAction);
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

      // Action cell — content depends on sub-mode
      var sectionCode = c['کد ارائه'];
      var courseCode = c['کد درس'];
      var hasTime = hasSchedule(c);

      if (scheduleSubMode === 'manual') {
        // Manual mode: section-level add/remove
        var isSelected = selectedMap[sectionCode];
        if (isSelected) {
          cells += '<td class="col-action"><button class="btn-icon btn-added" data-section="' + escAttr(sectionCode) + '" title="حذف از برنامه">✓</button></td>';
        } else if (hasTime) {
          cells += '<td class="col-action"><button class="btn-icon btn-add-course" data-section="' + escAttr(sectionCode) + '" title="افزودن به برنامه">+</button></td>';
        } else {
          cells += '<td class="col-action"><span class="btn-icon btn-no-schedule" title="زمانبندی ندارد">—</span></td>';
        }
      } else {
        // AI mode: course-level selection
        var isDesiredCourse = isDesired(courseCode);
        if (hasTime) {
          if (isDesiredCourse) {
            cells += '<td class="col-action"><button class="btn-icon btn-ai-selected" data-course="' + escAttr(courseCode) + '" title="حذف از لیست هوش مصنوعی">✓</button></td>';
          } else {
            cells += '<td class="col-action"><button class="btn-icon btn-ai-add" data-course="' + escAttr(courseCode) + '" title="افزودن به لیست هوش مصنوعی">+</button></td>';
          }
        } else {
          cells += '<td class="col-action"><span class="btn-icon btn-no-schedule" title="زمانبندی ندارد">—</span></td>';
        }
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
    tbody.removeEventListener('click', handleScheduleTableClick);
    tbody.addEventListener('click', handleScheduleTableClick);
  }

  function handleScheduleTableClick(e) {
    var addBtn = e.target.closest('.btn-add-course');
    var removeBtn = e.target.closest('.btn-added');
    var aiAddBtn = e.target.closest('.btn-ai-add');
    var aiRemoveBtn = e.target.closest('.btn-ai-selected');

    if (addBtn) {
      var course = sectionIndex[addBtn.dataset.section];
      if (course) addCourse(course);
    } else if (removeBtn) {
      removeCourse(removeBtn.dataset.section);
    } else if (aiAddBtn) {
      toggleDesiredCourse(aiAddBtn.dataset.course);
    } else if (aiRemoveBtn) {
      toggleDesiredCourse(aiRemoveBtn.dataset.course);
    }
  }

  // ── Update all views ───────────────────────────────────────────
  function updateAll() {
    renderTimetableBlocks();
    renderSelectedCourses();
    renderStats();
    renderScheduleTable();
    if (scheduleSubMode === 'ai') {
      renderAiCourseTags();
    }
  }

  // ── Sub-mode Toggle ──────────────────────────────────────────
  function setScheduleSubMode(mode) {
    scheduleSubMode = mode;

    // Update tab UI
    $$('.submode-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.submode === mode);
      t.setAttribute('aria-selected', t.dataset.submode === mode ? 'true' : 'false');
    });

    // Toggle visibility of sections
    var aiGenerator = $('#aiGenerator');
    var statsEl = $('#scheduleStats');
    var selectedCourses = $('#selectedCourses');

    if (aiGenerator) aiGenerator.classList.toggle('mode-hidden', mode !== 'ai');
    if (statsEl) statsEl.classList.toggle('mode-hidden', mode !== 'manual');
    if (selectedCourses) selectedCourses.classList.toggle('mode-hidden', mode !== 'manual');

    // Update table header title
    var tableHeader = $('.schedule-course-table .schedule-table-header h2');
    if (tableHeader) {
      tableHeader.textContent = mode === 'ai' ? 'انتخاب دروس برای هوش مصنوعی' : 'انتخاب دروس';
    }

    // Re-render table with appropriate columns
    buildScheduleTableHeader();
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
    // Sub-mode toggle
    $$('#scheduleSubmode .submode-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        setScheduleSubMode(tab.dataset.submode);
      });
    });

    // Click outside timetable blocks to exit edit mode
    var timetableWrapper = $('#timetableWrapper');
    if (timetableWrapper) {
      timetableWrapper.addEventListener('click', function (e) {
        if (editMode && !e.target.closest('.tt-block') && !e.target.closest('.tt-ghost')) {
          exitEditMode();
        }
      });
    }
  }

  // ── Callbacks ──────────────────────────────────────────────────
  S.onCoursesLoaded = function () {
    buildIndex();
    buildScheduleTableHeader();
    renderScheduleTable();
  };

  S.onModeChange = function (mode) {
    // Exit edit mode when switching away from schedule
    if (editMode) exitEditMode();
    if (mode === 'schedule') {
      buildIndex();
      buildScheduleTableHeader();
      renderScheduleTable();
      renderTimetableBlocks();
      renderSelectedCourses();
      renderStats();
      if (scheduleSubMode === 'ai') {
        renderAiCourseTags();
      }
    }
  };

  S.onFiltersChanged = function () {
    renderScheduleTable();
  };

  // ══════════════════════════════════════════════════════════════
  // AI SCHEDULE GENERATOR
  // ══════════════════════════════════════════════════════════════

  var AI_WORKER_URL_META = document.querySelector('meta[name="ai-worker-url"]');
  var AI_WORKER_URL = AI_WORKER_URL_META ? AI_WORKER_URL_META.content : '';

  var desiredCourses = []; // Array of course codes the user wants for AI
  var aiResults = [];     // Schedules returned by Gemini
  var selectedAiSchedule = null; // Currently previewed AI schedule

  // ── Desired courses management ─────────────────────────────────
  function toggleDesiredCourse(courseCode) {
    var idx = desiredCourses.indexOf(courseCode);
    if (idx >= 0) {
      desiredCourses.splice(idx, 1);

      // Clean up orphaned exclusions: remove excluded instructors
      // that only appeared in the removed course
      var removedInstructors = [];
      var sections = courseCodeIndex[courseCode] || [];
      sections.forEach(function (s) {
        var inst = s['نام استاد'];
        if (inst && removedInstructors.indexOf(inst) < 0) removedInstructors.push(inst);
      });
      removedInstructors.forEach(function (inst) {
        if (!isExcludedInstructor(inst)) return;
        var stillUsed = false;
        desiredCourses.forEach(function (code) {
          var secs = courseCodeIndex[code] || [];
          for (var i = 0; i < secs.length; i++) {
            if (secs[i]['نام استاد'] === inst) { stillUsed = true; break; }
          }
        });
        if (!stillUsed) {
          excludedInstructors = excludedInstructors.filter(function (n) { return n !== inst; });
        }
      });
    } else {
      desiredCourses.push(courseCode);
    }
    renderAiCourseTags();
    renderScheduleTable(); // Update buttons
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
      // Find all sections for this course to get instructor(s)
      var sections = courseCodeIndex[code] || [];
      var firstSection = sections.length > 0 ? sections[0] : null;
      var courseName = firstSection ? firstSection['نام درس'] : code;

      // Collect unique instructor names
      var instructors = [];
      sections.forEach(function (s) {
        var name = s['نام استاد'];
        if (name && instructors.indexOf(name) < 0) instructors.push(name);
      });

      html += '<div class="ai-course-card">';
      html += '<div class="ai-course-card-info">';
      html += '<span class="ai-course-card-name">' + S.esc(courseName) + '</span>';
      if (instructors.length > 0) {
        html += '<div class="ai-course-card-instructors">';
        instructors.forEach(function (inst) {
          var excluded = isExcludedInstructor(inst);
          var cls = excluded ? 'instructor-chip instructor-chip-excluded' : 'instructor-chip';
          html += '<span class="' + cls + '">';
          html += S.esc(inst);
          var icon = excluded ? '↺' : '×';
          html += '<button class="chip-remove" data-instructor="' + S.escAttr(inst) + '" title="' + (excluded ? 'بازگرداندن استاد' : 'حذف استاد') + '">' + icon + '</button>';
          html += '</span>';
        });
        html += '</div>';
      }
      html += '</div>';
      html += '<div class="ai-course-card-actions">';
      html += '<button class="btn btn-sm btn-remove" data-code="' + S.escAttr(code) + '" title="حذف درس">×</button>';
      html += '</div>';
      html += '</div>';
    });
    container.innerHTML = html;

    // Event delegation
    container.onclick = function (e) {
      var chipRemoveBtn = e.target.closest('.chip-remove');
      var removeBtn = e.target.closest('.btn-remove');
      if (chipRemoveBtn) {
        var inst = chipRemoveBtn.dataset.instructor;
        if (isExcludedInstructor(inst)) {
          removeExcludedInstructor(inst);
        } else {
          excludeInstructor(inst);
        }
      } else if (removeBtn) {
        toggleDesiredCourse(removeBtn.dataset.code);
      }
    };
  }

  // ── Instructor Exclusion ──────────────────────────────────────
  function excludeInstructor(instructorName) {
    if (!instructorName || excludedInstructors.indexOf(instructorName) >= 0) return;
    excludedInstructors.push(instructorName);
    renderAiCourseTags();
    // If AI results exist, clear them since exclusions changed
    hideAiResults();
  }

  function removeExcludedInstructor(instructorName) {
    excludedInstructors = excludedInstructors.filter(function (name) {
      return name !== instructorName;
    });
    renderAiCourseTags();
    hideAiResults();
  }

  function isExcludedInstructor(instructorName) {
    return excludedInstructors.indexOf(instructorName) >= 0;
  }


  // ── AI Generation ──────────────────────────────────────────────
  function buildAiPayload() {
    var courseGroups = {};
    desiredCourses.forEach(function (code) {
      courseGroups[code] = [];
    });

    S.allCourses.forEach(function (c) {
      var code = c['کد درس'];
      var instructor = c['نام استاد'] || '';
      if (courseGroups[code] && c['زمانبندی تشکیل کلاس']) {
        // Skip excluded instructors
        if (excludedInstructors.indexOf(instructor) >= 0) return;
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
    var emptyCourses = [];
    Object.keys(courseGroups).forEach(function (code) {
      var sections = courseGroups[code];
      if (sections.length > 0) {
        courses.push({
          courseCode: code,
          courseName: sections[0].courseName,
          sections: sections
        });
      } else {
        // Find course name for warning
        var first = null;
        for (var i = 0; i < S.allCourses.length; i++) {
          if (S.allCourses[i]['کد درس'] === code) { first = S.allCourses[i]; break; }
        }
        emptyCourses.push(first ? first['نام درس'] : code);
      }
    });

    return {
      goal: $('#aiGoal').value,
      courses: courses,
      emptyCourses: emptyCourses
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
    if (payload.emptyCourses && payload.emptyCourses.length > 0) {
      showAiError('اساتید این دروس حذف شده‌اند و بخشی باقی نمانده: ' + payload.emptyCourses.join('، '));
      return;
    }
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

    // Defer block placement to next frame so the browser can layout the
    // hidden timetable and return accurate offsetWidth for positioning.
    requestAnimationFrame(function () {
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

          var scaleFactor = S.timetableScaleFactor(previewEl.querySelector('.tt-overlay'));

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
              block.style.left = S.timetableLeftPct(endMin, scaleFactor) + '%';
              block.style.width = S.timetableWidthPct(dur, scaleFactor) + '%';
              block.style.background = color.bg;
              block.style.borderColor = color.border;
              block.style.color = color.text;

              block.title = slot.start + ' – ' + slot.end;
              block.innerHTML =
                '<span class="tt-block-name">' + S.esc(course['نام درس']) + '</span>';

              // Scale font size based on block duration
              var nameSize = Math.min(0.8, Math.max(0.55, 0.55 + dur / 300 * 0.25));
              block.querySelector('.tt-block-name').style.fontSize = nameSize + 'rem';

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
                hatch.style.left = S.timetableLeftPct(gapEnd, scaleFactor) + '%';
                hatch.style.width = S.timetableWidthPct(gapDur, scaleFactor) + '%';
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
    });
  }

  function loadAiSchedule() {
    if (editMode) exitEditMode();
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
