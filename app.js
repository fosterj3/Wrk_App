/* Wrk — a local-first workout tracker.
   All data lives in localStorage on this device. No accounts, no server. */

'use strict';

/* ------------------------------------------------------------------ store */

const STORE_KEY = 'wrk.v1';

const DEFAULTS = {
  version: 1,
  /* theme is left null until first run, when it follows the OS preference. */
  settings: { units: 'lb', restSeconds: 90, calendarView: 'month', theme: null },
  routines: [],
  sessions: [],
  active: null,
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return clone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      ...clone(DEFAULTS),
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
    };
  } catch (err) {
    console.error('Could not read saved data, starting fresh.', err);
    return clone(DEFAULTS);
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error(err);
    toast('Could not save — storage may be full.');
  }
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

/* -------------------------------------------------------- exercise library */

const LIBRARY = [
  { name: 'Barbell Back Squat', type: 'lifting', group: 'Legs' },
  { name: 'Front Squat', type: 'lifting', group: 'Legs' },
  { name: 'Romanian Deadlift', type: 'lifting', group: 'Legs' },
  { name: 'Leg Press', type: 'lifting', group: 'Legs' },
  { name: 'Walking Lunge', type: 'lifting', group: 'Legs' },
  { name: 'Leg Curl', type: 'lifting', group: 'Legs' },
  { name: 'Calf Raise', type: 'lifting', group: 'Legs' },
  { name: 'Barbell Bench Press', type: 'lifting', group: 'Chest' },
  { name: 'Incline Dumbbell Press', type: 'lifting', group: 'Chest' },
  { name: 'Push-Up', type: 'lifting', group: 'Chest' },
  { name: 'Cable Fly', type: 'lifting', group: 'Chest' },
  { name: 'Overhead Press', type: 'lifting', group: 'Shoulders' },
  { name: 'Dumbbell Lateral Raise', type: 'lifting', group: 'Shoulders' },
  { name: 'Face Pull', type: 'lifting', group: 'Shoulders' },
  { name: 'Deadlift', type: 'lifting', group: 'Back' },
  { name: 'Pull-Up', type: 'lifting', group: 'Back' },
  { name: 'Lat Pulldown', type: 'lifting', group: 'Back' },
  { name: 'Barbell Row', type: 'lifting', group: 'Back' },
  { name: 'Seated Cable Row', type: 'lifting', group: 'Back' },
  { name: 'Barbell Curl', type: 'lifting', group: 'Arms' },
  { name: 'Dumbbell Curl', type: 'lifting', group: 'Arms' },
  { name: 'Triceps Pushdown', type: 'lifting', group: 'Arms' },
  { name: 'Skull Crusher', type: 'lifting', group: 'Arms' },
  { name: 'Plank', type: 'lifting', group: 'Core' },
  { name: 'Hanging Leg Raise', type: 'lifting', group: 'Core' },
  { name: 'Cable Crunch', type: 'lifting', group: 'Core' },
  { name: 'Run', type: 'cardio', group: 'Cardio' },
  { name: 'Treadmill', type: 'cardio', group: 'Cardio' },
  { name: 'Walk', type: 'cardio', group: 'Cardio' },
  { name: 'Cycling', type: 'cardio', group: 'Cardio' },
  { name: 'Rowing Machine', type: 'cardio', group: 'Cardio' },
  { name: 'Elliptical', type: 'cardio', group: 'Cardio' },
  { name: 'Stair Climber', type: 'cardio', group: 'Cardio' },
  { name: 'Swimming', type: 'cardio', group: 'Cardio' },
  { name: 'Jump Rope', type: 'cardio', group: 'Cardio' },
];

/* ------------------------------------------------------------- small utils */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function mmss(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}


let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ------------------------------------------------------------------- theme */

const THEME_BAR = { dark: '#08060c', light: '#f5f3ed' };

function applyTheme() {
  const theme = state.settings.theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  /* Keeps the Android status bar in step with the app. */
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_BAR[theme]);
}

/* ------------------------------------------------------------------ sheets */

function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-body').innerHTML = '';
}

/* -------------------------------------------------------------- rest timer */

const rest = { endsAt: 0, total: 0, tick: null };

function startRest(seconds) {
  rest.total = seconds;
  rest.endsAt = Date.now() + seconds * 1000;
  $('#rest-bar').hidden = false;
  clearInterval(rest.tick);
  rest.tick = setInterval(updateRest, 200);
  updateRest();
}

function updateRest() {
  const left = (rest.endsAt - Date.now()) / 1000;
  if (left <= 0) {
    stopRest();
    chime();
    if (navigator.vibrate) navigator.vibrate([220, 90, 220]);
    toast('Rest done');
    return;
  }
  $('#rest-time').textContent = mmss(left);
  $('#rest-fill').style.width = `${(left / rest.total) * 100}%`;
}

function stopRest() {
  clearInterval(rest.tick);
  rest.tick = null;
  $('#rest-bar').hidden = true;
}

let audioCtx;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [0, 0.18].forEach((offset, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain).connect(audioCtx.destination);
      osc.frequency.value = i === 0 ? 660 : 880;
      const t = audioCtx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  } catch (err) {
    /* Audio is a nicety — never let it break the timer. */
  }
}

/* ------------------------------------------------------------------ router */

let currentView = 'workout';
const TITLES = {
  workout: 'Workout',
  routines: 'Routines',
  calendar: 'Calendar',
  data: 'Data',
  settings: 'Settings',
};

