/* Helpers with no DOM and no app state, shared by the app and by tests.html.

   These live outside app.js so the pure logic in parse.js / plan.js / viz.js
   can be loaded and asserted against without booting the whole UI. */

'use strict';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/* "1 workout", not "1 workouts". Irregular plurals take the second argument. */
function plural(n, word, many) {
  return `${n} ${n === 1 ? word : (many || `${word}s`)}`;
}

/**
 * Every exercise type the app understands.
 *
 * - lifting  — weight × reps
 * - cardio   — distance and a duration
 * - timed    — a hold measured in seconds (planks, dead hangs)
 * - practice — a session measured in minutes and nothing else: yoga, pilates,
 *              mobility. Distance would be meaningless and reps don't exist.
 *
 * Stated once because normalizeState() uses it as a whitelist — anything not
 * on this list is rewritten to 'lifting' on load, so forgetting to add a new
 * type here silently destroys every entry using it.
 */
const EXERCISE_TYPES = ['lifting', 'cardio', 'timed', 'practice'];

/** Types whose sets are a duration in minutes rather than reps or seconds. */
const MINUTE_TYPES = ['cardio', 'practice'];

/* ----------------------------------------------------------- durations */

/**
 * Cardio and practice durations stay stored as **total minutes**, which is what
 * the CSV, the charts and the paste parser have always read. Hours are a data
 * entry convenience laid over that, not a second stored field — a 90-minute
 * ride is one number however it was typed.
 *
 * The value may be fractional: the stopwatch writes what it actually measured.
 * Everything user-facing rounds to the whole minute.
 */
function splitDuration(totalMinutes) {
  /* Round the total before dividing, or 119.6 becomes "1h 60m". */
  const t = Math.max(0, Math.round(Number(totalMinutes) || 0));
  return { h: Math.floor(t / 60), m: t % 60 };
}

function joinDuration(hours, minutes) {
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  const total = h * 60 + m;
  return total > 0 ? total : 0;
}

function formatMinutes(totalMinutes) {
  const { h, m } = splitDuration(totalMinutes);
  if (!h && !m) return '—';
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* Weeks start Sunday, matching the calendar grid. */
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/* Local-time day key. Deliberately not toISOString(), which shifts to UTC and
   would file an evening workout under the following day. */
function dayKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function keyToDate(key) {
  return new Date(`${key}T00:00:00`);
}

/* lb <-> kg. Weights are stored as plain numbers in whatever unit is current,
   so switching units has to rewrite them or every historical number silently
   changes meaning. */
const LB_PER_KG = 2.20462262;

function convertWeight(value, from, to) {
  const n = Number(value);
  if (!isFinite(n) || from === to) return n;
  const converted = to === 'kg' ? n / LB_PER_KG : n * LB_PER_KG;
  return Math.round(converted * 10) / 10;
}

/* --------------------------------------------------- sharing a routine */


/* ------------------------------------------------- editing an exercise target

   A routine's exercise holds an array of target sets, which is the right shape
   for the workout screen and the wrong one for editing: what people want to
   say is "four sets of eight". These two functions are the translation, and
   they have to agree — collapse(spread(x)) is what the editor does on every
   repaint, so a disagreement shows up as a value that changes when you look
   at it.                                                                    */

/**
 * Spread "8", or "8/8/6", across `count` sets.
 *
 * Fewer values than sets repeats the last one — "8/6" over four sets is
 * 8, 6, 6, 6, which is what someone dropping reps means. Extra values are
 * dropped. A blank leaves the set blank rather than writing a zero.
 */
function spreadValues(text, count) {
  const parts = String(text == null ? '' : text)
    .split('/').map((s) => s.trim()).filter((s) => s !== '');
  const out = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    const raw = parts.length ? parts[Math.min(i, parts.length - 1)] : '';
    const n = Number(raw);
    out.push(raw === '' || isNaN(n) ? null : n);
  }
  return out;
}

/** The inverse: one number when every set agrees, else "8/8/6". */
function collapseValues(values) {
  const clean = (values || []).map((v) => (v == null || v === '' ? '' : String(v)));
  if (!clean.length) return '';
  if (clean.every((v) => v === clean[0])) return clean[0];
  return clean.join('/');
}

