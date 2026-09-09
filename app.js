/* Cadence — a local-first workout log.
   All data lives in localStorage on this device. No accounts, no server. */

'use strict';

/* ------------------------------------------------------------------ store */

/* Deliberately still 'wrk.v1' — the app was renamed to Cadence, but changing
   this key would orphan every existing user's training history. */
const STORE_KEY = 'wrk.v1';

const DEFAULTS = {
  version: 1,
  /* theme is left null until first run, when it follows the OS preference. */
  settings: {
    units: 'lb', restSeconds: 90, calendarView: 'month', theme: null,
    weeklyGoal: 3, barWeight: 45, lastExport: null, backupSnooze: null,
    alertSound: 'beep', alertVolume: 0.9, keepAwake: true,
  },
  routines: [],
  weights: [],          /* bodyweight log: [{ id, date, value }] */
  sessions: [],
  active: null,
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return clone(DEFAULTS);
    /* Surviving unparseable JSON isn't enough — JSON that parses into the
       wrong shape used to crash the first render, which is a blank screen with
       no way back except wiping the log. */
    return normalizeState(JSON.parse(raw), clone(DEFAULTS));
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

/* Settings stored as numbers rather than the input's string value. */
const NUMERIC_SETTINGS = ['restSeconds', 'weeklyGoal', 'barWeight', 'goalWeight'];

function clone(v) { return JSON.parse(JSON.stringify(v)); }


/* ------------------------------------------------------------- small utils */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));


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
/**
 * @param {string} msg
 * @param {{label: string, run: Function}} [action] Adds a button — used for
 *   Undo, so a deletion is reversible rather than merely hard to trigger.
 */
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = '';

  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(text);

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      el.hidden = true;
      clearTimeout(toastTimer);
      action.run();
    });
    el.appendChild(btn);
  }

  el.hidden = false;
  clearTimeout(toastTimer);
  /* Longer when there's something to click, so it can actually be clicked. */
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2200);
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
  /* The tab bar's backdrop-filter makes its own compositing layer, which paints
     over the sheet regardless of z-index. Navigating is meaningless behind a
     modal anyway, so take it out while the sheet is up. */
  document.body.classList.add('sheet-open');
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-body').innerHTML = '';
  document.body.classList.remove('sheet-open');
}

/* -------------------------------------------------------------- rest timer */

/**
 * One bar, two jobs.
 *
 *   'rest'      counts down — between sets and exercises. Ends by itself.
 *   'stopwatch' counts up — for a plank or any held position. Ends when you
 *               stop it, and writes the elapsed seconds into the set.
 */
const timer = {
  mode: null,
  tick: null,
  endsAt: 0,
  total: 0,
  startedAt: 0,
  target: 0,
  entryId: null,
  setId: null,
  hitTarget: false,
};

function startRest(seconds) {
  Object.assign(timer, {
    mode: 'rest',
    total: seconds,
    endsAt: Date.now() + seconds * 1000,
    entryId: null,
    setId: null,
  });
  $('#timer-label').textContent = 'Rest';
  $('#timer-plus').hidden = false;
  $('#timer-stop').textContent = 'Skip';
  runTimer();
}

/** @param {number} target Seconds to chime at, or 0 for a plain stopwatch. */
function startStopwatch(entryId, setId, target) {
  Object.assign(timer, {
    mode: 'stopwatch',
    startedAt: Date.now(),
    target: target || 0,
    entryId,
    setId,
    hitTarget: false,
  });
  const entry = state.active.entries.find((e) => e.id === entryId);
  $('#timer-label').textContent = entry ? entry.name : 'Timing';
  $('#timer-plus').hidden = true;
  $('#timer-stop').textContent = 'Done';
  runTimer();
}

function runTimer() {
  $('#timer-bar').hidden = false;
  $('#timer-bar').classList.toggle('counting-up', timer.mode === 'stopwatch');
  clearInterval(timer.tick);
  timer.tick = setInterval(updateTimer, 200);
  updateTimer();
}

function updateTimer() {
  if (timer.mode === 'rest') {
    const left = (timer.endsAt - Date.now()) / 1000;
    if (left <= 0) {
      stopTimer();
      alarm();
      toast('Rest done');
      return;
    }
    $('#timer-time').textContent = mmss(left);
    $('#timer-fill').style.width = `${(left / timer.total) * 100}%`;
    return;
  }

  const elapsed = (Date.now() - timer.startedAt) / 1000;
  $('#timer-time').textContent = mmss(elapsed);

  if (timer.target > 0) {
    $('#timer-fill').style.width = `${Math.min(100, (elapsed / timer.target) * 100)}%`;
    /* Sound the target but keep counting — going past it is the point. */
    if (!timer.hitTarget && elapsed >= timer.target) {
      timer.hitTarget = true;
      alarm();
      toast(`${timer.target}s reached`);
    }
  } else {
    $('#timer-fill').style.width = '100%';
  }
}

/** Stops the timer. For a stopwatch, records the time onto its set. */
function stopTimer() {
  const wasStopwatch = timer.mode === 'stopwatch';
  const elapsed = Math.round((Date.now() - timer.startedAt) / 1000);
  const { entryId, setId } = timer;

  clearInterval(timer.tick);
  timer.tick = null;
  timer.mode = null;
  $('#timer-bar').hidden = true;

  if (!wasStopwatch || !state.active) return;

  const entry = state.active.entries.find((e) => e.id === entryId);
  const set = entry && entry.sets.find((s) => s.id === setId);
  if (!set) return;

  set.seconds = String(elapsed);
  set.done = true;
  save();
  render();
  toast(`Logged ${elapsed}s`);

  if (state.settings.restSeconds > 0) startRest(state.settings.restSeconds);
}

function alarm() {
  playAlert();
  /* Android only — iOS ignores navigator.vibrate entirely, which is part of
     why the sound itself has to carry the job. */
  if (navigator.vibrate) navigator.vibrate([250, 90, 250, 90, 450]);
}

/**
 * Alert sounds, designed to be heard over music in headphones.
 *
 * The old two-tone sine at 660/880 Hz sat right in the middle of where music
 * puts most of its energy and had no harmonics to help it stand out, so it
 * disappeared under anything playing. These sit near 2 kHz — roughly where
 * hearing is most sensitive and where most mixes are quieter — use a square
 * wave so there are harmonics to cut through, and repeat, because a single
 * short blip is easy to miss entirely.
 *
 * notes: [frequency, startOffset, duration]
 */
const ALERT_SOUNDS = {
  beep: {
    label: 'Beep',
    hint: 'Sharp triple beep. Best over music.',
    type: 'square',
    notes: [[1975, 0, 0.11], [1975, 0.17, 0.11], [1975, 0.34, 0.26]],
  },
  alarm: {
    label: 'Alarm',
    hint: 'Longer and harder to miss.',
    type: 'square',
    notes: [
      [2093, 0, 0.1], [1568, 0.12, 0.1],
      [2093, 0.28, 0.1], [1568, 0.40, 0.1],
      [2093, 0.56, 0.1], [1568, 0.68, 0.28],
    ],
  },
  chime: {
    label: 'Chime',
    hint: 'Gentle two-tone. Quiet gyms only.',
    type: 'sine',
    notes: [[660, 0, 0.16], [880, 0.18, 0.22]],
  },
};

let audioCtx;

/* Safari will not start an AudioContext outside a user gesture, and the rest
   timer fires without one. Unlocking on any tap means the context is already
   running by the time a set is ticked off — otherwise the alert is silent. */
function audio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

document.addEventListener('pointerdown', () => {
  try { audio(); } catch (err) { /* no audio on this device */ }
});