function go(view) {
  currentView = view;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${view}`; });
  $('#topbar-title').textContent = TITLES[view];
  render();
}

function render() {
  if (currentView === 'workout') renderWorkout();
  if (currentView === 'routines') renderRoutines();
  if (currentView === 'calendar') renderCalendar();
  if (currentView === 'data') renderData();
  if (currentView === 'settings') renderSettings();
}

/* ------------------------------------------------------------ workout view */

function newSet(type) {
  return type === 'cardio'
    ? { id: uid(), distance: '', minutes: '', done: false }
    : { id: uid(), weight: '', reps: '', done: false };
}

/* A routine item may carry target sets (from an import, or from "save as
   routine"). Older routines have none — they just get one blank set. */
function makeEntry(item) {
  const type = item.type || 'lifting';
  const targets = Array.isArray(item.sets) && item.sets.length ? item.sets : [{}];

  return {
    id: uid(),
    name: item.name,
    type,
    sets: targets.map((t) => {
      const s = newSet(type);
      if (type === 'cardio') {
        if (t.distance != null) s.distance = String(t.distance);
        if (t.minutes != null) s.minutes = String(t.minutes);
      } else {
        if (t.weight != null) s.weight = String(t.weight);
        if (t.reps != null) s.reps = String(t.reps);
      }
      return s;
    }),
  };
}

/* One-line description of an item's targets, e.g. "3 × 8 @ 185" or "5k / 28 min". */
function summarizeItem(item) {
  const sets = Array.isArray(item.sets) ? item.sets : [];
  if (!sets.length) return '';

  if (item.type === 'cardio') {
    const s = sets[0];
    const bits = [];
    if (s.distance != null) bits.push(`${s.distance}${item.distanceUnit || ''}`);
    if (s.minutes != null) bits.push(`${s.minutes} min`);
    const per = bits.join(' / ');
    if (!per) return '';
    return sets.length > 1 ? `${sets.length} × ${per}` : per;
  }

  const first = sets[0];
  const uniform = sets.every((s) => s.reps === first.reps && s.weight === first.weight);
  if (uniform) {
    if (first.reps == null && first.weight == null) return '';
    let out = `${sets.length} × ${item.repsText || first.reps || '—'}`;
    if (first.weight != null) out += ` @ ${first.weight}`;
    return out;
  }
  return sets.map((s) => `${s.weight != null ? `${s.weight}×` : ''}${s.reps == null ? '—' : s.reps}`).join(', ');
}

function startSession(routine) {
  state.active = {
    id: uid(),
    startedAt: new Date().toISOString(),
    name: routine ? routine.name : 'Quick workout',
    routineId: routine ? routine.id : null,
    entries: routine ? routine.items.map(makeEntry) : [],
  };
  save();
  go('workout');
}

function renderWorkout() {
  const el = $('#view-workout');
  const a = state.active;
  const action = $('#btn-header-action');

  if (!a) {
    action.hidden = true;
    el.innerHTML = `
      <div class="empty">
        <h3>No workout in progress</h3>
        <p>Start from scratch, or load one of your routines.</p>
        <button class="btn block" data-action="start-empty">Start empty workout</button>
      </div>
      ${state.routines.length ? `
        <h2 class="small muted" style="margin:22px 0 10px">START FROM A ROUTINE</h2>
        ${state.routines.map((r) => `
          <button class="pick" data-action="start-routine" data-id="${r.id}">
            <div class="grow">
              <div class="nm">${esc(r.name)}</div>
              <div class="card-sub">${r.items.length} exercise${r.items.length === 1 ? '' : 's'}</div>
            </div>
            <span class="muted">&rsaquo;</span>
          </button>`).join('')}
      ` : ''}`;
    return;
  }

  action.hidden = false;
  action.textContent = 'Finish';
  action.dataset.action = 'finish';

  const elapsed = fmtDuration(Date.now() - new Date(a.startedAt).getTime());
  const doneSets = a.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);

  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(a.name)}</div>
          <div class="card-sub" id="session-summary">${elapsed} elapsed &middot; ${doneSets} set${doneSets === 1 ? '' : 's'} done</div>
        </div>
      </div>
      <div class="row wrap">
        <button class="ghost small" data-action="rename-session">Rename</button>
        <button class="ghost small" data-action="save-as-routine">Save as routine</button>
        <div class="spacer"></div>
        <button class="ghost small" data-action="discard" style="color:var(--danger)">Discard</button>
      </div>
    </div>

    ${a.entries.map(renderEntry).join('')}

    <div style="margin-top:14px">
      <button class="btn block secondary" data-action="add-exercise">+ Add exercise</button>
    </div>
    ${a.entries.length
      ? '<div style="margin-top:10px"><button class="btn block" data-action="finish">Finish workout</button></div>'
      : ''}`;
}

function renderEntry(entry) {
  const isCardio = entry.type === 'cardio';
  const unit = state.settings.units === 'kg' ? 'Kg' : 'Lb';
  const cols = isCardio ? ['#', 'Distance', 'Min', '', ''] : ['#', unit, 'Reps', '', ''];

  return `
  <div class="card ex ${isCardio ? 'cardio' : 'lifting'}" data-entry="${entry.id}">
    <div class="ex-head">
      <span class="ex-name">${esc(entry.name)}</span>
      <span class="pill ${isCardio ? 'cardio' : 'lifting'}">${isCardio ? 'cardio' : 'lifting'}</span>
      <div class="spacer"></div>
      <button class="icon-btn" data-action="remove-entry" data-id="${entry.id}" aria-label="Remove exercise">&times;</button>
    </div>

    <div class="set-grid">
      <div class="set-head">${cols.map((c) => `<div>${c}</div>`).join('')}</div>
      ${entry.sets.map((s, i) => `
        <div class="set-row ${s.done ? 'done' : ''}" data-set="${s.id}">
          <div class="set-n">${i + 1}</div>
          <input class="cell" type="number" inputmode="decimal" step="any" placeholder="—"
                 data-field="${isCardio ? 'distance' : 'weight'}"
                 value="${esc(isCardio ? s.distance : s.weight)}">
          <input class="cell" type="number" inputmode="numeric" step="any" placeholder="—"
                 data-field="${isCardio ? 'minutes' : 'reps'}"
                 value="${esc(isCardio ? s.minutes : s.reps)}">
          <button class="check ${s.done ? 'on' : ''}" data-action="toggle-set" aria-label="Mark set done">&#10003;</button>
          <button class="icon-btn" data-action="remove-set" aria-label="Remove set">&minus;</button>
        </div>`).join('')}
    </div>

    <div class="row" style="margin-top:10px">
      <button class="ghost small" data-action="add-set" data-id="${entry.id}">+ Set</button>
    </div>
  </div>`;
}

/* Refresh just the summary line — used after an in-place set toggle. */
function updateSummary() {
  const el = $('#session-summary');
  if (!el || !state.active) return;
  const elapsed = fmtDuration(Date.now() - new Date(state.active.startedAt).getTime());
  const done = state.active.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  el.innerHTML = `${elapsed} elapsed &middot; ${done} set${done === 1 ? '' : 's'} done`;
}

function findSet(entryId, setId) {
  const entry = state.active && state.active.entries.find((e) => e.id === entryId);
  return { entry, set: entry && entry.sets.find((s) => s.id === setId) };
}