/**
 * Build an exercise's target sets from what the editor is showing.
 *
 * @param {string} type    lifting | timed | cardio | practice
 * @param {number} count   how many sets
 * @param {object} fields  { reps, weight, seconds, distance, minutes } as typed
 */
function buildTargetSets(type, count, fields) {
  const f = fields || {};
  const n = Math.max(1, Math.min(MAX_TARGET_SETS, Math.round(Number(count) || 1)));
  const reps = spreadValues(f.reps, n);
  const weight = spreadValues(f.weight, n);
  const seconds = spreadValues(f.seconds, n);
  const distance = spreadValues(f.distance, n);
  /* One duration for the whole exercise: nobody logs a 45-minute yoga class as
     three sets of fifteen. */
  const mins = f.minutes === '' || f.minutes == null ? null : Number(f.minutes);
  const minutes = mins == null || isNaN(mins) ? null : mins;

  const out = [];
  for (let i = 0; i < n; i++) {
    const s = {};
    if (type === 'timed') {
      if (seconds[i] != null) s.seconds = seconds[i];
    } else if (type === 'cardio') {
      if (distance[i] != null) s.distance = distance[i];
      if (minutes != null) s.minutes = minutes;
    } else if (type === 'practice') {
      if (minutes != null) s.minutes = minutes;
    } else {
      if (reps[i] != null) s.reps = reps[i];
      if (weight[i] != null) s.weight = weight[i];
    }
    out.push(s);
  }
  return out;
}

/** The cap on sets one exercise can hold, so a stray keystroke can't add 900. */
const MAX_TARGET_SETS = 30;

/** Read an exercise's target sets back out as editor field values. */
function itemTargets(item) {
  const sets = (item && Array.isArray(item.sets) ? item.sets : []);
  const pick = (key) => collapseValues(sets.map((s) => (s ? s[key] : null)));
  const first = sets.find((s) => s && s.minutes != null && s.minutes !== '');
  return {
    sets: Math.max(1, sets.length),
    reps: pick('reps'),
    weight: pick('weight'),
    seconds: pick('seconds'),
    distance: pick('distance'),
    minutes: first ? Number(first.minutes) : '',
  };
}

/**
 * A routine as the plain text it probably started life as.
 *
 * The log arrives as pasted text; this is how it leaves. Round-trips through
 * the paste parser, so what someone shares can be pasted straight back in.
 */
