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
      type: ['lifting', 'cardio', 'timed'].includes(e.type) ? e.type : 'lifting',
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