function finishSession() {
  const a = state.active;
  if (!a) return;

  const kept = a.entries
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) }))
    .filter((e) => e.sets.length);

  if (!kept.length) {
    if (!confirm('No sets were marked done. Discard this workout?')) return;
    state.active = null;
    stopRest();
    save();
    render();
    return;
  }

  state.sessions.unshift({
    id: a.id,
    name: a.name,
    date: a.startedAt,
    durationMs: Date.now() - new Date(a.startedAt).getTime(),
    entries: kept,
  });
  state.active = null;
  stopRest();
  save();
  toast('Workout saved');
  calCursor = new Date();
  calSelected = dayKey(calCursor);
  go('calendar');
}

/* ----------------------------------------------------------- routines view */

function renderRoutines() {
  const el = $('#view-routines');
  const action = $('#btn-header-action');
  action.hidden = false;
  action.textContent = 'New';
  action.dataset.action = 'new-routine';

  if (!state.routines.length) {
    el.innerHTML = `
      <div class="empty">
        <h3>No routines yet</h3>
        <p>A routine is a saved list of exercises — load it instead of retyping the same workout every time.</p>
        <button class="btn block" data-action="paste-import">Paste from your notes</button>
        <button class="btn block secondary" data-action="new-routine" style="margin-top:8px">Build one by hand</button>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <button class="btn secondary" data-action="paste-import">Paste from notes</button>
      <button class="ghost" data-action="new-routine">New</button>
    </div>
    ${state.routines.map((r) => `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(r.name)}</div>
          <div class="card-sub">${r.items.map((i) => {
            const t = summarizeItem(i);
            return esc(i.name) + (t ? ` <span style="opacity:.7">${esc(t)}</span>` : '');
          }).join('<br>') || 'No exercises yet'}</div>
        </div>
      </div>
      <div class="row">
        <button class="btn secondary" data-action="start-routine" data-id="${r.id}">Start</button>
        <button class="ghost" data-action="edit-routine" data-id="${r.id}">Edit</button>
        <div class="spacer"></div>
        <button class="icon-btn" data-action="delete-routine" data-id="${r.id}" aria-label="Delete routine">&#128465;</button>
      </div>
    </div>`).join('')}`;
}

function editRoutine(id) {
  const r = state.routines.find((x) => x.id === id);
  if (!r) return;

  openSheet('Edit routine', `
    <label class="field">
      <span>Name</span>
      <input class="text" id="routine-name" value="${esc(r.name)}" placeholder="Push Day A">
    </label>
    <div id="routine-items">
      ${r.items.length
        ? r.items.map((it, i) => `
          <div class="pick">
            <div class="grow">
              <div class="nm">${esc(it.name)}</div>
              <div class="card-sub">${esc(summarizeItem(it) || it.type)}</div>
            </div>
            <button class="icon-btn" data-action="routine-remove-item" data-id="${id}" data-index="${i}">&times;</button>
          </div>`).join('')
        : '<p class="muted small">No exercises yet.</p>'}
    </div>
    <button class="btn block secondary" data-action="routine-add-item" data-id="${id}" style="margin-top:8px">+ Add exercise</button>
    <button class="btn block" data-action="routine-save" data-id="${id}" style="margin-top:10px">Save routine</button>`);
}

/* ----------------------------------------------------- paste-in from notes */

const SAMPLE_PASTE = `Push Day A
Bench Press 3x8 @ 185
Incline DB Press 3 sets of 10
Lateral Raises 3x15
Treadmill 20 min

Pull Day
Pull-ups 4x6
Barbell Row 3x8 135lb
Run 3.1 mi 28 min`;

let pendingImport = null;

function openImportSheet(text) {
  openSheet('Paste from your notes', `
    <p class="small muted" style="margin-top:0">
      Paste a workout or a whole program. Most note formats work —
      <code>3x8</code>, <code>3 sets of 10</code>, <code>3 x 8-10 @ 185lb</code>,
      <code>5k in 28 min</code>. Headings like <em>Push Day</em> or <em>Day 1</em>
      become separate routines.
    </p>
    <textarea class="text" id="paste-box" rows="10" spellcheck="false"
              placeholder="${esc(SAMPLE_PASTE)}">${esc(text || '')}</textarea>
    <button class="btn block" data-action="paste-preview" style="margin-top:10px">See what I got</button>
    <button class="linkish" data-action="paste-sample" style="margin-top:6px">Try it with an example</button>`);
}