function playAlert(which) {
  try {
    const spec = ALERT_SOUNDS[which] || ALERT_SOUNDS[state.settings.alertSound] || ALERT_SOUNDS.beep;
    const ctx = audio();
    const volume = Math.min(1, Math.max(0, Number(state.settings.alertVolume)));
    if (!volume) return;

    /* A limiter lets the output sit close to full scale without the crackle
       you get from simply turning the gain up past clipping. */
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;

    /* Takes the harshest edge off the square wave without dulling it. */
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 6000;

    const master = ctx.createGain();
    master.gain.value = volume;

    master.connect(tone).connect(limiter).connect(ctx.destination);

    spec.notes.forEach(([freq, at, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = spec.type;
      osc.frequency.value = freq;
      osc.connect(gain).connect(master);

      const t = ctx.currentTime + 0.02 + at;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.9, t + 0.008);
      gain.gain.setValueAtTime(0.9, t + dur - 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.02);
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
  if (currentView === 'settings') {
    renderSettings();
    showStorageStatus();
    /* Answer arrives async; re-render only if it changes what the card says. */
    if (installedKnown === null && !isStandalone()) {
      detectInstalled().then((was) => { if (was === true && currentView === 'settings') renderSettings(); });
    }
  }
}

/* ------------------------------------------------- goal, backup, plates */

function goalCard() {
  const goal = Number(state.settings.weeklyGoal) || 0;
  if (!goal) return '';
  const p = weekProgress(state.sessions, goal);

  let msg;
  if (p.remaining === 0) msg = `Goal hit — ${p.done} of ${goal} done.`;
  else if (p.daysLeft <= 0) msg = `Week's up. ${p.done} of ${goal}.`;
  else if (p.atRisk) msg = `${p.remaining} to go and only ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left.`;
  else msg = `${p.remaining} to go, ${p.daysLeft} days left.`;

  return `
    <div class="card goal-card${p.atRisk ? ' at-risk' : ''}${p.remaining === 0 ? ' hit' : ''}">
      ${progressRing(p.done, goal)}
      <div class="grow">
        <div class="card-title">This week</div>
        <div class="card-sub">${esc(msg)}</div>
      </div>
    </div>`;
}

/* Local-only storage means a cleared browser wipes everything, so nag — but
   gently, and only once there is something worth losing. */
function backupBanner() {
  if (state.sessions.length < 5) return '';

  const snooze = state.settings.backupSnooze ? +new Date(state.settings.backupSnooze) : 0;
  if (snooze && Date.now() - snooze < 7 * 86400000) return '';

  const last = state.settings.lastExport ? new Date(state.settings.lastExport) : null;
  const days = last ? Math.floor((Date.now() - +last) / 86400000) : null;
  if (last && days < 30) return '';

  return `
    <div class="banner">
      <div class="grow">
        <strong>Back up your training</strong>
        <div class="small">${last
          ? `Last backup was ${days} days ago.`
          : "You haven't exported a backup yet."} Everything lives on this device only.</div>
      </div>
      <div class="row">
        <button class="btn" data-action="export">Export</button>
        <button class="ghost" data-action="snooze-backup">Later</button>
      </div>
    </div>`;
}

function defaultBar() {
  return state.settings.units === 'kg' ? 20 : 45;
}

function openPlateSheet(weight) {
  const units = state.settings.units;
  const bar = Number(state.settings.barWeight) || defaultBar();

  openSheet('Plate calculator', `
    <div class="row" style="align-items:flex-end;gap:10px">
      <label class="field grow" style="margin:0">
        <span>Target (${esc(units)})</span>
        <input class="text" id="plate-target" type="number" inputmode="decimal" step="any" value="${esc(weight || '')}">
      </label>
      <label class="field grow" style="margin:0">
        <span>Bar (${esc(units)})</span>
        <input class="text" id="plate-bar" type="number" inputmode="decimal" step="any" value="${bar}">
      </label>
    </div>
    <div id="plate-out" style="margin-top:16px"></div>`);

  const draw = () => {
    $('#plate-out').innerHTML = plateHtml(
      Number($('#plate-target').value),
      Number($('#plate-bar').value),
      units,
    );
  };

  $('#plate-target').addEventListener('input', draw);
  $('#plate-bar').addEventListener('input', () => {
    state.settings.barWeight = Number($('#plate-bar').value) || defaultBar();
    save();
    draw();
  });
  draw();
}

function plateHtml(target, bar, units) {
  const res = plateBreakdown(target, bar, units);
  if (!res.ok) {
    return `<p class="muted small">${res.reason === 'under-bar'
      ? `That's lighter than the bar itself.`
      : 'Enter a target weight.'}</p>`;
  }
  if (!res.perSide.length) {
    return '<p class="muted small">Just the bar.</p>';
  }

  return `
    <p class="small muted" style="margin:0 0 10px">Per side</p>
    <div class="plates">
      ${res.perSide.map((p) => `
        <span class="plate">${p.count} &times; ${p.plate}</span>`).join('')}
    </div>
    ${res.leftover > 0
      ? `<p class="small" style="color:var(--warn);margin-top:12px">
           ${res.leftover} ${esc(units)} per side can't be made from standard plates.
         </p>`
      : ''}`;
}

async function shareRecap() {
  let blob;
  try {
    const canvas = buildRecapCanvas(state.sessions, state.settings.units);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch (err) {
    console.error(err);
  }
  if (!blob) { toast('Could not build the image'); return; }

  const file = new File([blob], 'wrk-week.png', { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;   /* user dismissed the sheet */
    }
  }

  /* Desktop and older browsers get a download instead. */
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'wrk-week.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Image saved');
}

/* ------------------------------------------------------------ workout view */

function newSet(type) {
  if (type === 'cardio') return { id: uid(), distance: '', minutes: '', done: false };
  if (type === 'timed') return { id: uid(), seconds: '', done: false };
  return { id: uid(), weight: '', reps: '', done: false };
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
      } else if (type === 'timed') {
        if (t.seconds != null) s.seconds = String(t.seconds);
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

  if (item.type === 'timed') {
    const secs = sets[0].seconds;
    if (secs == null) return `${sets.length} × hold`;
    return sets.length > 1 ? `${sets.length} × ${secs}s` : `${secs}s`;
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

/**
 * Begin entering a workout.
 *
 * @param {object|null} routine  Load its exercises, or null for an empty one.
 * @param {string} [onDayKey]    'YYYY-MM-DD' to date the session to an earlier
 *                               day. Omit (or pass today) for a live workout.
 */
function startSession(routine, onDayKey) {
  const todayKey = dayKey(new Date());
  const backdated = !!onDayKey && onDayKey !== todayKey;

  /* A backdated entry has no real start time, so pick midday — it keeps the
     session inside the right calendar day in every timezone. */
  let when = new Date();
  if (backdated) {
    when = keyToDate(onDayKey);
    when.setHours(12, 0, 0, 0);
  }

  state.active = {
    id: uid(),
    startedAt: when.toISOString(),
    name: routine ? routine.name : 'Quick workout',
    routineId: routine ? routine.id : null,
    entries: routine ? routine.items.map(makeEntry) : [],
    backdated,
    /* Elapsed time is meaningless when logging after the fact, so it's typed. */
    durationMin: backdated ? 45 : null,
  };
  save();
  keepScreenAwake();
  go("workout");
}

/**
 * Reopen a saved workout for editing.
 *
 * It becomes the active session with `editingId` set, which reuses the whole
 * logging screen — picker, plates, timers off — and finishSession() then
 * replaces the original rather than adding a second copy.
 */
function startEditSession(session) {
  state.active = {
    id: session.id,
    editingId: session.id,
    startedAt: session.date,
    name: session.name,
    routineId: null,
    /* Backdated behaviour is what we want: no rest timer, typed duration. */
    backdated: true,
    durationMin: session.durationMs ? Math.round(session.durationMs / 60000) : null,
    note: session.note || "",
    entries: session.entries.map((e) => ({
      id: uid(),
      name: e.name,
      type: e.type,
      sets: e.sets.map((s) => ({ ...s, id: uid(), done: s.done !== false })),
    })),
  };
  save();
  go('workout');
}

/* Choose what to log on a given day: from scratch, or from a routine. */
function openLogSheet(key) {
  const d = keyToDate(key);
  const isToday = key === dayKey(new Date());

  openSheet(isToday ? 'Add a workout today' : 'Log a past workout', `
    <p class="small muted" style="margin-top:0">
      ${isToday ? 'Starting now.' : `This will be saved under
      <strong>${esc(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</strong>.
      You'll type in the sets you did — no timer.`}
    </p>
    <button class="btn block" data-action="log-empty" data-key="${key}">Start from scratch</button>
    ${state.routines.length ? `
      <h3 class="small muted" style="margin:20px 0 8px">FROM A ROUTINE</h3>
      ${state.routines.map((r) => `
        <button class="pick" data-action="log-routine" data-key="${key}" data-id="${r.id}">
          <div class="grow">
            <div class="nm">${esc(r.name)}</div>
            <div class="card-sub">${r.items.length} exercise${r.items.length === 1 ? '' : 's'}</div>
          </div>
          <span class="muted">&rsaquo;</span>
        </button>`).join('')}` : ''}`);
}

/* Guard shared by both log actions. */
function canStartOn(key) {
  if (keyToDate(key) > new Date()) {
    toast("You can't log a workout in the future");
    return false;
  }
  if (state.active && !confirm('You have a workout in progress. Replace it with this one?')) {
    return false;
  }
  return true;
}

function renderWorkout() {
  const el = $('#view-workout');
  const a = state.active;
  const action = $('#btn-header-action');

  if (!a) {
    action.hidden = true;
    el.innerHTML = `
      ${backupBanner()}
      ${goalCard()}
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

  const doneSets = a.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const setsText = `${doneSets} set${doneSets === 1 ? '' : 's'} done`;

  el.innerHTML = `
    ${a.backdated ? `
      <div class="backdate-bar">
        ${a.editingId ? "Editing" : "Logging for"} <strong>${esc(new Date(a.startedAt).toLocaleDateString(undefined, {
          weekday: 'long', month: 'long', day: 'numeric',
        }))}</strong>
      </div>` : ''}

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(a.name)}</div>
          <div class="card-sub" id="session-summary">${a.backdated
            ? setsText
            : `${fmtDuration(Date.now() - new Date(a.startedAt).getTime())} elapsed &middot; ${setsText}`}</div>
        </div>
      </div>

      ${a.backdated ? `
        <label class="field" style="margin:10px 0 12px">
          <span>How long did it take? (minutes, optional)</span>
          <input class="text" type="number" inputmode="numeric" min="0" max="600"
                 data-duration value="${a.durationMin == null ? '' : a.durationMin}">
        </label>` : ''}
      ${a.note ? `<p class="session-note">${esc(a.note)}</p>` : ''}

      <div class="row wrap">
        <button class="ghost small" data-action="start-rest">Start rest</button>
        <button class="ghost small" data-action="session-note">${a.note ? 'Edit note' : 'Note'}</button>
        <button class="ghost small" data-action="rename-session">Rename</button>
        <button class="ghost small" data-action="save-as-routine">Save as routine</button>
        <div class="spacer"></div>
        <button class="ghost small" data-action="discard" style="color:var(--danger)">Discard</button>
      </div>
    </div>

    ${a.entries.map(renderEntry).join('')}

    ${a.entries.length
      ? '<span class="swipe-hint">Swipe an exercise or a set left to remove it</span>'
      : ''}

    <div style="margin-top:14px">
      <button class="btn block secondary" data-action="add-exercise">+ Add exercise</button>
    </div>
    ${a.entries.length
      ? '<div style="margin-top:10px"><button class="btn block" data-action="finish">Finish workout</button></div>'
      : ''}`;
}

function renderEntry(entry, index, all) {
  const total = all.length;
  const isCardio = entry.type === 'cardio';
  const isTimed = entry.type === 'timed';
  const unit = state.settings.units === 'kg' ? 'Kg' : 'Lb';
  /* Four columns now that delete is a swipe rather than a trailing button —
     which gives the number fields noticeably more room. */
  const cols = isTimed ? ['#', 'Seconds', '', '']
    : isCardio ? ['#', 'Distance', 'Min', '']
    : ['#', unit, 'Reps', ''];

  /* What you did last time is the reason to open the app mid-session, so it
     sits directly above the inputs rather than behind a tap. */
  const last = lastPerformance(state.sessions, entry.name);
  const isPr = (state.active.prs || []).includes(entry.name);

  /* Removing an exercise is behind a swipe, not a button in the header. A tap
     target next to the exercise name is far too easy to catch by accident with
     a phone in one hand mid-set — and losing the sets you already logged is not
     a small mistake. The button stays in the DOM so it's still reachable by
     keyboard and screen reader; it just sits behind the card until revealed. */
  return `
  <div class="ex-swipe swipe-wrap">
    <button class="swipe-del" data-action="remove-entry" data-id="${entry.id}"
            aria-label="Delete ${esc(entry.name)}">Delete</button>
    <div class="card ex swipe-face ${entry.type}" data-entry="${entry.id}">
    <div class="ex-head">
      <span class="ex-name">${esc(entry.name)}</span>
      ${isPr ? '<span class="pill pr">PR</span>' : ''}
      <span class="pill ${entry.type}">${entry.type}</span>
      <div class="spacer"></div>
      ${index > 0 ? `<button class="icon-btn" data-action="move-entry" data-id="${entry.id}" data-dir="-1"
              aria-label="Move ${esc(entry.name)} up">&uarr;</button>` : ''}
      ${index < total - 1 ? `<button class="icon-btn" data-action="move-entry" data-id="${entry.id}" data-dir="1"
              aria-label="Move ${esc(entry.name)} down">&darr;</button>` : ''}
    </div>

    ${last ? `
      <div class="lastline">
        <span class="muted">Last time &middot; ${esc(last.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>
        <b>${esc(summarizeSets(last, state.settings.units))}</b>
        <button class="linkish" data-action="repeat-last" data-id="${entry.id}">Repeat</button>
      </div>` : ''}

    <div class="set-grid">
      <div class="set-head">${cols.map((c) => `<div>${c}</div>`).join('')}</div>
      ${entry.sets.map((s, i) => {
        const running = timer.mode === 'stopwatch' && timer.setId === s.id;
        const cells = isTimed
          ? `<input class="cell" type="number" inputmode="numeric" step="any" placeholder="—"
                    data-field="seconds" value="${esc(s.seconds)}">
             <button class="check timer-btn ${running ? 'on' : ''}" data-action="time-set"
                     data-id="${entry.id}" aria-label="${running ? 'Stop timing' : 'Start timing this set'}"
                     >${running ? '&#9632;' : '&#9654;'}</button>`
          : `<input class="cell" type="number" inputmode="decimal" step="any" placeholder="—"
                    data-field="${isCardio ? 'distance' : 'weight'}"
                    value="${esc(isCardio ? s.distance : s.weight)}">
             <input class="cell" type="number" inputmode="numeric" step="any" placeholder="—"
                    data-field="${isCardio ? 'minutes' : 'reps'}"
                    value="${esc(isCardio ? s.minutes : s.reps)}">`;

        return `
        <div class="set-swipe swipe-wrap">
          <button class="swipe-del" data-action="remove-set" data-entry-id="${entry.id}" data-id="${s.id}"
                  aria-label="Delete set ${i + 1}">Delete</button>
          <div class="set-row swipe-face ${s.done ? 'done' : ''}" data-set="${s.id}">
            <div class="set-n">${i + 1}</div>
            ${cells}
            <button class="check ${s.done ? 'on' : ''}" data-action="toggle-set" aria-label="Mark set ${i + 1} done">&#10003;</button>
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="row" style="margin-top:10px">
      <button class="ghost small" data-action="add-set" data-id="${entry.id}">+ Set</button>
      ${entry.type === 'lifting'
        ? `<button class="ghost small" data-action="plates" data-id="${entry.id}">Plates</button>`
        : ''}
    </div>
    </div>
  </div>`;
}

/**
 * Announce a personal best when a completed set beats every previous session.
 *
 * Only fires when there is a previous best to beat — otherwise the first set
 * you ever log would be a "record", which is noise. Announced once per
 * exercise per workout, recorded on the session so it survives a reload.
 */
function checkPersonalRecord(entry, set, card) {
  if (!entry || entry.type === 'cardio') return;
  const weight = Number(set.weight);
  const reps = Number(set.reps);
  if (set.weight === '' || isNaN(weight) || weight <= 0) return;

  state.active.prs = state.active.prs || [];
  if (state.active.prs.includes(entry.name)) return;

  const previousBest = bestE1rm(state.sessions, entry.name);
  if (previousBest <= 0) return;

  const value = e1rm(weight, isNaN(reps) ? 0 : reps);
  if (value <= previousBest) return;

  state.active.prs.push(entry.name);
  save();
  toast(`New best — ${entry.name} ${Math.round(value)} ${state.settings.units}`);
  if (navigator.vibrate) navigator.vibrate([40, 60, 140]);

  /* Insert the badge directly; a re-render here would drop typing focus. */
  const head = card && card.querySelector('.ex-head');
  if (head && !head.querySelector('.pill.pr')) {
    const pill = document.createElement('span');
    pill.className = 'pill pr';
    pill.textContent = 'PR';
    head.insertBefore(pill, head.querySelector('.pill'));
  }
}

/* Refresh just the summary line — used after an in-place set toggle. */
function updateSummary() {
  const el = $('#session-summary');
  if (!el || !state.active) return;
  const done = state.active.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const setsText = `${done} set${done === 1 ? '' : 's'} done`;
  el.innerHTML = state.active.backdated
    ? setsText
    : `${fmtDuration(Date.now() - new Date(state.active.startedAt).getTime())} elapsed &middot; ${setsText}`;
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
    /* Editing something down to nothing means deleting it, which is a very
       different thing from throwing away a session you never saved. */
    const prompt = a.editingId
      ? 'Every set is unticked. Delete this saved workout?'
      : 'No sets were marked done. Discard this workout?';
    if (!confirm(prompt)) return;
    if (a.editingId) state.sessions = state.sessions.filter((s) => s.id !== a.editingId);
    state.active = null;
    stopTimer();
    releaseScreen();
    save();
    if (a.editingId) { go('calendar'); toast('Workout deleted'); return; }
    render();
    return;
  }

  const record = {
    id: a.id,
    name: a.name,
    date: a.startedAt,
    ...(a.note ? { note: a.note } : {}),
    /* A typed duration for a backdated log; real elapsed time for a live one. */
    durationMs: a.backdated
      ? Math.max(0, Number(a.durationMin) || 0) * 60000
      : Date.now() - new Date(a.startedAt).getTime(),
    entries: kept,
  };

  if (a.editingId) {
    const at = state.sessions.findIndex((s) => s.id === a.editingId);
    if (at >= 0) state.sessions[at] = record;
    else state.sessions.unshift(record);
  } else {
    state.sessions.unshift(record);
  }

  /* Newest first, so a backdated entry lands in the right place. */
  state.sessions.sort((x, y) => +new Date(y.date) - +new Date(x.date));

  const landedOn = a.startedAt;
  state.active = null;
  stopTimer();
  releaseScreen();
  save();
  toast(a.editingId ? 'Workout updated' : (a.backdated ? 'Workout logged' : 'Workout saved'));
  calCursor = new Date(landedOn);
  calSelected = dayKey(landedOn);
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
        <p>Already have a program? Paste it in. Not sure where to start? Answer four
          questions and Cadence will write you one.</p>
        <button class="btn block" data-action="plan-start">Build me a plan</button>
        <button class="btn block secondary" data-action="paste-import" style="margin-top:8px">Paste from your notes</button>
        <button class="btn block secondary" data-action="new-routine" style="margin-top:8px">Build one by hand</button>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="row wrap" style="margin-bottom:14px">
      <button class="btn secondary" data-action="plan-start">Build me a plan</button>
      <button class="ghost" data-action="paste-import">Paste from notes</button>
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
          <div class="item-edit">
            <input class="text" data-edit-item="${i}" data-rid="${id}"
                   value="${esc(it.name)}" aria-label="Exercise name">
            <div class="item-edit-row">
              <select class="text slim" data-item-type="${i}" data-rid="${id}" aria-label="How it's recorded">
                <option value="lifting" ${it.type === 'lifting' ? 'selected' : ''}>Weight &amp; reps</option>
                <option value="timed" ${it.type === 'timed' ? 'selected' : ''}>Held time</option>
                <option value="cardio" ${it.type === 'cardio' ? 'selected' : ''}>Distance &amp; time</option>
              </select>
              <span class="small muted grow">${esc(summarizeItem(it) || '')}</span>
              <button class="icon-btn" data-action="routine-remove-item" data-id="${id}" data-index="${i}"
                      aria-label="Remove ${esc(it.name)}">&times;</button>
            </div>
          </div>`).join('')
        : '<p class="muted small">No exercises yet.</p>'}
    </div>
    <button class="btn block secondary" data-action="routine-add-item" data-id="${id}" style="margin-top:8px">+ Add exercise</button>
    <button class="btn block" data-action="routine-save" data-id="${id}" style="margin-top:10px">Save routine</button>`);
}

/* --------------------------------------------------------- build me a plan */

let planAnswers = null;

const PLAN_STEPS = [
  {
    key: 'goal',
    title: 'What are you after?',
    lead: 'Pick the closest one — you can change the plan afterwards.',
    options: () => Object.entries(PLAN_GOALS).map(([value, o]) => ({ value, ...o })),
  },
  {
    key: 'days',
    title: 'How many days a week?',
    lead: 'Be honest rather than optimistic. A plan you finish beats a better one you abandon.',
    options: () => [
      { value: 2, label: '2 days', blurb: 'Enough to make real progress' },
      { value: 3, label: '3 days', blurb: 'The sweet spot for most people' },
      { value: 4, label: '4 days', blurb: 'More volume, needs more time' },
      { value: 5, label: '5 days', blurb: 'Only if you can hold it' },
    ],
  },
  {
    key: 'equipment',
    title: 'What can you train with?',
    lead: '',
    options: () => Object.entries(PLAN_EQUIPMENT).map(([value, o]) => ({ value, ...o })),
  },
  {
    key: 'level',
    title: 'How much lifting have you done?',
    lead: '',
    options: () => Object.entries(PLAN_LEVELS).map(([value, o]) => ({ value, ...o })),
  },
];

function startPlanWizard() {
  planAnswers = {};
  renderPlanStep();
}

function renderPlanStep() {
  const step = PLAN_STEPS.find((s) => planAnswers[s.key] === undefined);
  if (!step) { renderPlanPreview(); return; }
  const n = PLAN_STEPS.indexOf(step) + 1;

  openSheet('Build me a plan', `
    <p class="small muted" style="margin-top:0">Step ${n} of ${PLAN_STEPS.length}</p>
    <h3 style="margin:0 0 6px">${esc(step.title)}</h3>
    ${step.lead ? `<p class="small muted" style="margin:0 0 14px">${esc(step.lead)}</p>` : ''}
    ${step.options().map((o) => `
      <button class="pick" data-action="plan-answer" data-key="${step.key}" data-val="${esc(o.value)}">
        <div class="grow">
          <div class="nm">${esc(o.label)}</div>
          ${o.blurb ? `<div class="card-sub">${esc(o.blurb)}</div>` : ''}
        </div>
        <span class="muted">&rsaquo;</span>
      </button>`).join('')}
    ${n > 1 ? '<button class="linkish" data-action="plan-back" style="margin-top:8px">&lsaquo; Back</button>' : ''}`);
}

function renderPlanPreview() {
  const plan = buildPlan(planAnswers);

  openSheet('Your plan', `
    <p class="small muted" style="margin-top:0">${esc(plan.summary)}</p>

    ${plan.routines.map((r) => `
      <div class="card" style="margin-top:10px">
        <div class="card-title">${esc(r.name)}</div>
        ${r.items.map((it) => `
          <div class="plan-row">
            <span>${esc(it.name)}</span>
            <span class="muted">${esc(summarizeItem(it))}</span>
          </div>`).join('')}
      </div>`).join('')}

    <div class="card" style="margin-top:14px">
      <div class="card-title">How to run it</div>
      ${plan.notes.map((t) => `<p class="small muted" style="margin:8px 0 0">${esc(t)}</p>`).join('')}
    </div>

    <button class="btn block" data-action="plan-save" style="margin-top:14px">
      Add ${plan.routines.length} routine${plan.routines.length === 1 ? '' : 's'} &amp; set my goal
    </button>
    <button class="btn block secondary" data-action="plan-restart" style="margin-top:8px">Start over</button>`);
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
            <div class="item-edit">
              <input class="text" data-pitem="${ii}" data-pr="${ri}"
                     value="${esc(it.name)}" aria-label="Exercise name">
              <div class="item-edit-row">
                <span class="pill ${it.type}">${it.type}</span>
                ${it.custom ? '<span class="pill">new</span>' : ''}
                <span class="small muted grow">${esc(t || 'no sets given')}</span>
                <button class="icon-btn" data-action="paste-drop" data-r="${ri}" data-i="${ii}"
                        aria-label="Remove ${esc(it.name)}">&times;</button>
              </div>
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
  $$('[data-pitem]').forEach((input) => {
    const r = pendingImport.routines[Number(input.dataset.pr)];
    const item = r && r.items[Number(input.dataset.pitem)];
    if (item) item.name = input.value.trim() || item.name;
  });
}

/* ----------------------------------------------------------- calendar view */

let calCursor = new Date();          // which month/week is on screen
let calSelected = null;              // 'YYYY-MM-DD' of the day being detailed

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function sessionsByDay() {
  const map = new Map();
  state.sessions.forEach((s) => {
    const k = dayKey(s.date);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  });
  return map;
}

/* What colour a day gets: lifting, cardio, or both.
   Timed holds count as strength work — a bench session with a plank in it is
   still a lifting day, not a "both" day. */
function sessionKind(s) {
  const types = new Set((s.entries || []).map((e) => e.type));
  const hasCardio = types.has('cardio');
  const hasStrength = types.has('lifting') || types.has('timed');
  if (hasCardio && hasStrength) return 'mixed';
  return hasCardio ? 'cardio' : 'lifting';
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
  const day = keyToDate(key);
  const heading = day.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const isToday = key === dayKey(new Date());
  const isFuture = day > new Date();

  /* Any past day can be filled in after the fact; a future one can't. */
  const addButton = isFuture
    ? '<p class="small muted" style="margin:12px 0 0">You can\'t log a workout before it happens.</p>'
    : `<button class="btn block ${sessions.length ? 'secondary' : ''}" data-action="log-on-day"
               data-key="${key}" style="margin-top:${sessions.length ? '14px' : '12px'}">
         ${isToday ? '+ Add a workout today' : '+ Log a workout on this day'}
       </button>`;

  if (!sessions.length) {
    return `
      <div class="card" style="margin-top:16px">
        <div class="card-title">${esc(heading)}</div>
        <p class="small muted" style="margin:6px 0 0">${isFuture ? 'Nothing here yet.' : 'Rest day — nothing logged.'}</p>
        ${addButton}
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
              <div class="small muted">${time}${s.durationMs > 0 ? ` &middot; ${fmtDuration(s.durationMs)}` : ''} &middot; ${sets} set${sets === 1 ? '' : 's'}</div>
            </div>
            <button class="ghost small" data-action="edit-session" data-id="${s.id}">Edit</button>
            <button class="icon-btn" data-action="delete-session" data-id="${s.id}"
                    aria-label="Delete ${esc(s.name)}">&#128465;</button>
          </div>
          ${s.note ? `<p class="session-note">${esc(s.note)}</p>` : ''}
          ${s.entries.map((e) => `
            <div class="small" style="margin-top:6px">
              <span style="font-weight:600">${esc(e.name)}</span>
              <span class="muted">${esc(e.sets.map((set) => formatSet(e.type, set, state.settings.units)).join(', '))}</span>
            </div>`).join('')}
        </div>`;
      }).join('')}
      ${addButton}
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
  const perWeek = inRange.length / Math.max(1, (+to - +from) / (7 * 86400000));
  const streak = currentStreak(all);

  /* A week or month still running is de-emphasised so it can't read as a drop.
     A day is never "partial" that way — you either trained or you didn't. */
  const isPartial = (b) => mode !== 'day' && now >= b.start && now < b.end;

  /* --- per-bucket series --- */
  const freq = buckets.map((b) => {
    const list = sessionsIn(all, b.start, b.end);
    return {
      label: b.label,
      value: list.length,
      partial: isPartial(b),
      tip: `${b.full}\n${list.length} workout${list.length === 1 ? '' : 's'}`
        + (isPartial(b) ? '\n(still in progress)' : ''),
    };
  });

  const volSeries = buckets.map((b) => {
    const v = sessionsIn(all, b.start, b.end).reduce((n, s) => n + sessionVolume(s), 0);
    return {
      label: b.label,
      value: v,
      partial: isPartial(b),
      tip: `${b.full}\n${compact(v)} ${state.settings.units} lifted`,
    };
  });

  const cardioSeries = buckets.map((b) => {
    const v = sessionsIn(all, b.start, b.end).reduce((n, s) => n + sessionCardioMinutes(s), 0);
    return {
      label: b.label,
      value: Math.round(v),
      partial: isPartial(b),
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
        tip: `${p.full}\n${p.value} ${state.settings.units}`
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
    ${backupBanner()}
    ${goalCard()}

    <div class="row" style="justify-content:center;margin:14px 0">
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

    ${renderWeightCard(from, to)}

    <div class="card">
      <div class="card-title">How often you trained</div>
      <div class="card-sub">Workouts per ${mode}</div>
      ${columnChart(freq, { integer: true })}
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
      ${columnChart(volSeries)}
    </div>` : ''}

    ${hasCardio ? `
    <div class="card">
      <div class="card-title">Cardio minutes</div>
      <div class="card-sub">Totalled per ${mode}</div>
      ${columnChart(cardioSeries, { integer: true })}
    </div>` : ''}

    ${top.length ? `
    <div class="card">
      <div class="card-title">Most-trained exercises</div>
      <div class="card-sub">By sets logged</div>
      ${barRows(top, (v) => v)}
    </div>` : ''}

    <button class="btn block secondary" data-action="share-week" style="margin-top:14px">
      Share this week
    </button>`;
}

/* Bodyweight. The plan builder's first goal is "lose weight", so the app has to
   be able to measure it — sets and reps don't answer that question. */
function renderWeightCard(from, to) {
  const unit = state.settings.units;
  const log = state.weights || [];
  const trend = weightTrend(log, from, to);
  const goal = Number(state.settings.goalWeight) || 0;
  const latest = log.length
    ? [...log].sort((a, b) => +new Date(b.date) - +new Date(a.date))[0]
    : null;

  if (!log.length) {
    return `
      <div class="card">
        <div class="card-title">Bodyweight</div>
        <p class="small muted" style="margin:6px 0 12px">Log your weight now and then and the
          trend shows up here. Daily readings bounce a few ${esc(unit)} on water alone, so the
          chart smooths them into a 7-day average.</p>
        <button class="btn block secondary" data-action="log-weight">Log my weight</button>
      </div>`;
  }

  /* Down is good here, which is the opposite of every other delta in this tab. */
  const goodDirection = goal && latest ? (goal < latest.value ? -1 : 1) : -1;
  const trendClass = !trend || trend.change === 0 ? ''
    : (Math.sign(trend.change) === goodDirection ? 'up' : 'down');

  let goalLine = '';
  if (goal && trend) {
    const remaining = Math.round(Math.abs(trend.latest - goal) * 10) / 10;
    goalLine = remaining <= 0.1
      ? `<p class="small" style="margin:8px 0 0;color:var(--good)">You're at your goal of ${goal} ${esc(unit)}.</p>`
      : `<p class="small muted" style="margin:8px 0 0">${remaining} ${esc(unit)} to your goal of ${goal}.</p>`;
  }

  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Bodyweight</div>
          <div class="card-sub">7-day average, ${esc(unit)}</div>
        </div>
        <button class="ghost small" data-action="log-weight">Log</button>
      </div>

      <div class="row" style="align-items:baseline;gap:10px">
        <span class="stat-value">${trend ? trend.latest : latest.value}</span>
        ${trend && trend.change !== 0
          ? `<span class="delta ${trendClass}">${trend.change > 0 ? '+' : ''}${trend.change} ${esc(unit)} this period</span>`
          : '<span class="small muted">Not enough weigh-ins yet for a trend</span>'}
      </div>
      ${goalLine}
      ${weightChart(log.filter((e) => { const t = +new Date(e.date); return t >= +from && t < +to; }), unit)
        || '<p class="small muted" style="margin:10px 0 0">Two weigh-ins in this range and a line appears.</p>'}
      <div class="viz-legend" style="margin-top:8px">
        <span><i style="background:var(--viz-dim)"></i>Each weigh-in</span>
        <span><i style="background:var(--series-lift)"></i>7-day average</span>
      </div>
    </div>`;
}

function openWeightSheet() {
  const unit = state.settings.units;
  const log = [...(state.weights || [])].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const last = log[0];

  openSheet('Log your weight', `
    <label class="field">
      <span>Weight (${esc(unit)})</span>
      <input class="text" type="number" inputmode="decimal" step="any" id="weight-value"
             value="${last ? esc(last.value) : ''}" placeholder="e.g. 184.5">
    </label>
    <label class="field">
      <span>Date</span>
      <input class="text" type="date" id="weight-date" value="${esc(dayKey(new Date()))}"
             max="${esc(dayKey(new Date()))}">
    </label>
    <button class="btn block" data-action="weight-save">Save</button>

    <label class="field" style="margin-top:22px">
      <span>Goal weight (${esc(unit)}, optional)</span>
      <input class="text" type="number" inputmode="decimal" step="any"
             data-setting="goalWeight" value="${state.settings.goalWeight || ''}"
             placeholder="Leave blank for no goal">
    </label>

    ${log.length ? `
      <h3 class="small muted" style="margin:20px 0 8px">RECENT</h3>
      ${log.slice(0, 8).map((w) => `
        <div class="pick">
          <div class="grow">
            <div class="nm">${esc(w.value)} ${esc(unit)}</div>
            <div class="card-sub">${esc(new Date(w.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}</div>
          </div>
          <button class="icon-btn" data-action="weight-delete" data-id="${w.id}"
                  aria-label="Delete this weigh-in">&times;</button>
        </div>`).join('')}` : ''}`);
}

function columnOrLine(points, unit) {
  return lineChart(points, (v) => `${compact(v)} ${unit}`);
}

/* ----------------------------------------------------------------- install */

/**
 * Chrome fires beforeinstallprompt and lets us show a real Install button, so
 * nobody has to be walked through a menu. Safari has no equivalent API — on
 * iPhone the written steps are the only route, which is why they stay.
 */
let installPrompt = null;

window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installPrompt = ev;
  if (currentView === 'settings') render();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  if (currentView === 'settings') render();
  toast('Installed');
});

/* Four honest states, rather than one message that assumes you haven't installed. */
function renderInstallCard() {
  if (isStandalone()) return '';                 /* you're in the installed app */

  /* On iOS only Safari can produce a real standalone app. Anywhere else there
     is genuinely no route, so say that rather than leaving someone hunting
     through a menu for a button that will never be there. */
  if (isIosWrongBrowser()) {
    return `
      <div class="card">
        <div class="card-title">Open in Safari to install</div>
        <p class="small muted" style="margin:6px 0 12px">
          You're in ${esc(iosBrowserName())}. On iPhone only Safari can add a real app —
          other browsers can make a shortcut, but it opens back in the browser instead of
          running full screen and offline.
        </p>
        <button class="btn block secondary" data-action="copy-app-link">Copy link for Safari</button>
      </div>`;
  }

  if (installPrompt) {
    return `
      <div class="card">
        <div class="card-title">Install Cadence</div>
        <p class="small muted" style="margin:6px 0 12px">Adds it to your home screen so it opens
          full screen and works without a signal.</p>
        <button class="btn block" data-action="install-app">Install</button>
      </div>`;
  }

  if (installedKnown === true) {
    return `
      <div class="card">
        <div class="card-title">Already installed</div>
        <p class="small muted" style="margin:6px 0 0">Cadence is on this device — open it from your
          home screen rather than the browser and it runs full screen and offline. This tab and the
          installed app share the same log.</p>
      </div>`;
  }

  return `
    <div class="card">
      <div class="card-title">Install Cadence</div>
      <p class="small muted" style="margin:6px 0 0">Your browser hasn't offered a one-tap install
        here. If you already installed it, nothing to do — Chrome only offers the button once.
        Otherwise: on iPhone use Safari's <strong>Share</strong> &rarr;
        <strong>Add to Home Screen</strong>; on Android use Chrome's menu.</p>
    </div>`;
}

async function runInstallPrompt() {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === 'accepted') installPrompt = null;
  render();
}

function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone === true;
}

/**
 * Whether this app is already installed — including when you're looking at it
 * in a browser tab rather than the installed window.
 *
 * This matters because Chrome does not fire beforeinstallprompt for an app
 * that's already installed, so "no button" is ambiguous: it means either
 * "already done" or "not offered yet", and showing install instructions to
 * someone who has already installed it is just noise.
 *
 * getInstalledRelatedApps() answers it, which is why the manifest lists itself
 * under related_applications. Chrome only; elsewhere this falls back to "are we
 * running standalone", which can't detect it from a tab.
 */
let installedKnown = null;

async function detectInstalled() {
  if (isStandalone()) { installedKnown = true; return true; }
  try {
    if (navigator.getInstalledRelatedApps) {
      const related = await navigator.getInstalledRelatedApps();
      installedKnown = related.some((a) => a.platform === 'webapp');
      return installedKnown;
    }
  } catch (err) {
    /* Not supported, or blocked. Fall through to "don't know". */
  }
  installedKnown = null;    /* genuinely unknown, so don't claim either way */
  return null;
}

/* ------------------------------------------- keeping the screen and the data */

/**
 * Hold a screen wake lock while a workout is open.
 *
 * Without it the phone sleeps between sets, the page freezes, and the rest
 * alert fires when you next unlock rather than when rest actually ended —
 * which makes the timer useless for the one thing it's for.
 */
let wakeLock = null;

async function keepScreenAwake() {
  if (!('wakeLock' in navigator) || !state.settings.keepAwake || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    /* Refused on low battery, or unsupported. Not worth surfacing. */
  }
}

function releaseScreen() {
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}

/* The lock is dropped whenever the tab is hidden, so it has to be retaken. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.active) keepScreenAwake();
});

/**
 * Ask the browser to treat this origin's storage as persistent.
 *
 * Without it the log is "best effort" and can be cleared when the device is
 * short on space, or on iOS after a long stretch without opening the app.
 * This is the cheapest protection available against losing everything.
 */
async function protectStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch (err) {
    /* Nothing to do if the browser declines. */
  }
}

/* Settings renders synchronously, so the answer is filled in when it arrives. */
async function showStorageStatus() {
  const el = $('#storage-status');
  if (!el) return;
  const status = await storageStatus();
  if (!status) { el.textContent = 'This browser does not report storage protection.'; return; }

  const size = status.used ? `${Math.max(1, Math.round(status.used / 1024))} KB used. ` : '';
  el.textContent = status.persisted
    ? `${size}Your log is marked persistent, so the browser will not clear it to reclaim space.`
    : `${size}Not marked persistent yet — browsers usually grant this once you have installed the app or used it a few times. Keep exporting backups.`;
}

async function storageStatus() {
  try {
    if (!navigator.storage || !navigator.storage.persisted) return null;
    const persisted = await navigator.storage.persisted();
    let used = null;
    if (navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      used = est.usage;
    }
    return { persisted, used };
  } catch (err) {
    return null;
  }
}

/* ------------------------------------------------- units and exercise names */

/* Rewrites every stored weight into the new unit. Confirmed first, because it
   touches the whole history and can't be undone without a backup. */
function switchUnits(to) {
  const from = state.settings.units;
  let touched = 0;

  const convertSets = (sets, isNumber) => sets.forEach((s) => {
    if (s.weight === '' || s.weight == null) return;
    const next = convertWeight(s.weight, from, to);
    s.weight = isNumber ? next : String(next);
    touched++;
  });

  const preview = [];
  state.sessions.forEach((sess) => sess.entries.forEach((e) => {
    if (e.type === 'lifting') e.sets.forEach((s) => { if (s.weight !== '' && s.weight != null) preview.push(1); });
  }));

  if (preview.length && !confirm(
    `Convert ${preview.length} recorded weight${preview.length === 1 ? '' : 's'} from ${from} to ${to}?\n\n`
    + `Your numbers will be rewritten so they still mean the same load. Cancel to keep ${from}.`
  )) {
    render();   /* put the select back where it was */
    return;
  }

  state.sessions.forEach((sess) => sess.entries.forEach((e) => {
    if (e.type === 'lifting') convertSets(e.sets, false);
  }));
  state.routines.forEach((r) => r.items.forEach((it) => {
    if (it.type === 'lifting' && Array.isArray(it.sets)) convertSets(it.sets, true);
  }));
  if (state.active) {
    state.active.entries.forEach((e) => {
      if (e.type === 'lifting') convertSets(e.sets, false);
    });
  }

  /* The bar and any bodyweight log are in the same unit. */
  state.settings.barWeight = convertWeight(state.settings.barWeight, from, to);
  if (state.settings.goalWeight) {
    state.settings.goalWeight = convertWeight(state.settings.goalWeight, from, to);
  }
  (state.weights || []).forEach((w) => { w.value = convertWeight(w.value, from, to); });

  state.settings.units = to;
  save();
  render();
  toast(`Converted ${touched} weight${touched === 1 ? '' : 's'} to ${to}`);
}

/* Exercise name is the join key for "last time", PRs and the progress chart, so
   a typo or a routine rename silently forks an exercise's history in two.
   This is the reconciliation tool. */
function exerciseNameIndex() {
  const index = new Map();
  const bump = (name, type, where) => {
    if (!index.has(name)) index.set(name, { name, type, sessions: 0, routines: 0 });
    index.get(name)[where]++;
  };
  state.sessions.forEach((s) => s.entries.forEach((e) => bump(e.name, e.type, 'sessions')));
  state.routines.forEach((r) => r.items.forEach((i) => bump(i.name, i.type, 'routines')));
  return [...index.values()].sort((a, b) => (b.sessions + b.routines) - (a.sessions + a.routines));
}

function renameExerciseEverywhere(from, to) {
  let touched = 0;
  state.sessions.forEach((s) => s.entries.forEach((e) => {
    if (e.name === from) { e.name = to; touched++; }
  }));
  state.routines.forEach((r) => r.items.forEach((i) => {
    if (i.name === from) { i.name = to; touched++; }
  }));
  if (state.active) {
    state.active.entries.forEach((e) => { if (e.name === from) e.name = to; });
  }
  return touched;
}

function openExerciseNames() {
  const rows = exerciseNameIndex();

  openSheet('Exercise names', `
    <p class="small muted" style="margin-top:0">
      "Last time", personal records and the progress chart all match on the exercise
      name, so a typo splits one exercise into two histories. Rename one onto another
      to merge them.
    </p>
    ${rows.length ? rows.map((r) => `
      <button class="pick" data-action="rename-exercise" data-name="${esc(r.name)}">
        <div class="grow">
          <div class="nm">${esc(r.name)}</div>
          <div class="card-sub">${r.sessions} logged${r.routines ? ` · in ${r.routines} routine${r.routines === 1 ? '' : 's'}` : ''}</div>
        </div>
        <span class="pill ${r.type}">${r.type}</span>
      </button>`).join('')
      : '<p class="muted small">Nothing logged yet.</p>'}`);
}

/* ----------------------------------------------------------- settings view */

function renderSettings() {
  const el = $('#view-settings');
  $('#btn-header-action').hidden = true;
  const st = state.settings;

  el.innerHTML = `
    ${renderInstallCard()}

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
        <span>Alert sound</span>
        <div class="seg wrap">
          ${Object.entries(ALERT_SOUNDS).map(([key, s]) => `
            <button data-action="alert-sound" data-val="${key}"
                    class="${(st.alertSound || 'beep') === key ? 'on' : ''}">${s.label}</button>`).join('')}
        </div>
        <p class="small muted" style="margin:6px 0 0">
          ${esc((ALERT_SOUNDS[st.alertSound] || ALERT_SOUNDS.beep).hint)}
        </p>
      </label>

      <label class="field">
        <span>Alert volume — ${Math.round((st.alertVolume ?? 0.9) * 100)}%</span>
        <div class="row">
          <input type="range" min="0" max="100" step="5" class="slider"
                 data-volume value="${Math.round((st.alertVolume ?? 0.9) * 100)}">
          <button class="ghost small" data-action="test-alert">Test</button>
        </div>
        <p class="small muted" style="margin:6px 0 0">Play it with your music on and turn it up
          until you can hear it. On iPhone the alert follows the ringer switch.</p>
      </label>

      <label class="field">
        <span>Keep the screen on during a workout</span>
        <div class="seg">
          <button data-action="keep-awake" data-val="1" class="${st.keepAwake === false ? '' : 'on'}">On</button>
          <button data-action="keep-awake" data-val="0" class="${st.keepAwake === false ? 'on' : ''}">Off</button>
        </div>
        <p class="small muted" style="margin:6px 0 0">A sleeping phone freezes the page, so the
          rest alert would only fire when you unlock it. Costs some battery.</p>
      </label>

      <label class="field">
        <span>Default rest timer (seconds) — 0 turns it off</span>
        <input class="text" type="number" inputmode="numeric" min="0" max="600"
               data-setting="restSeconds" value="${st.restSeconds}">
      </label>
      <label class="field">
        <span>Workouts per week to aim for — 0 turns the goal off</span>
        <input class="text" type="number" inputmode="numeric" min="0" max="14"
               data-setting="weeklyGoal" value="${st.weeklyGoal}">
      </label>
      <label class="field" style="margin-bottom:0">
        <span>Barbell weight (${esc(st.units)}), for the plate calculator</span>
        <input class="text" type="number" inputmode="decimal" step="any" min="0"
               data-setting="barWeight" value="${st.barWeight || defaultBar()}">
      </label>
    </div>

    <div class="card">
      <div class="card-title">Your data</div>
      <p class="small muted">Everything is stored on this device only. Export now and then —
        clearing your browser data, or a long stretch without opening the app on iPhone, can wipe it.
        ${st.lastExport
          ? `Last backup ${esc(new Date(st.lastExport).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}.`
          : 'You have never exported.'}</p>

      <button class="btn block secondary" data-action="export">Backup file (.json)</button>
      <p class="small muted" style="margin:6px 0 12px">Restoreable. This is the one to keep.</p>

      <button class="btn block secondary" data-action="export-csv">Spreadsheet (.csv)</button>
      <p class="small muted" style="margin:6px 0 12px">Readable anywhere — open on your phone, or
        email it to a coach. One row per set.</p>

      <p class="small muted" id="storage-status" style="margin:0 0 12px">Checking storage…</p>

      <button class="btn block secondary" data-action="exercise-names">Exercise names</button>
      <p class="small muted" style="margin:6px 0 12px">Fix a typo or merge two spellings of the
        same lift, so its history stays in one piece.</p>

      <button class="btn block secondary" data-action="import">Import a file</button>
      <p class="small muted" style="margin:6px 0 0">Takes either format. A <code>.json</code> backup
        restores everything; a <code>.csv</code> brings in workouts, and asks whether to add them to
        your log or replace it.</p>
      <button class="btn block danger" data-action="wipe" style="margin-top:14px">Erase all data</button>
    </div>

    <div class="brand-footer">
      <span class="mark" aria-hidden="true"></span>
      <span class="brand-name">Cadence</span>
      <span class="brand-tag">Move forward</span>
      <span class="small muted">
        ${plural(state.sessions.length, 'workout')} &middot;
        ${plural(state.routines.length, 'routine')}
      </span>
    </div>`;
}

/**
 * Hand a file to the OS share sheet, falling back to a download.
 *
 * Sharing matters more than downloading on a phone: it's what lets someone mail
 * the file to a coach or drop it in a chat. Desktop browsers mostly refuse to
 * share files, hence the fallback.
 */
async function shareOrDownload(blob, filename, shareText) {
  const file = new File([blob], filename, { type: blob.type });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], ...(shareText ? { text: shareText } : {}) });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      /* Fall through to a download. */
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

const stamp = () => new Date().toISOString().slice(0, 10);

/* The restoreable one. Keep the shape importData() expects. */
async function exportData() {
  state.settings.lastExport = new Date().toISOString();
  delete state.settings.backupSnooze;
  save();

  const payload = {
    version: state.version,
    settings: state.settings,
    routines: state.routines,
    sessions: state.sessions,
    weights: state.weights,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const result = await shareOrDownload(blob, `cadence-backup-${stamp()}.json`, 'Cadence backup');
  if (result === 'downloaded') toast('Backup saved');
  render();
}

/* The readable one — a row per set, for a spreadsheet or an email. */
async function exportCsv() {
  if (!state.sessions.length) { toast('Nothing logged yet'); return; }
  const csv = buildCsv(state.sessions, state.settings.units);
  const blob = new Blob([csv], { type: 'text/csv' });
  const result = await shareOrDownload(blob, `cadence-workouts-${stamp()}.csv`, 'My workouts');
  if (result === 'downloaded') toast('Spreadsheet saved');
}

let pendingCsv = null;

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.csv,application/json,text/csv';

  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      /* Decide by content, not extension — a file renamed to .txt still works. */
      const looksJson = text.replace(/^﻿/, '').trimStart().startsWith('{');
      try {
        if (looksJson) importJsonBackup(text);
        else importCsvFile(text);
      } catch (err) {
        console.error(err);
        alert(`Could not read that file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  input.click();
}

function importJsonBackup(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.sessions) || !Array.isArray(data.routines)) {
    throw new Error('this does not look like a Cadence backup');
  }
  if (!confirm(`Replace everything on this device with ${plural(data.sessions.length, 'workout')} and ${plural(data.routines.length, 'routine')}?`)) return;
  state = {
    ...clone(DEFAULTS),
    ...data,
    settings: { ...DEFAULTS.settings, ...(data.settings || {}) },
    active: null,
  };
  save();
  render();
  toast('Backup restored');
}

/**
 * A CSV holds workouts but no routines or settings, so it can't be a blanket
 * "replace everything". The user picks: add to what's here, or replace only
 * the workout history.
 */
function importCsvFile(text) {
  const parsed = csvToSessions(text);
  if (!parsed.sessions.length) {
    throw new Error('no workouts could be read from that file');
  }

  const existing = new Set(state.sessions.map(sessionKeyOf));
  const fresh = parsed.sessions.filter((s) => !existing.has(sessionKeyOf(s)));
  const dupes = parsed.sessions.length - fresh.length;

  pendingCsv = { ...parsed, fresh, dupes };

  const dates = parsed.sessions.map((s) => +new Date(s.date));
  const span = `${new Date(Math.min(...dates)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    + ` – ${new Date(Math.max(...dates)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const totalSets = parsed.sessions.reduce(
    (n, s) => n + s.entries.reduce((m, e) => m + e.sets.length, 0), 0
  );

  openSheet('Import from spreadsheet', `
    <p class="small muted" style="margin-top:0">
      Read <strong>${parsed.sessions.length} workout${parsed.sessions.length === 1 ? '' : 's'}</strong>
      and ${totalSets} set${totalSets === 1 ? '' : 's'}, ${esc(span)}.
    </p>

    ${dupes ? `<div class="warnbox">
      <strong>${dupes} already in your log</strong>
      Matched on date, time and workout name. Adding will skip them, so importing
      the same file twice won't duplicate anything.
    </div>` : ''}

    ${parsed.skipped ? `<div class="warnbox">
      <strong>${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} skipped</strong>
      Missing an exercise name or an unreadable date.
    </div>` : ''}

    <div class="card" style="margin-top:12px">
      <div class="card-sub">First few</div>
      ${parsed.sessions.slice(0, 4).map((s) => `
        <div class="small" style="margin-top:8px">
          <span style="font-weight:600">${esc(s.name)}</span>
          <span class="muted"> · ${esc(new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}
            · ${s.entries.map((e) => esc(e.name)).join(', ')}</span>
        </div>`).join('')}
      ${parsed.sessions.length > 4 ? `<p class="small muted" style="margin:8px 0 0">…and ${parsed.sessions.length - 4} more.</p>` : ''}
    </div>

    <button class="btn block" data-action="csv-merge" style="margin-top:14px">
      Add ${fresh.length} to my log
    </button>
    <button class="btn block secondary" data-action="csv-replace" style="margin-top:8px">
      Replace my ${state.sessions.length} workout${state.sessions.length === 1 ? '' : 's'}
    </button>
    <p class="small muted" style="margin:10px 0 0">Replacing swaps out your workout history only —
      routines, goals and settings are untouched.</p>`);
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
      if (state.active.editingId) {
        if (!confirm('Stop editing? Your saved workout stays as it was.')) return;
      } else if (!confirm('Discard this workout? It will not be saved.')) {
        return;
      }
      state.active = null;
      stopTimer();
      releaseScreen();
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
          sets: e.sets.map((s) => {
            if (e.type === 'cardio') {
              return { ...(s.distance !== '' && { distance: Number(s.distance) }),
                       ...(s.minutes !== '' && { minutes: Number(s.minutes) }) };
            }
            if (e.type === 'timed') {
              return { ...(s.seconds !== '' && { seconds: Number(s.seconds) }) };
            }
            return { ...(s.weight !== '' && { weight: Number(s.weight) }),
                     ...(s.reps !== '' && { reps: Number(s.reps) }) };
          }),
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

    case 'remove-entry': {
      /* No confirm dialog: swiping open and then tapping Delete is already two
         deliberate actions, and Undo below makes it reversible anyway. */
      const at = state.active.entries.findIndex((e) => e.id === id);
      if (at < 0) return;
      const gone = state.active.entries[at];
      state.active.entries.splice(at, 1);
      save();
      render();
      toast(`Removed ${gone.name}`, {
        label: 'Undo',
        run: () => {
          state.active.entries.splice(Math.min(at, state.active.entries.length), 0, gone);
          save();
          render();
        },
      });
      break;
    }

    case 'add-set': {
      const entry = state.active.entries.find((e) => e.id === id);
      entry.sets.push(newSet(entry.type));
      save();
      render();
      break;
    }

    case 'remove-set': {
      /* The Delete button now sits beside the row rather than inside it, so the
         ids come off the button itself — closest('[data-set]') would miss. */
      const entry = state.active.entries.find((e) => e.id === btn.dataset.entryId);
      if (!entry) return;
      const at = entry.sets.findIndex((s) => s.id === id);
      if (at < 0) return;
      const gone = entry.sets[at];
      entry.sets.splice(at, 1);

      /* An exercise with no sets has nothing to tap, so a blank one takes its
         place — and Undo has to take that blank back out again. */
      const backfilled = entry.sets.length === 0;
      if (backfilled) entry.sets.push(newSet(entry.type));

      save();
      render();
      toast(`Set ${at + 1} removed`, {
        label: 'Undo',
        run: () => {
          if (backfilled) entry.sets.length = 0;
          entry.sets.splice(Math.min(at, entry.sets.length), 0, gone);
          save();
          render();
        },
      });
      break;
    }

    case 'toggle-set': {
      const { entry, set } = findSet(card.dataset.entry, row.dataset.set);
      set.done = !set.done;
      save();
      /* Update in place instead of re-rendering, so typing focus isn't lost. */
      row.classList.toggle('done', set.done);
      btn.classList.toggle('on', set.done);
      updateSummary();
      if (set.done) checkPersonalRecord(entry, set, card);
      /* No rest timer when filling in a workout that already happened. */
      if (set.done && !state.active.backdated && state.settings.restSeconds > 0) {
        startRest(state.settings.restSeconds);
      }
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

    /* ---- build me a plan ---- */
    case 'plan-start':
      startPlanWizard();
      break;

    case 'plan-answer': {
      const { key, val } = btn.dataset;
      planAnswers[key] = key === 'days' ? Number(val) : val;
      renderPlanStep();
      break;
    }

    case 'plan-back': {
      /* Clear the last answered step and re-ask it. */
      const answered = PLAN_STEPS.filter((s) => planAnswers[s.key] !== undefined);
      if (answered.length) delete planAnswers[answered[answered.length - 1].key];
      renderPlanStep();
      break;
    }

    case 'plan-restart':
      startPlanWizard();
      break;

    case 'plan-save': {
      const plan = buildPlan(planAnswers);
      plan.routines.forEach((r) => {
        state.routines.push({ id: uid(), name: r.name, items: r.items });
      });
      state.settings.weeklyGoal = plan.weeklyGoal;
      planAnswers = null;
      save();
      closeSheet();
      go('routines');
      toast(`${plan.routines.length} routines added`);
      break;
    }

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
      openSheet('What kind of exercise?', `
        <p class="small muted" style="margin-top:0">How should <strong>${esc(name)}</strong> be recorded?</p>
        ${[
          ['lifting', 'Weight and reps', 'Bench press, curls, leg press'],
          ['timed', 'A held time', 'Planks, dead hangs, wall sits'],
          ['cardio', 'Distance and duration', 'Runs, rides, rowing'],
        ].map(([type, title, eg]) => `
          <button class="pick" data-action="custom-type" data-type="${type}"
                  data-name="${esc(name)}" data-pick="${esc(btn.dataset.pick || '')}"
                  data-ctx="${esc(btn.dataset.ctx || '')}">
            <div class="grow">
              <div class="nm">${title}</div>
              <div class="card-sub">${eg}</div>
            </div>
            <span class="pill ${type}">${type}</span>
          </button>`).join('')}`);
      break;
    }

    case 'custom-type': {
      const { name, type } = btn.dataset;
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

    /* ---- logging onto a specific day ---- */
    case 'log-on-day':
      openLogSheet(btn.dataset.key);
      break;

    case 'log-empty': {
      const key = btn.dataset.key;
      if (!canStartOn(key)) return;
      closeSheet();
      startSession(null, key);
      break;
    }

    case 'log-routine': {
      const key = btn.dataset.key;
      const r = state.routines.find((x) => x.id === id);
      if (!r || !canStartOn(key)) return;
      closeSheet();
      startSession(r, key);
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

    /* ---- ordering and notes ---- */
    case 'move-entry': {
      const at = state.active.entries.findIndex((e) => e.id === id);
      const to = at + Number(btn.dataset.dir);
      if (at < 0 || to < 0 || to >= state.active.entries.length) return;
      const [moved] = state.active.entries.splice(at, 1);
      state.active.entries.splice(to, 0, moved);
      save();
      render();
      break;
    }

    case 'session-note': {
      const note = prompt('Note for this workout', state.active.note || '');
      if (note === null) return;
      state.active.note = note.trim();
      save();
      render();
      break;
    }

    /* ---- timers ---- */
    case 'time-set': {
      /* Tapping the same set again stops it and records the time. */
      if (timer.mode === 'stopwatch' && timer.setId === row.dataset.set) {
        stopTimer();
        return;
      }
      const { set } = findSet(card.dataset.entry, row.dataset.set);
      if (!set) return;
      startStopwatch(card.dataset.entry, row.dataset.set, Number(set.seconds) || 0);
      render();
      break;
    }

    case 'start-rest':
      startRest(Number(state.settings.restSeconds) || 90);
      break;

    /* ---- last time, plates, sharing, backup ---- */
    case 'repeat-last': {
      const entry = state.active.entries.find((e) => e.id === id);
      const last = lastPerformance(state.sessions, entry.name);
      if (!last) return;

      const filled = entry.sets.some((s) => s.weight || s.reps || s.distance || s.minutes);
      if (filled && !confirm("Replace what you've entered with last time's numbers?")) return;

      entry.sets = last.sets.map((src) => {
        const s = newSet(entry.type);
        if (entry.type === 'cardio') {
          s.distance = src.distance || '';
          s.minutes = src.minutes || '';
        } else if (entry.type === 'timed') {
          s.seconds = src.seconds || '';
        } else {
          s.weight = src.weight || '';
          s.reps = src.reps || '';
        }
        return s;
      });
      save();
      render();
      break;
    }

    case 'plates': {
      const entry = state.active.entries.find((e) => e.id === id);
      /* Seed from the heaviest weight already typed into this exercise. */
      const weights = entry ? entry.sets.map((s) => Number(s.weight)).filter((n) => n > 0) : [];
      openPlateSheet(weights.length ? Math.max(...weights) : '');
      break;
    }

    case 'share-week':
      shareRecap();
      break;

    case 'snooze-backup':
      state.settings.backupSnooze = new Date().toISOString();
      save();
      render();
      break;

    /* ---- bodyweight ---- */
    case 'log-weight':
      openWeightSheet();
      break;

    case 'weight-save': {
      const value = Number($('#weight-value').value);
      const key = $('#weight-date').value;
      if (!(value > 0)) { toast('Enter a weight first'); return; }
      if (!key) { toast('Pick a date'); return; }

      const when = keyToDate(key);
      when.setHours(7, 0, 0, 0);
      if (!state.weights) state.weights = [];

      /* One reading per day — a second entry replaces the first rather than
         double-counting it in the average. */
      const existing = state.weights.find((w) => dayKey(w.date) === key);
      if (existing) existing.value = value;
      else state.weights.push({ id: uid(), date: when.toISOString(), value });

      state.weights.sort((a, b) => +new Date(b.date) - +new Date(a.date));
      save();
      closeSheet();
      go('data');
      toast(existing ? 'Weight updated' : 'Weight logged');
      break;
    }

    case 'weight-delete':
      state.weights = (state.weights || []).filter((w) => w.id !== id);
      save();
      openWeightSheet();
      break;

    /* ---- exercise names ---- */
    case 'exercise-names':
      openExerciseNames();
      break;

    case 'rename-exercise': {
      const from = btn.dataset.name;
      const existing = exerciseNameIndex();
      const current = existing.find((r) => r.name === from);
      const to = (prompt(`Rename "${from}" to:`, from) || '').trim();
      if (!to || to === from) return;

      const clash = existing.find((r) => r.name === to);
      if (clash && clash.type !== current.type) {
        alert(`"${to}" is recorded as ${clash.type} and "${from}" as ${current.type}.\n\n`
          + 'Merging those would mix incompatible sets, so this one is blocked.');
        return;
      }

      const merging = !!clash;
      if (merging && !confirm(`"${to}" already exists.\n\nMerge "${from}" into it? Their histories will be combined and this can't be undone without a backup.`)) {
        return;
      }

      const touched = renameExerciseEverywhere(from, to);
      save();
      openExerciseNames();
      toast(merging ? `Merged into ${to}` : `Renamed in ${touched} place${touched === 1 ? '' : 's'}`);
      break;
    }

    /* ---- editing a logged workout ---- */
    case 'edit-session': {
      const session = state.sessions.find((s) => s.id === id);
      if (!session) return;
      if (state.active && !confirm('You have a workout in progress. Put it aside to edit this one?')) return;
      startEditSession(session);
      break;
    }

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

    case 'install-app':
      runInstallPrompt();
      break;

    case 'copy-app-link': {
      const url = new URL('app.html', location.href).href;
      const done = () => toast('Link copied — paste it into Safari');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, () => prompt('Copy this into Safari:', url));
      } else {
        prompt('Copy this into Safari:', url);
      }
      break;
    }

    /* ---- alerts ---- */
    case 'alert-sound':
      state.settings.alertSound = btn.dataset.val;
      save();
      render();
      playAlert(btn.dataset.val);      /* hear it immediately on choosing it */
      break;

    case 'test-alert':
      playAlert();
      break;

    case 'keep-awake':
      state.settings.keepAwake = btn.dataset.val === '1';
      save();
      render();
      if (state.settings.keepAwake && state.active) keepScreenAwake();
      else releaseScreen();
      break;

    /* ---- settings ---- */
    case 'theme':
      state.settings.theme = btn.dataset.val;
      save();
      applyTheme();
protectStorage();
if (state.active) keepScreenAwake();
      render();
      break;

    case 'export':
      exportData();
      break;

    case 'export-csv':
      exportCsv();
      break;

    case 'import':
      importData();
      break;

    case 'csv-merge': {
      if (!pendingCsv) return;
      const added = pendingCsv.fresh.length;
      state.sessions = state.sessions.concat(pendingCsv.fresh)
        .sort((a, b) => +new Date(b.date) - +new Date(a.date));
      pendingCsv = null;
      save();
      closeSheet();
      go('calendar');
      toast(added ? `Added ${added} workout${added === 1 ? '' : 's'}` : 'Nothing new to add');
      break;
    }

    case 'csv-replace': {
      if (!pendingCsv) return;
      if (!confirm(`Replace your ${state.sessions.length} logged workouts with the ${pendingCsv.sessions.length} in this file?`)) return;
      state.sessions = pendingCsv.sessions
        .slice()
        .sort((a, b) => +new Date(b.date) - +new Date(a.date));
      pendingCsv = null;
      save();
      closeSheet();
      go('calendar');
      toast('History replaced');
      break;
    }

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

  /* Volume slides live so you can hear the change while dragging. */
  if (el.hasAttribute('data-volume')) {
    state.settings.alertVolume = Math.min(1, Math.max(0, Number(el.value) / 100));
    save();
    const label = el.closest('label').querySelector('span');
    if (label) label.textContent = `Alert volume — ${Math.round(state.settings.alertVolume * 100)}%`;
    return;
  }

  /* Renaming an exercise inside a saved routine. A blank box isn't persisted,
     so clearing the field to retype can't wipe the name. */
  if (el.dataset.editItem !== undefined) {
    const r = state.routines.find((x) => x.id === el.dataset.rid);
    const item = r && r.items[Number(el.dataset.editItem)];
    const name = el.value.trim();
    if (item && name) { item.name = name; save(); }
    return;
  }

  /* Same, for an exercise in the paste-import preview. */
  if (el.dataset.pitem !== undefined && pendingImport) {
    const routine = pendingImport.routines[Number(el.dataset.pr)];
    const item = routine && routine.items[Number(el.dataset.pitem)];
    const name = el.value.trim();
    if (item && name) item.name = name;
    return;
  }

  if (el.hasAttribute('data-duration') && state.active) {
    state.active.durationMin = el.value === '' ? null : Math.max(0, Number(el.value) || 0);
    save();
    return;
  }

  if (el.dataset.select === 'exercise') {
    dataExercise = el.value;
    render();
    return;
  }

  /* Changing how an exercise is recorded invalidates its target sets — a
     weight/reps target means nothing once it's a timed hold. */
  if (el.dataset.itemType !== undefined) {
    const r = state.routines.find((x) => x.id === el.dataset.rid);
    const item = r && r.items[Number(el.dataset.itemType)];
    if (item && item.type !== el.value) {
      item.type = el.value;
      item.sets = [{}];
      save();
      editRoutine(r.id);
    }
    return;
  }

  if (el.dataset.setting) {
    const key = el.dataset.setting;

    /* Units are a real unit, not a label. Switching without converting would
       turn every recorded 185 lb into "185 kg" — a 2.2x lie about the whole
       training history. */
    if (key === 'units' && el.value !== state.settings.units) {
      switchUnits(el.value);
      return;
    }

    state.settings[key] = NUMERIC_SETTINGS.includes(key)
      ? Math.max(0, Number(el.value) || 0)
      : el.value;
    save();
  }
});

/* ---- swipe an exercise left to reveal Delete ----

   Two deliberate actions instead of one stray tap. The gesture only engages on
   a clearly horizontal drag, so vertical scrolling through a long workout still
   works, and it never starts on an input or a button — otherwise dragging
   across a weight field would fight the keyboard. */

const SWIPE_REVEAL = 96;      /* must match .swipe-del width in styles.css */
const SWIPE_START = 8;        /* px of travel before we claim the gesture */

let swipe = null;

function closeSwipes(except) {
  $$('.swipe-wrap.open').forEach((el) => { if (el !== except) el.classList.remove('open'); });
}

document.addEventListener('pointerdown', (ev) => {
  const face = ev.target.closest && ev.target.closest('.swipe-face');
  if (!face) { closeSwipes(); return; }

  /* Buttons are excluded so a tap on the done-tick or Delete stays a tap.
     Inputs are NOT excluded: a set row is almost entirely number fields, so
     excluding them would leave nowhere to start the gesture. A tap still
     focuses normally, because nothing engages until the finger travels. */
  if (ev.target.closest('button, select, a')) return;

  /* closest() picks the innermost face, so dragging a set row swipes the row
     and dragging the card header swipes the whole exercise. */
  swipe = {
    wrap: face.parentElement,
    card: face,
    x0: ev.clientX,
    y0: ev.clientY,
    dx: 0,
    engaged: false,
  };
});

document.addEventListener('pointermove', (ev) => {
  if (!swipe) return;

  const dx = ev.clientX - swipe.x0;
  const dy = ev.clientY - swipe.y0;

  if (!swipe.engaged) {
    /* Let a vertical drag go to the scroller and drop the gesture entirely. */
    if (Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < SWIPE_START) return;
    swipe.engaged = true;
    swipe.wrap.classList.add('dragging');
    closeSwipes(swipe.wrap);
  }

  /* Left only, and never past the width of the button being revealed. */
  const from = swipe.wrap.classList.contains('open') ? -SWIPE_REVEAL : 0;
  swipe.dx = Math.max(-SWIPE_REVEAL, Math.min(0, from + dx));
  swipe.card.style.transform = `translateX(${swipe.dx}px)`;
});

function endSwipe() {
  if (!swipe) return;
  const { wrap, card, dx, engaged } = swipe;
  swipe = null;
  if (!engaged) return;

  wrap.classList.remove('dragging');
  card.style.transform = '';
  wrap.classList.toggle('open', dx < -SWIPE_REVEAL / 2);
}

document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);

/* Tabbing to a Delete button slides its row open, so a keyboard user can see
   what they are about to press. Done in JS rather than with `:focus` in CSS
   because that pseudo-class only matches while the whole document has focus,
   which makes the behaviour hard to rely on. */
document.addEventListener('focusin', (ev) => {
  const del = ev.target.closest && ev.target.closest('.swipe-del');
  closeSwipes(del ? del.parentElement : null);
  if (del) del.parentElement.classList.add('open');
});

document.addEventListener('focusout', (ev) => {
  const del = ev.target.closest && ev.target.closest('.swipe-del');
  if (del) del.parentElement.classList.remove('open');
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
/* Bind defensively. A cached-HTML/new-JS mismatch used to throw here at the top
   level, which killed the script before it rendered anything and left the app a
   blank screen. A missing control is worth a warning, not a dead app. */
function on(sel, ev, fn) {
  const el = $(sel);
  if (el) el.addEventListener(ev, fn);
  else console.warn(`${sel} is missing — stale cached markup?`);
}

on('#timer-stop', 'click', stopTimer);
on('#timer-plus', 'click', () => {
  if (timer.mode !== 'rest') return;
  timer.endsAt += 30000;
  timer.total += 30;
  updateTimer();
});

/* Keep the "elapsed" line honest while a live workout is open. A backdated log
   has no clock to track, and re-rendering would only fight the user's typing. */
setInterval(() => {
  if (!state.active || state.active.backdated) return;
  if (currentView !== 'workout' || !$('#sheet').hidden) return;
  if ($('#view-workout input:focus')) return;
  /* Re-rendering rebuilds the list, which would slide a swiped-open card shut
     while the user is reaching for Delete. */
  if ($('.swipe-wrap.open')) return;
  render();
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
  /* When a new worker takes over, reload once so the page is running the same
     version it just installed. Without this the update only appears on the
     *second* refresh, which reads as "my changes didn't deploy". */
  let reloading = false;
  /* Only an *update* should reload. On a first visit the controller goes from
     none to installed, which fires the same event and would reload for nothing. */
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => reg.update().catch(() => {}))
      .catch((err) => console.warn('Service worker failed', err));
  });
}

go('workout');