function routineToText(routine, units) {
  const lines = [String(routine.name || 'Routine')];

  /* Notes go out as "- Note: ..." rather than a bare bullet. A bare bullet
     reads better but only comes back as a note if it happens to look like a
     sentence, and "Band only" doesn't — it would return as an exercise. The
     label is what makes the round trip reliable. */
  const withNote = (it) => {
    if (!it.note) return;
    String(it.note).split('\n').forEach((n) => {
      const line = n.trim();
      if (line) lines.push(`- Note: ${line}`);
    });
  };

  (routine.items || []).forEach((it) => {
    const sets = it.sets || [];
    const first = sets[0] || {};
    const uniform = sets.every((s) => JSON.stringify(s) === JSON.stringify(first));

    /* One line per exercise, built then pushed, so the note that follows it
       can't be left behind by an early return. */
    const exercise = () => {
      if (it.type === 'cardio' || it.type === 'practice') {
        const bits = [];
        if (first.distance != null && first.distance !== '') {
          /* A bare number is not a distance to the parser, so the unit has to
             be written out or the text will not read back. Falls back to the
             one implied by the weight units. */
          const unit = it.distanceUnit || (units === 'kg' ? 'km' : 'mi');
          bits.push(`${first.distance} ${unit}`);
        }
        if (first.minutes != null && first.minutes !== '') bits.push(`${Math.round(Number(first.minutes))} min`);
        return `${it.name}${bits.length ? ` ${bits.join(' ')}` : ''}`;
      }
      if (it.type === 'timed') {
        return `${it.name}${first.seconds ? ` ${sets.length}x${first.seconds}s` : ''}`;
      }
      if (!sets.length || first.reps == null || first.reps === '') return it.name;
      if (uniform) {
        const at = (first.weight != null && first.weight !== '') ? ` @ ${first.weight}${units || ''}` : '';
        return `${it.name} ${sets.length}x${first.reps}${at}`;
      }
      return `${it.name} ${sets.map((s) => s.reps).join('/')}`;
    };

    lines.push(exercise());
    withNote(it);
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------- platform */

function isIos() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    /* iPadOS 13+ reports itself as a Mac; touch points give it away. */
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/* Every browser on iOS runs WebKit, but only Safari can add a real standalone
   web app — the others produce a shortcut that opens back in the browser.
   Third-party browsers tag themselves in the user agent. */
const IOS_BROWSER_TAGS = [
  [/CriOS/, 'Chrome'],
  [/FxiOS/, 'Firefox'],
  [/EdgiOS/, 'Edge'],
  [/OPiOS|OPT\//, 'Opera'],
  [/GSA\//, 'the Google app'],
  [/DuckDuckGo/, 'DuckDuckGo'],
];

/** @returns {string|null} Browser name on iOS, 'Safari' if none match, null off iOS. */
function iosBrowserName() {
  if (!isIos()) return null;
  const ua = navigator.userAgent;
  const hit = IOS_BROWSER_TAGS.find(([re]) => re.test(ua));
  return hit ? hit[1] : 'Safari';
}

/** True on iOS in a browser that cannot install a standalone web app. */
function isIosWrongBrowser() {
  const name = iosBrowserName();
  return !!name && name !== 'Safari';
}

/* ------------------------------------------------------- state repair */

/**
 * Coerce whatever came out of storage into a shape the app can actually walk.
 *
 * load() already survives unparseable JSON, but not JSON that parses into the
 * wrong shape — `sessions: null`, a session with no `entries`, a string where
 * an array belongs. Any of those crashed the first render, which leaves a blank
 * screen and no way back except clearing storage, i.e. losing everything.
 *
 * Deliberately salvaging rather than strict: drop only the records that cannot
 * be read, and keep the rest.
 */
function normalizeState(parsed, defaults) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (v == null ? '' : String(v));

  const sets = (v) => arr(v)
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({ ...s, id: s.id || uid() }));

  /* A note is free text and gets rendered, so it has to be a string however it
     arrives — an imported object here would reach innerHTML as "[object
     Object]" at best. */
  const note = (v) => (v == null || v === '' ? undefined : str(v));

  const entries = (v) => arr(v)
    .filter((e) => e && typeof e === 'object' && e.name)
    .map((e) => ({
      ...e,
      id: e.id || uid(),
      name: str(e.name),
      type: EXERCISE_TYPES.includes(e.type) ? e.type : 'lifting',
      note: note(e.note),
      sets: sets(e.sets),
    }));

  const sessions = arr(parsed && parsed.sessions)
    .filter((s) => s && typeof s === 'object' && s.date && !isNaN(+new Date(s.date)))
    .map((s) => ({
      ...s,
      id: s.id || uid(),
      name: str(s.name) || 'Workout',
      durationMs: Number(s.durationMs) || 0,
      entries: entries(s.entries),
    }));

  const routines = arr(parsed && parsed.routines)
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      ...r,
      id: r.id || uid(),
      name: str(r.name) || 'Routine',
      items: arr(r.items)
        .filter((i) => i && typeof i === 'object' && i.name)
        .map((i) => ({ ...i, name: str(i.name), note: note(i.note), sets: arr(i.sets) })),
    }));

  const weights = arr(parsed && parsed.weights)
    .filter((w) => w && typeof w === 'object' && w.date && Number(w.value) > 0)
    .map((w) => ({ id: w.id || uid(), date: w.date, value: Number(w.value) }));

  const active = parsed && parsed.active && typeof parsed.active === 'object'
    ? { ...parsed.active, entries: entries(parsed.active.entries) }
    : null;

  const settings = (parsed && parsed.settings && typeof parsed.settings === 'object')
    ? parsed.settings : {};

  return {
    ...defaults,
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
    sessions,
    routines,
    weights,
    active,
    settings: { ...defaults.settings, ...settings },
  };
}
