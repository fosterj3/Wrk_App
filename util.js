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


/**
 * A routine as the plain text it probably started life as.
 *
 * The log arrives as pasted text; this is how it leaves. Round-trips through
 * the paste parser, so what someone shares can be pasted straight back in.
 */
function routineToText(routine, units) {
  const lines = [String(routine.name || 'Routine')];
  (routine.items || []).forEach((it) => {
    const sets = it.sets || [];
    const first = sets[0] || {};
    const uniform = sets.every((s) => JSON.stringify(s) === JSON.stringify(first));

    if (it.type === 'cardio' || it.type === 'practice') {
      const bits = [];
      if (first.distance != null && first.distance !== '') {
        /* A bare number is not a distance to the parser, so the unit has to be
           written out or the text will not read back. Falls back to the one
           implied by the weight units. */
        const unit = it.distanceUnit || (units === 'kg' ? 'km' : 'mi');
        bits.push(`${first.distance} ${unit}`);
      }
      if (first.minutes != null && first.minutes !== '') bits.push(`${Math.round(Number(first.minutes))} min`);
      lines.push(`${it.name}${bits.length ? ` ${bits.join(' ')}` : ''}`);
      return;
    }
    if (it.type === 'timed') {
      lines.push(`${it.name}${first.seconds ? ` ${sets.length}x${first.seconds}s` : ''}`);
      return;
    }
    if (!sets.length || (first.reps == null || first.reps === '')) {
      lines.push(it.name);
      return;
    }
    if (uniform) {
      const at = (first.weight != null && first.weight !== '') ? ` @ ${first.weight}${units || ''}` : '';
      lines.push(`${it.name} ${sets.length}x${first.reps}${at}`);
      return;
    }
    lines.push(`${it.name} ${sets.map((s) => s.reps).join('/')}`);
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

  const entries = (v) => arr(v)
    .filter((e) => e && typeof e === 'object' && e.name)
    .map((e) => ({
      ...e,
      id: e.id || uid(),
      name: str(e.name),
      type: EXERCISE_TYPES.includes(e.type) ? e.type : 'lifting',
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
        .map((i) => ({ ...i, name: str(i.name), sets: arr(i.sets) })),
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