function renderImportPreview() {
  const { routines, unparsed, units } = pendingImport;

  if (!routines.length) {
    openSheet('Nothing to import', `
      <p>I couldn't find any exercises in that text.</p>
      ${unparsed.length ? `<div class="warnbox"><strong>Lines I couldn't read</strong>
        <ul>${unparsed.slice(0, 12).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
      <button class="btn block secondary" data-action="paste-back" style="margin-top:12px">Back to the text</button>`);
    return;
  }

  const total = routines.reduce((n, r) => n + r.items.length, 0);
  const unitWarning = units.length && !units.includes(state.settings.units);

  openSheet('Check this over', `
    <p class="small muted" style="margin-top:0">
      Found ${total} exercise${total === 1 ? '' : 's'} in
      ${routines.length} routine${routines.length === 1 ? '' : 's'}.
      Rename anything below, or drop what you don't want.
    </p>

    ${unitWarning ? `<div class="warnbox">
      Your notes look like <strong>${esc(units.join('/'))}</strong> but the app is set to
      <strong>${esc(state.settings.units)}</strong>. The numbers are imported as written —
      change the unit in Settings if that's wrong.
    </div>` : ''}

    ${routines.map((r, ri) => `
      <div class="card" style="margin-top:12px">
        <input class="text" data-rname="${ri}" value="${esc(r.name)}" aria-label="Routine name">
        <div style="margin-top:10px">
          ${r.items.map((it, ii) => {
            const t = summarizeItem(it);
            return `
            <div class="pick" style="margin-bottom:6px">
              <div class="grow">
                <div class="nm">${esc(it.name)}
                  ${it.custom ? '<span class="pill" style="margin-left:6px">new</span>' : ''}</div>
                <div class="card-sub">${esc(t || 'no sets given')}</div>
              </div>
              <span class="pill ${it.type}">${it.type}</span>
              <button class="icon-btn" data-action="paste-drop" data-r="${ri}" data-i="${ii}"
                      aria-label="Remove ${esc(it.name)}">&times;</button>
            </div>`;
          }).join('')}
        </div>
      </div>`).join('')}

    ${unparsed.length ? `<div class="warnbox" style="margin-top:14px">
      <strong>Skipped ${unparsed.length} line${unparsed.length === 1 ? '' : 's'}</strong>
      <ul>${unparsed.slice(0, 12).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      ${unparsed.length > 12 ? `<p class="small">…and ${unparsed.length - 12} more.</p>` : ''}
      <p class="small">Go back and reword these if they matter.</p>
    </div>` : ''}

    <button class="btn block" data-action="paste-confirm" style="margin-top:14px">
      Add ${routines.length} routine${routines.length === 1 ? '' : 's'}
    </button>
    <button class="btn block secondary" data-action="paste-back" style="margin-top:8px">Back to the text</button>`);
}

/* Keep any name edits the user made in the preview before acting on it. */
function syncImportNames() {
  if (!pendingImport) return;
  $$('[data-rname]').forEach((input) => {
    const r = pendingImport.routines[Number(input.dataset.rname)];
    if (r) r.name = input.value.trim() || r.name;
  });
}

/* ----------------------------------------------------------- calendar view */

let calCursor = new Date();          // which month/week is on screen
let calSelected = null;              // 'YYYY-MM-DD' of the day being detailed

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* Local-time day key. Deliberately not toISOString(), which shifts to UTC and
   would file an evening workout under the following day. */
function dayKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function keyToDate(key) {
  return new Date(`${key}T00:00:00`);
}

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function sessionsByDay() {
  const map = new Map();
  state.sessions.forEach((s) => {
    const k = dayKey(s.date);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  });
  return map;
}

/* What colour a day gets: lifting, cardio, or both. */
function sessionKind(s) {
  const types = new Set((s.entries || []).map((e) => e.type));
  if (types.size > 1) return 'mixed';
  return types.has('cardio') ? 'cardio' : 'lifting';
}

/* The run of days currently on screen, plus how to label it. Shared by the
   renderer and by the navigation, which needs to know what's in view. */
function calendarDays() {
  const week = state.settings.calendarView === 'week';

  if (week) {
    const start = startOfWeek(calCursor);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return { week, days, title: weekTitle(start), inRange: () => true };
  }

  const first = new Date(calCursor.getFullYear(), calCursor.getMonth(), 1);
  const last = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 0);
  const start = startOfWeek(first);
  const cells = Math.ceil((Math.round((last - start) / 86400000) + 1) / 7) * 7;

  const days = [];
  for (let i = 0; i < cells; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  return {
    week,
    days,
    title: calCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    inRange: (d) => d.getMonth() === calCursor.getMonth(),
  };
}

/* After navigating, keep the detail panel showing something that's actually
   on screen: today if it's visible, otherwise the first day with a workout. */
function selectDefaultDay() {
  const { days, inRange } = calendarDays();
  const inView = days.filter(inRange);
  if (!inView.length) return;

  const byDay = sessionsByDay();
  const todayKey = dayKey(new Date());
  const today = inView.find((d) => dayKey(d) === todayKey);
  const worked = inView.find((d) => byDay.has(dayKey(d)));
  calSelected = dayKey(today || worked || inView[0]);
}

function shiftCalendar(dir) {
  if (state.settings.calendarView === 'week') {
    calCursor.setDate(calCursor.getDate() + 7 * dir);
  } else {
    calCursor.setMonth(calCursor.getMonth() + dir, 1);
  }
  selectDefaultDay();
  render();
}

function weekTitle(start) {
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString(undefined, { month: 'long' })} ${start.getDate()}–${end.getDate()}`;
  }
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

function renderCalendar() {
  const el = $('#view-calendar');
  const action = $('#btn-header-action');
  action.hidden = false;
  action.textContent = 'Today';
  action.dataset.action = 'cal-today';

  const byDay = sessionsByDay();
  const todayKey = dayKey(new Date());
  if (!calSelected) calSelected = todayKey;

  const { week, days, title, inRange } = calendarDays();

  const workoutDays = days.filter((d) => inRange(d) && byDay.has(dayKey(d))).length;
  const totalSessions = days.reduce((n, d) => n + (inRange(d) ? (byDay.get(dayKey(d)) || []).length : 0), 0);

  const cellsHtml = days.map((d) => {
    const key = dayKey(d);
    const list = byDay.get(key) || [];
    const classes = [
      'cal-cell',
      week ? 'week' : '',
      inRange(d) ? '' : 'out',
      key === todayKey ? 'today' : '',
      key === calSelected ? 'sel' : '',
      list.length ? 'has' : '',
    ].filter(Boolean).join(' ');

    const marks = week
      ? list.slice(0, 3).map((s) => `
          <span class="cal-chip k-${sessionKind(s)}">${esc(s.name)}</span>`).join('')
      : `<span class="cal-dots">${list.slice(0, 3)
            .map((s) => `<span class="cal-dot k-${sessionKind(s)}"></span>`).join('')}</span>`;

    const label = `${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${
      list.length ? `${list.length} workout${list.length === 1 ? '' : 's'}` : 'no workout'}`;

    return `
      <button class="${classes}" data-action="cal-day" data-key="${key}" aria-label="${esc(label)}">
        <span class="cal-num">${d.getDate()}</span>
        ${marks}
        ${list.length > 3 ? `<span class="cal-more">+${list.length - 3}</span>` : ''}
      </button>`;
  }).join('');

  el.innerHTML = `
    <div class="cal-head">
      <button class="icon-btn" data-action="cal-prev" aria-label="Previous">&lsaquo;</button>
      <div class="cal-title">${esc(title)}</div>
      <button class="icon-btn" data-action="cal-next" aria-label="Next">&rsaquo;</button>
    </div>

    <div class="row" style="justify-content:center;margin-bottom:12px">
      <div class="seg">
        <button data-action="cal-mode" data-mode="month" class="${week ? '' : 'on'}">Month</button>
        <button data-action="cal-mode" data-mode="week" class="${week ? 'on' : ''}">Week</button>
      </div>
    </div>

    <div class="cal-grid">
      ${DOW.map((n) => `<div class="cal-dow">${n}</div>`).join('')}
      ${cellsHtml}
    </div>

    <div class="cal-legend">
      <span><i class="cal-dot k-lifting"></i>Lifting</span>
      <span><i class="cal-dot k-cardio"></i>Cardio</span>
      <span><i class="cal-dot k-mixed"></i>Both</span>
    </div>

    <p class="small muted center" style="margin-top:10px">
      ${workoutDays
        ? `${workoutDays} active day${workoutDays === 1 ? '' : 's'} &middot; ${totalSessions} workout${totalSessions === 1 ? '' : 's'} this ${week ? 'week' : 'month'}`
        : `Nothing logged this ${week ? 'week' : 'month'}`}
    </p>

    ${renderDayDetail(calSelected, byDay.get(calSelected) || [])}`;
}

function renderDayDetail(key, sessions) {
  if (!key) return '';
  const heading = keyToDate(key).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  if (!sessions.length) {
    return `
      <div class="card" style="margin-top:16px">
        <div class="card-title">${esc(heading)}</div>
        <p class="small muted" style="margin:6px 0 0">Rest day — nothing logged.</p>
      </div>`;
  }

  return `
    <div class="card" style="margin-top:16px">
      <div class="card-title">${esc(heading)}</div>
      ${sessions.map((s) => {
        const sets = s.entries.reduce((n, e) => n + e.sets.length, 0);
        const time = new Date(s.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return `
        <div class="sess k-${sessionKind(s)}">
          <div class="row">
            <div class="grow">
              <div style="font-weight:650">${esc(s.name)}</div>
              <div class="small muted">${time} &middot; ${fmtDuration(s.durationMs)} &middot; ${sets} set${sets === 1 ? '' : 's'}</div>
            </div>
            <button class="icon-btn" data-action="delete-session" data-id="${s.id}"
                    aria-label="Delete ${esc(s.name)}">&#128465;</button>
          </div>
          ${s.entries.map((e) => `
            <div class="small" style="margin-top:6px">
              <span style="font-weight:600">${esc(e.name)}</span>
              <span class="muted">${e.sets.map((set) => e.type === 'cardio'
                ? `${esc(set.distance) || '—'}/${esc(set.minutes) || '—'}min`
                : `${esc(set.weight) || '—'}${state.settings.units}&times;${esc(set.reps) || '—'}`).join(', ')}</span>
            </div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
}

/* --------------------------------------------------------------- data view */

let dataRange = '12w';
let dataExercise = null;
let dataMetric = 'e1rm';

function renderData() {
  const el = $('#view-data');
  $('#btn-header-action').hidden = true;

  if (!state.sessions.length) {
    el.innerHTML = `
      <div class="empty">
        <h3>No data yet</h3>
        <p>Finish a workout or two and your charts will show up here.</p>
      </div>`;
    return;
  }

  const all = state.sessions;
  const { mode, buckets } = makeBuckets(dataRange, all);
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;
  const inRange = sessionsIn(all, from, to);
  const now = new Date();

  /* Same-length window immediately before this one, for the headline delta. */
  const prevFrom = new Date(+from - (+to - +from));
  const prev = sessionsIn(all, prevFrom, from).length;
  const delta = inRange.length - prev;

  const volume = inRange.reduce((n, s) => n + sessionVolume(s), 0);
  const cardioMin = inRange.reduce((n, s) => n + sessionCardioMinutes(s), 0);
  const perWeek = inRange.length / Math.max(1, buckets.length * (mode === 'month' ? 4.35 : 1));
  const streak = currentStreak(all);

  /* --- per-bucket series --- */
  const freq = buckets.map((b) => {
    const list = sessionsIn(all, b.start, b.end);
    return {
      label: b.label,
      value: list.length,
      partial: now >= b.start && now < b.end,
      tip: `${b.full}\n${list.length} workout${list.length === 1 ? '' : 's'}`
        + (now >= b.start && now < b.end ? '\n(still in progress)' : ''),
    };
  });

  const volSeries = buckets.map((b) => {
    const v = sessionsIn(all, b.start, b.end).reduce((n, s) => n + sessionVolume(s), 0);
    return {
      label: b.label,
      value: v,
      partial: now >= b.start && now < b.end,
      tip: `${b.full}\n${compact(v)} ${state.settings.units} lifted`,
    };
  });

  const cardioSeries = buckets.map((b) => {
    const v = sessionsIn(all, b.start, b.end).reduce((n, s) => n + sessionCardioMinutes(s), 0);
    return {
      label: b.label,
      value: Math.round(v),
      partial: now >= b.start && now < b.end,
      tip: `${b.full}\n${Math.round(v)} min of cardio`,
    };
  });

  /* --- training split --- */
  const kinds = { lifting: 0, cardio: 0, mixed: 0 };
  inRange.forEach((s) => { kinds[sessionKind(s)]++; });
  const splitSegments = [
    { key: 'lifting', name: 'Lifting', value: kinds.lifting, tip: `Lifting only\n${kinds.lifting} workouts` },
    { key: 'cardio', name: 'Cardio', value: kinds.cardio, tip: `Cardio only\n${kinds.cardio} workouts` },
    { key: 'mixed', name: 'Both', value: kinds.mixed, tip: `Lifting and cardio\n${kinds.mixed} workouts` },
  ];

  /* --- strength progression --- */
  const tracked = trackableExercises(all);
  if (!dataExercise || !tracked.includes(dataExercise)) dataExercise = tracked[0] || null;
  const progress = dataExercise
    ? exerciseSeries(inRange, dataExercise, dataMetric).map((p) => ({
        ...p,
        tip: `${p.label}\n${p.value} ${state.settings.units}`
          + (dataMetric === 'e1rm' ? ' est. 1RM' : ' top set'),
      }))
    : [];

  const top = topExercises(inRange, 6).map((e) => ({
    label: e.name.length > 20 ? `${e.name.slice(0, 19)}…` : e.name,
    value: e.sets,
    tip: `${e.name}\n${e.sets} set${e.sets === 1 ? '' : 's'}`,
  }));

  const unit = state.settings.units;
  const hasLifting = volSeries.some((d) => d.value > 0);
  const hasCardio = cardioSeries.some((d) => d.value > 0);

  el.innerHTML = `
    <div class="row" style="justify-content:center;margin-bottom:14px">
      <div class="seg wrap">
        ${Object.entries(RANGES).map(([k, r]) => `
          <button data-action="data-range" data-val="${k}" class="${dataRange === k ? 'on' : ''}">${r.label}</button>`).join('')}
      </div>
    </div>

    <div class="card center">
      <div class="stat-label">Workouts &middot; ${esc(RANGES[dataRange].label.toLowerCase())}</div>
      <div class="hero">${inRange.length}</div>
      ${prev > 0 || inRange.length > 0 ? `
        <div class="delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">
          ${delta > 0 ? '&uarr;' : delta < 0 ? '&darr;' : '&mdash;'}
          ${delta === 0 ? 'same as' : `${Math.abs(delta)} vs`} previous ${esc(RANGES[dataRange].label.toLowerCase())}
        </div>` : ''}
    </div>

    <div class="tiles">
      <div class="card tile">
        <div class="stat-label">Per week</div>
        <div class="stat-value">${perWeek.toFixed(1)}</div>
      </div>
      <div class="card tile">
        <div class="stat-label">Streak</div>
        <div class="stat-value">${streak}<span class="stat-unit">wk</span></div>
      </div>
      <div class="card tile">
        <div class="stat-label">Volume</div>
        <div class="stat-value">${compact(volume)}<span class="stat-unit">${esc(unit)}</span></div>
      </div>
      <div class="card tile">
        <div class="stat-label">Cardio</div>
        <div class="stat-value">${compact(cardioMin)}<span class="stat-unit">min</span></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">How often you trained</div>
      <div class="card-sub">Workouts per ${mode}</div>
      ${columnChart(freq, (v) => v)}
    </div>

    ${kinds.lifting + kinds.cardio + kinds.mixed ? `
    <div class="card">
      <div class="card-title">What kind of training</div>
      <div class="card-sub">${inRange.length} workout${inRange.length === 1 ? '' : 's'} by type</div>
      ${stackedBar(splitSegments)}
      <div class="viz-legend">
        ${splitSegments.map((s) => `
          <span><i class="k-${s.key}"></i>${s.name} <b>${s.value}</b></span>`).join('')}
      </div>
    </div>` : ''}

    ${tracked.length ? `
    <div class="card">
      <div class="card-title">Strength progress</div>
      <div class="card-sub">Best set each session, in ${esc(unit)}</div>
      <div class="row wrap" style="margin:10px 0 4px">
        <select class="text slim" data-select="exercise">
          ${tracked.map((n) => `<option value="${esc(n)}" ${n === dataExercise ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <div class="seg">
          <button data-action="data-metric" data-val="e1rm" class="${dataMetric === 'e1rm' ? 'on' : ''}">Est. 1RM</button>
          <button data-action="data-metric" data-val="top" class="${dataMetric === 'top' ? 'on' : ''}">Top set</button>
        </div>
      </div>
      ${progress.length >= 2
        ? columnOrLine(progress, unit)
        : `<p class="small muted">Not enough sessions with ${esc(dataExercise || 'this exercise')} in this range yet — log it twice and the line appears.</p>`}
      ${dataMetric === 'e1rm' && progress.length >= 2
        ? '<p class="small muted" style="margin:8px 0 0">Estimated one-rep max (Epley), so heavy triples and lighter sets of ten stay comparable.</p>'
        : ''}
    </div>` : ''}

    ${hasLifting ? `
    <div class="card">
      <div class="card-title">Lifting volume</div>
      <div class="card-sub">Weight &times; reps, totalled per ${mode}</div>
      ${columnChart(volSeries, (v) => compact(v))}
    </div>` : ''}

    ${hasCardio ? `
    <div class="card">
      <div class="card-title">Cardio minutes</div>
      <div class="card-sub">Totalled per ${mode}</div>
      ${columnChart(cardioSeries, (v) => compact(v))}
    </div>` : ''}

    ${top.length ? `
    <div class="card">
      <div class="card-title">Most-trained exercises</div>
      <div class="card-sub">By sets logged</div>
      ${barRows(top, (v) => v)}
    </div>` : ''}`;
}

function columnOrLine(points, unit) {
  return lineChart(points, (v) => `${compact(v)} ${unit}`);
}

/* ----------------------------------------------------------- settings view */

function renderSettings() {
  const el = $('#view-settings');
  $('#btn-header-action').hidden = true;
  const st = state.settings;

  el.innerHTML = `
    <div class="card">
      <div class="card-title" style="margin-bottom:12px">Preferences</div>
      <label class="field">
        <span>Appearance</span>
        <div class="seg">
          <button data-action="theme" data-val="dark" class="${st.theme === 'light' ? '' : 'on'}">Dark</button>
          <button data-action="theme" data-val="light" class="${st.theme === 'light' ? 'on' : ''}">Light</button>
        </div>
      </label>
      <label class="field">
        <span>Weight units</span>
        <select class="text" data-setting="units">
          <option value="lb" ${st.units === 'lb' ? 'selected' : ''}>Pounds (lb)</option>
          <option value="kg" ${st.units === 'kg' ? 'selected' : ''}>Kilograms (kg)</option>
        </select>
      </label>
      <label class="field">
        <span>Default rest timer (seconds) — 0 turns it off</span>
        <input class="text" type="number" inputmode="numeric" min="0" max="600"
               data-setting="restSeconds" value="${st.restSeconds}">
      </label>
    </div>

    <div class="card">
      <div class="card-title">Your data</div>
      <p class="small muted">Everything is stored on this device only. Export a backup now and then —
        clearing your browser data, or a long stretch without opening the app on iPhone, can wipe it.</p>
      <button class="btn block secondary" data-action="export">Export backup file</button>
      <button class="btn block secondary" data-action="import" style="margin-top:8px">Import backup file</button>
      <button class="btn block danger" data-action="wipe" style="margin-top:14px">Erase all data</button>
    </div>

    <p class="small muted center" style="margin-top:18px">
      ${state.sessions.length} workout${state.sessions.length === 1 ? '' : 's'} &middot;
      ${state.routines.length} routine${state.routines.length === 1 ? '' : 's'}
    </p>`;
}

function exportData() {
  const payload = {
    version: state.version,
    settings: state.settings,
    routines: state.routines,
    sessions: state.sessions,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wrk-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';

  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.sessions) || !Array.isArray(data.routines)) {
          throw new Error('this does not look like a Wrk backup');
        }
        if (!confirm(`Replace everything on this device with ${data.sessions.length} workouts and ${data.routines.length} routines?`)) return;
        state = {
          ...clone(DEFAULTS),
          ...data,
          settings: { ...DEFAULTS.settings, ...(data.settings || {}) },
          active: null,
        };
        save();
        render();
        toast('Backup restored');
      } catch (err) {
        console.error(err);
        alert(`Could not read that file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  input.click();
}

/* --------------------------------------------------------- exercise picker */

function exercisePicker(onPickAction, contextId) {
  const groups = [...new Set(LIBRARY.map((e) => e.group))];

  openSheet('Add exercise', `
    <input class="text" id="ex-search" placeholder="Search, or type a custom name" autocomplete="off">
    <button class="btn block secondary" data-action="add-custom" data-ctx="${contextId || ''}"
            data-pick="${onPickAction}" style="margin:10px 0 16px">Add as custom exercise</button>
    <div id="ex-list">
      ${groups.map((g) => `
        <h3 class="small muted" style="margin:14px 0 8px">${g.toUpperCase()}</h3>
        ${LIBRARY.filter((e) => e.group === g).map((e) => `
          <button class="pick" data-action="${onPickAction}" data-ctx="${contextId || ''}"
                  data-name="${esc(e.name)}" data-type="${e.type}">
            <div class="grow"><div class="nm">${esc(e.name)}</div></div>
            <span class="pill ${e.type}">${e.type}</span>
          </button>`).join('')}`).join('')}
    </div>`);

  $('#ex-search').addEventListener('input', (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    $$('#ex-list .pick').forEach((btn) => {
      btn.style.display = btn.dataset.name.toLowerCase().includes(q) ? '' : 'none';
    });
    $$('#ex-list h3').forEach((h) => {
      let sib = h.nextElementSibling;
      let any = false;
      while (sib && sib.tagName === 'BUTTON') {
        if (sib.style.display !== 'none') any = true;
        sib = sib.nextElementSibling;
      }
      h.style.display = any ? '' : 'none';
    });
  });
}

/* ------------------------------------------------------------ interactions */

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-action], [data-close]');
  if (!btn) return;

  if (btn.hasAttribute('data-close')) { closeSheet(); return; }

  const { action, id } = btn.dataset;
  const row = btn.closest('[data-set]');
  const card = btn.closest('[data-entry]');

  switch (action) {
    /* ---- starting and ending workouts ---- */
    case 'start-empty':
      if (state.active && !confirm('You already have a workout in progress. Replace it?')) return;
      startSession(null);
      break;

    case 'start-routine': {
      const r = state.routines.find((x) => x.id === id);
      if (!r) return;
      if (state.active && !confirm('You already have a workout in progress. Replace it?')) return;
      startSession(r);
      break;
    }

    case 'finish':
      finishSession();
      break;

    case 'discard':
      if (!confirm('Discard this workout? It will not be saved.')) return;
      state.active = null;
      stopRest();
      save();
      render();
      break;

    case 'rename-session': {
      const name = prompt('Name this workout', state.active.name);
      if (name === null) return;
      state.active.name = name.trim() || state.active.name;
      save();
      render();
      break;
    }

    case 'save-as-routine': {
      if (!state.active.entries.length) { toast('Add an exercise first'); return; }
      const name = prompt('Name this routine', state.active.name);
      if (name === null) return;
      state.routines.push({
        id: uid(),
        name: name.trim() || 'Untitled routine',
        /* Carry the numbers across so the routine remembers your working weights. */
        items: state.active.entries.map((e) => ({
          name: e.name,
          type: e.type,
          sets: e.sets.map((s) => (e.type === 'cardio'
            ? { ...(s.distance !== '' && { distance: Number(s.distance) }),
                ...(s.minutes !== '' && { minutes: Number(s.minutes) }) }
            : { ...(s.weight !== '' && { weight: Number(s.weight) }),
                ...(s.reps !== '' && { reps: Number(s.reps) }) })),
        })),
      });
      save();
      toast('Routine saved');
      break;
    }

    /* ---- exercises and sets ---- */
    case 'add-exercise':
      exercisePicker('pick-into-session');
      break;

    case 'pick-into-session':
      state.active.entries.push(makeEntry({ name: btn.dataset.name, type: btn.dataset.type }));
      save();
      closeSheet();
      render();
      break;

    case 'remove-entry':
      if (!confirm('Remove this exercise from the workout?')) return;
      state.active.entries = state.active.entries.filter((e) => e.id !== id);
      save();
      render();
      break;

    case 'add-set': {
      const entry = state.active.entries.find((e) => e.id === id);
      entry.sets.push(newSet(entry.type));
      save();
      render();
      break;
    }

    case 'remove-set': {
      const { entry } = findSet(card.dataset.entry, row.dataset.set);
      entry.sets = entry.sets.filter((s) => s.id !== row.dataset.set);
      if (!entry.sets.length) entry.sets.push(newSet(entry.type));
      save();
      render();
      break;
    }

    case 'toggle-set': {
      const { set } = findSet(card.dataset.entry, row.dataset.set);
      set.done = !set.done;
      save();
      /* Update in place instead of re-rendering, so typing focus isn't lost. */
      row.classList.toggle('done', set.done);
      btn.classList.toggle('on', set.done);
      updateSummary();
      if (set.done && state.settings.restSeconds > 0) startRest(state.settings.restSeconds);
      break;
    }

    /* ---- routines ---- */
    case 'new-routine': {
      const name = prompt('Routine name', 'Push Day A');
      if (name === null) return;
      const r = { id: uid(), name: name.trim() || 'Untitled routine', items: [] };
      state.routines.push(r);
      save();
      go('routines');
      editRoutine(r.id);
      break;
    }

    case 'edit-routine':
      editRoutine(id);
      break;

    /* ---- paste-in from notes ---- */
    case 'paste-import':
      openImportSheet('');
      break;

    case 'paste-sample':
      $('#paste-box').value = SAMPLE_PASTE;
      break;

    case 'paste-preview': {
      const text = $('#paste-box').value;
      if (!text.trim()) { toast('Paste something first'); return; }
      pendingImport = parseWorkoutText(text);
      pendingImport.text = text;
      renderImportPreview();
      break;
    }

    case 'paste-back':
      syncImportNames();
      openImportSheet(pendingImport ? pendingImport.text : '');
      break;

    case 'paste-drop': {
      syncImportNames();
      const r = pendingImport.routines[Number(btn.dataset.r)];
      r.items.splice(Number(btn.dataset.i), 1);
      pendingImport.routines = pendingImport.routines.filter((x) => x.items.length);
      renderImportPreview();
      break;
    }

    case 'paste-confirm': {
      syncImportNames();
      const added = pendingImport.routines.length;
      pendingImport.routines.forEach((r) => {
        state.routines.push({ id: uid(), name: r.name, items: r.items });
      });
      pendingImport = null;
      save();
      closeSheet();
      go('routines');
      toast(`Added ${added} routine${added === 1 ? '' : 's'}`);
      break;
    }

    case 'delete-routine':
      if (!confirm('Delete this routine? Workouts you already logged are not affected.')) return;
      state.routines = state.routines.filter((r) => r.id !== id);
      save();
      render();
      break;

    case 'routine-add-item': {
      /* Keep any name edit before the picker replaces the sheet. */
      const nameInput = $('#routine-name');
      const r = state.routines.find((x) => x.id === id);
      if (nameInput && r) { r.name = nameInput.value.trim() || r.name; save(); }
      exercisePicker('pick-into-routine', id);
      break;
    }

    case 'pick-into-routine': {
      const r = state.routines.find((x) => x.id === btn.dataset.ctx);
      r.items.push({ name: btn.dataset.name, type: btn.dataset.type });
      save();
      editRoutine(r.id);
      break;
    }

    case 'routine-remove-item': {
      const r = state.routines.find((x) => x.id === id);
      r.items.splice(Number(btn.dataset.index), 1);
      save();
      editRoutine(r.id);
      break;
    }

    case 'routine-save': {
      const r = state.routines.find((x) => x.id === id);
      r.name = $('#routine-name').value.trim() || r.name;
      save();
      closeSheet();
      render();
      toast('Routine saved');
      break;
    }

    case 'add-custom': {
      const name = ($('#ex-search') ? $('#ex-search').value : '').trim();
      if (!name) { toast('Type a name first'); return; }
      const type = confirm('Is this a cardio exercise?\n\nOK = cardio, Cancel = lifting') ? 'cardio' : 'lifting';
      if (btn.dataset.pick === 'pick-into-routine') {
        const r = state.routines.find((x) => x.id === btn.dataset.ctx);
        r.items.push({ name, type });
        save();
        editRoutine(r.id);
      } else {
        state.active.entries.push(makeEntry({ name, type }));
        save();
        closeSheet();
        render();
      }
      break;
    }

    /* ---- calendar ---- */
    case 'cal-prev':
      shiftCalendar(-1);
      break;

    case 'cal-next':
      shiftCalendar(1);
      break;

    case 'cal-today':
      calCursor = new Date();
      calSelected = dayKey(calCursor);
      render();
      break;

    case 'cal-mode':
      state.settings.calendarView = btn.dataset.mode;
      /* Follow the selected day into the new view so it doesn't jump elsewhere. */
      calCursor = keyToDate(calSelected || dayKey(new Date()));
      save();
      render();
      break;

    case 'cal-day': {
      calSelected = btn.dataset.key;
      const picked = keyToDate(calSelected);
      /* Tapping a spill-over day from a neighbouring month moves the view there. */
      if (state.settings.calendarView !== 'week' && picked.getMonth() !== calCursor.getMonth()) {
        calCursor = picked;
      }
      render();
      break;
    }

    /* ---- history ---- */
    case 'delete-session':
      if (!confirm('Delete this logged workout?')) return;
      state.sessions = state.sessions.filter((s) => s.id !== id);
      save();
      render();
      break;

    /* ---- data ---- */
    case 'data-range':
      dataRange = btn.dataset.val;
      hideTip();
      render();
      break;

    case 'data-metric':
      dataMetric = btn.dataset.val;
      hideTip();
      render();
      break;

    /* ---- settings ---- */
    case 'theme':
      state.settings.theme = btn.dataset.val;
      save();
      applyTheme();
      render();
      break;

    case 'export':
      exportData();
      break;

    case 'import':
      importData();
      break;

    case 'wipe':
      if (!confirm('Erase every workout, routine and setting on this device? This cannot be undone.')) return;
      if (!confirm('Really erase everything?')) return;
      state = clone(DEFAULTS);
      save();
      render();
      toast('All data erased');
      break;
  }
});

/* Set cells and settings write straight to state — no re-render, so focus survives. */
document.addEventListener('input', (ev) => {
  const el = ev.target;

  if (el.dataset.field) {
    const row = el.closest('[data-set]');
    const card = el.closest('[data-entry]');
    const { set } = findSet(card.dataset.entry, row.dataset.set);
    if (set) { set[el.dataset.field] = el.value; save(); }
    return;
  }

  if (el.dataset.select === 'exercise') {
    dataExercise = el.value;
    render();
    return;
  }

  if (el.dataset.setting) {
    const key = el.dataset.setting;
    state.settings[key] = key === 'restSeconds' ? Math.max(0, Number(el.value) || 0) : el.value;
    save();
  }
});

/* ---- chart tooltips ----
   An SVG chart should be inspectable. Marks carry an oversized invisible hit
   rect so a fingertip can land on them; the same handler covers mouse hover
   and touch. */

function hideTip() {
  $('#viz-tip').hidden = true;
}

function showTip(target, clientX, clientY) {
  const tip = $('#viz-tip');
  tip.innerHTML = String(target.dataset.tip || '')
    .split('\n')
    .map((line, i) => `<span class="${i ? 'tip-sub' : 'tip-head'}">${esc(line)}</span>`)
    .join('');
  tip.hidden = false;

  const box = tip.getBoundingClientRect();
  const pad = 8;
  let left = clientX - box.width / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - box.width - pad));
  let top = clientY - box.height - 14;
  if (top < pad) top = clientY + 18;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

document.addEventListener('pointermove', (ev) => {
  const mark = ev.target.closest && ev.target.closest('[data-tip]');
  if (mark) showTip(mark, ev.clientX, ev.clientY);
  else if (ev.pointerType === 'mouse') hideTip();
});

document.addEventListener('pointerdown', (ev) => {
  const mark = ev.target.closest && ev.target.closest('[data-tip]');
  if (mark) showTip(mark, ev.clientX, ev.clientY);
  else hideTip();
});

document.addEventListener('pointerup', (ev) => {
  if (ev.pointerType !== 'mouse') setTimeout(hideTip, 2000);
});

window.addEventListener('scroll', hideTip, { passive: true });

$$('.tab').forEach((tab) => tab.addEventListener('click', () => { hideTip(); go(tab.dataset.view); }));
$('#rest-skip').addEventListener('click', stopRest);
$('#rest-add').addEventListener('click', () => {
  rest.endsAt += 30000;
  rest.total += 30;
  updateRest();
});

/* Keep the "elapsed" line honest while a workout is open. */
setInterval(() => {
  if (state.active && currentView === 'workout' && $('#sheet').hidden && !$('.cell:focus')) render();
}, 30000);

window.addEventListener('beforeunload', save);

/* First run: follow whatever the phone is already set to. */
if (!state.settings.theme) {
  state.settings.theme = window.matchMedia
    && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  save();
}
applyTheme();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  });
}

go('workout');
