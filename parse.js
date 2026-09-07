/* Turns free-form workout text — the kind people keep in a notes app — into
   routine objects this app understands.

   Two rules shape everything here:
     1. Be forgiving. People write "3x8", "3 sets of 8", "3 x 8-10 @ 185lb".
     2. Be loud about failure. Any line this can't read comes back in
        `unparsed` so the UI can show it, rather than dropping it silently. */

'use strict';

const CARDIO_WORDS = /\b(run|runs|running|jog|jogging|walk|walking|treadmill|bike|biking|cycle|cycling|spin|row|rowing|rower|erg|elliptical|stair|stairs|stairmaster|swim|swimming|jump\s?rope|skipping|sprint|sprints|cardio|hike|hiking)\b/i;

/* Words that suggest a line is a section heading ("Day 1", "Push", "Monday"). */
const HEADER_WORDS = /^(day\s*\d+|day\s+[a-z]\b|week\s*\d+|workout\s*[a-z0-9]?\b|push|pull|legs?|upper|lower|full\s?body|chest|back|shoulders?|arms?|core|abs|cardio|rest\s?day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|weds?|thur?s?|fri|sat|sun)\b/i;

const BULLET = /^([-–—*•·▪>]|\d+[.)])\s+/;

const FILLER_WORDS = /^(in|at|for|of|on|to|with|and|then|each|per|total|approx|about|around|every)$/i;

/* Coaching notes and section labels people keep alongside their exercises.
   These are surfaced as skipped lines rather than turned into exercises. */
const NOISE_RE = /^(rest|notes?|remember|reminder|warm\s?-?\s?up|warmup|cool\s?-?\s?down|stretch(?:ing)?|superset|circuit|amrap|emom|tempo|optional|todo|goal|deload|repeat|finisher)\b/i;

/* Prose giveaways — full sentences rather than an exercise name. */
const PROSE_RE = /\b(remember|don'?t|make sure|try to|between sets|each side|as needed|if you|then do|focus on|keep the|aim for)\b|[!?]\s*$/i;

/* Shorthand people actually type, mapped to the library's wording. */
const ALIASES = {
  'bench': 'barbell bench press',
  'bench press': 'barbell bench press',
  'flat bench': 'barbell bench press',
  'bp': 'barbell bench press',
  'squat': 'barbell back squat',
  'squats': 'barbell back squat',
  'back squat': 'barbell back squat',
  'ohp': 'overhead press',
  'military press': 'overhead press',
  'shoulder press': 'overhead press',
  'rdl': 'romanian deadlift',
  'rdls': 'romanian deadlift',
  'dl': 'deadlift',
  'deads': 'deadlift',
  'pullup': 'pull up',
  'pullups': 'pull up',
  'chin up': 'pull up',
  'chinups': 'pull up',
  'pushup': 'push up',
  'pushups': 'push up',
  'press up': 'push up',
  'db curl': 'dumbbell curl',
  'db curls': 'dumbbell curl',
  'bb curl': 'barbell curl',
  'bicep curl': 'dumbbell curl',
  'bicep curls': 'dumbbell curl',
  'curls': 'dumbbell curl',
  'pulldown': 'lat pulldown',
  'pulldowns': 'lat pulldown',
  'lat pulldowns': 'lat pulldown',
  'tricep pushdown': 'triceps pushdown',
  'tricep pushdowns': 'triceps pushdown',
  'pushdowns': 'triceps pushdown',
  'lateral raise': 'dumbbell lateral raise',
  'lateral raises': 'dumbbell lateral raise',
  'lat raise': 'dumbbell lateral raise',
  'side raise': 'dumbbell lateral raise',
  'side raises': 'dumbbell lateral raise',
  'skullcrusher': 'skull crusher',
  'skullcrushers': 'skull crusher',
  'jog': 'run',
  'jogging': 'run',
  'bike': 'cycling',
  'biking': 'cycling',
  'spin': 'cycling',
  'erg': 'rowing machine',
  'row machine': 'rowing machine',
  'rower': 'rowing machine',
  'stairmaster': 'stair climber',
  'stairs': 'stair climber',
};

/* ------------------------------------------------------------ name matching */

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function singularize(key) {
  return key.split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

let libIndexCache = null;
function libraryIndex() {
  if (!libIndexCache) {
    const lib = (typeof LIBRARY === 'undefined') ? [] : LIBRARY;
    libIndexCache = lib.map((e) => ({ name: e.name, type: e.type, key: norm(e.name) }));
  }
  return libIndexCache;
}

function resolveKey(name) {
  const k = norm(name);
  return ALIASES[k] ? norm(ALIASES[k]) : k;
}

/* Exact match only — used when deciding whether a line is a heading, where a
   loose match would wrongly turn "Back" into "Barbell Back Squat". */
function matchLibraryExact(name) {
  const k = resolveKey(name);
  if (!k) return null;
  const lib = libraryIndex();
  return lib.find((e) => e.key === k)
    || lib.find((e) => singularize(e.key) === singularize(k))
    || null;
}

function matchLibrary(name) {
  const exact = matchLibraryExact(name);
  if (exact) return exact;

  const k = resolveKey(name);
  if (k.length < 4) return null;
  const lib = libraryIndex();

  /* "barbell bench press (heavy)" contains a library name — take the longest. */
  const contained = lib
    .filter((e) => k.includes(e.key) && e.key.length >= 4)
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (contained) return contained;

  /* "pulldown" is part of exactly one library name — safe only when unique. */
  const containing = lib.filter((e) => e.key.includes(k));
  if (containing.length === 1) return containing[0];

  return null;
}

/* --------------------------------------------------------- number extraction */

const round2 = (n) => Math.round(n * 100) / 100;

/* Pull every number-ish thing out of a line; whatever text survives is the name. */
function readLine(line) {
  let rest = ` ${line} `;
  const out = {};

  const eat = (re, fn) => {
    const m = rest.match(re);
    if (!m) return false;
    fn(m);
    rest = rest.replace(m[0], ' ');
    return true;
  };

  if (eat(/\b(bw|bodyweight|body\s?weight)\b/i, () => { out.bodyweight = true; })) { /* noted */ }

  /* sets / reps / weight, most specific pattern first */
  eat(/(\d+)\s*[x×]\s*(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)/i, (m) => {
    out.setCount = +m[1]; out.reps = +m[2]; out.weight = +m[3];
  })
  || eat(/(\d+)\s*[x×]\s*(\d+)\s*[-–]\s*(\d+)/i, (m) => {
    out.setCount = +m[1]; out.reps = +m[2]; out.repsText = `${m[2]}–${m[3]}`;
  })
  || eat(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)/i, (m) => {
    out.setCount = +m[1]; out.reps = +m[2];
  })
  || eat(/(\d+)\s*sets?\s*(?:of|x|×)?\s*(\d+)?\s*(?:reps?)?/i, (m) => {
    out.setCount = +m[1]; if (m[2]) out.reps = +m[2];
  })
  || eat(/\b(\d+(?:\s*\/\s*\d+){1,9})\b/, (m) => {
    out.scheme = m[1].split('/').map((p) => Number(p.trim())).filter((n) => !isNaN(n));
  });

  /* a bare "x8" or "8 reps" with no set count */
  if (out.reps == null && out.scheme == null) {
    eat(/\b(\d+)\s*reps?\b/i, (m) => { out.reps = +m[1]; });
  }

  if (out.weight == null) {
    eat(/@\s*(\d+(?:\.\d+)?)\s*(lbs?|kgs?)?/i, (m) => {
      out.weight = +m[1];
      if (m[2]) out.unit = m[2].toLowerCase().startsWith('k') ? 'kg' : 'lb';
    })
    || eat(/\b(\d+(?:\.\d+)?)\s*(lbs?|kgs?)\b/i, (m) => {
      out.weight = +m[1];
      out.unit = m[2].toLowerCase().startsWith('k') ? 'kg' : 'lb';
    });
  }

  /* duration — hours and minutes can both appear, so these accumulate */
  eat(/\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i, (m) => {
    out.minutes = (out.minutes || 0) + +m[1] * 60;
  });
  eat(/\b(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)\b/i, (m) => {
    out.minutes = (out.minutes || 0) + +m[1];
  });
  if (out.minutes == null) {
    eat(/\b(\d+):([0-5]\d)\b/, (m) => { out.minutes = +m[1] + +m[2] / 60; });
  }
  /* Kept in both units: a timed hold wants raw seconds, cardio wants minutes. */
  eat(/\b(\d+)\s*(?:sec|secs|second|seconds|s)\b/i, (m) => {
    out.seconds = (out.seconds || 0) + +m[1];
    out.minutes = (out.minutes || 0) + +m[1] / 60;
  });
  if (out.minutes != null) out.minutes = round2(out.minutes);

  /* distance */
  eat(/\b(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i, (m) => { out.distance = +m[1]; out.unit2 = 'mi'; })
  || eat(/\b(\d+(?:\.\d+)?)\s*(?:km|kilometers?|kilometres?|k)\b/i, (m) => { out.distance = +m[1]; out.unit2 = 'km'; })
  || eat(/\b(\d+)\s*(?:meters?|metres?|m)\b/i, (m) => { out.distance = +m[1]; out.unit2 = 'm'; })
  || eat(/\b(\d+(?:\.\d+)?)\s*(?:yd|yards?)\b/i, (m) => { out.distance = +m[1]; out.unit2 = 'yd'; });

  /* A number still hanging around after sets and reps were read is the weight:
     "Squat 5x5 315". Runs last so it can't swallow "28" out of "28 min". */
  if (out.weight == null && (out.setCount != null || out.reps != null || out.scheme != null)) {
    eat(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/, (m) => { out.weight = +m[1]; });
  }

  const name = rest
    .replace(/[@:;,]+/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—x×]+|[\s\-–—x×]+$/gi, '')
    .trim();

  /* "5k in 28 min" leaves behind only the word "in" — that isn't a name. */
  const tokens = name.split(' ').filter(Boolean);
  out.name = (tokens.length && tokens.every((t) => FILLER_WORDS.test(t))) ? '' : name;

  return out;
}

function hasNumbers(p) {
  return p.setCount != null || p.reps != null || p.weight != null
    || p.minutes != null || p.distance != null || p.scheme != null;
}

/* A line like "185 x 5" — numbers only, so it belongs to the exercise above it. */
function isSetOnly(line) {
  if (!/\d/.test(line)) return false;
  const stripped = line
    .replace(/\d+(\.\d+)?/g, ' ')
    .replace(/[x×@/,\-–:()]/gi, ' ')
    .replace(/\b(lbs?|kgs?|reps?|sets?|mins?|minutes?|secs?|seconds?|mi|miles?|km|m|k|yd|yards?|bw)\b/gi, ' ')
    .trim();
  return stripped === '';
}

function titleCase(s) {
  if (s !== s.toLowerCase()) return s;          // they used capitals; leave it alone
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------- line -> item */

function setFrom(type, p) {
  const s = {};
  if (type === 'cardio') {
    if (p.distance != null) s.distance = p.distance;
    if (p.minutes != null) s.minutes = p.minutes;
  } else if (type === 'timed') {
    /* "Plank 3x45s" gives seconds; "Plank 3x45" leaves 45 sitting in reps. */
    const secs = p.seconds != null ? p.seconds
      : p.reps != null ? p.reps
      : p.minutes != null ? Math.round(p.minutes * 60)
      : null;
    if (secs != null) s.seconds = secs;
  } else {
    if (p.reps != null) s.reps = p.reps;
    if (p.weight != null) s.weight = p.weight;
  }
  return s;
}

function toItem(p) {
  /* "5k in 28 min" has no usable name but is clearly a cardio effort. */
  if (!p.name) {
    if (p.distance == null && p.minutes == null) return null;
    p = { ...p, name: 'Cardio' };
  }

  const lib = matchLibrary(p.name);
  const cardioByWord = CARDIO_WORDS.test(p.name);
  const cardioByShape = p.reps == null && p.setCount == null
    && (p.minutes != null || p.distance != null);

  const type = lib ? lib.type : ((cardioByWord || cardioByShape) ? 'cardio' : 'lifting');

  const item = {
    name: lib ? lib.name : titleCase(p.name),
    type,
    sets: [],
  };
  if (!lib) item.custom = true;
  if (p.repsText) item.repsText = p.repsText;
  if (p.unit2) item.distanceUnit = p.unit2;
  if (p.unit) item.sourceUnit = p.unit;

  const count = Math.max(1, p.setCount || 1);
  if (type !== 'cardio' && p.scheme) {
    p.scheme.forEach((reps) => item.sets.push(setFrom(type, { reps, weight: p.weight })));
  } else {
    for (let i = 0; i < count; i++) item.sets.push(setFrom(type, p));
  }

  return item;
}

/* ------------------------------------------------------------- the entry point */

function isHeaderLine(line, p) {
  const clean = line.replace(/^#+\s*/, '').replace(/:\s*$/, '').trim();
  if (/^#{1,6}\s/.test(line)) return true;
  if (matchLibraryExact(clean)) return false;   // "Deadlift:" is an exercise, not a heading
  if (hasNumbers(p)) return false;
  if (/:\s*$/.test(line)) return true;
  if (clean.length <= 40 && HEADER_WORDS.test(clean)) return true;
  return false;
}

function cleanHeader(line) {
  return line.replace(/^#+\s*/, '').replace(/:\s*$/, '').replace(BULLET, '').trim() || 'Imported routine';
}

/**
 * @param {string} text  Whatever the user pasted.
 * @returns {{routines: Array, unparsed: string[], units: string[]}}
 */
function parseWorkoutText(text) {
  const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
  const routines = [];
  const unparsed = [];
  const units = new Set();
  let current = null;

  const startRoutine = (name) => {
    current = { name, items: [] };
    routines.push(current);
    return current;
  };

  /* Collect the real content first — the first-line heading rule needs to peek
     at the line that follows. */
  const content = [];
  lines.forEach((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (/^[-–—*_=#]{3,}$/.test(trimmed)) return;              // divider row
    const bulleted = BULLET.test(trimmed);
    const line = trimmed.replace(BULLET, '').trim();
    if (line) content.push({ trimmed, line, bulleted });
  });

  content.forEach((row, idx) => {
    const { trimmed, line, bulleted } = row;

    /* "185 x 5" under an exercise -> another set of that exercise */
    if (current && current.items.length && isSetOnly(line)) {
      const p = readLine(line);
      const last = current.items[current.items.length - 1];
      /* On a set line, "135 x 5" is weight × reps — not 135 sets of 5. */
      if (last.type !== 'cardio' && p.weight == null && p.setCount != null) {
        p.weight = p.setCount;
        delete p.setCount;
      }
      if (p.unit) units.add(p.unit);
      /* Drop the placeholder set the bare "Bench Press" line created. */
      if (last.sets.length === 1 && Object.keys(last.sets[0]).length === 0) last.sets = [];
      last.sets.push(setFrom(last.type, p));
      return;
    }

    const p = readLine(line);

    /* Coaching notes and stray sentences: skip, but show them to the user. */
    if (!matchLibraryExact(p.name) && (NOISE_RE.test(line) || PROSE_RE.test(line))) {
      unparsed.push(trimmed);
      return;
    }

    /* A title on the very first line ("MY PROGRAM"), confirmed by the next line
       actually looking like an exercise. */
    const titleFirstLine = idx === 0 && !bulleted && !hasNumbers(p)
      && !matchLibraryExact(p.name) && content.length > 1
      && content.slice(1).some((r) => {
        if (NOISE_RE.test(r.line) || PROSE_RE.test(r.line)) return false;   // skip coaching notes
        const next = readLine(r.line);
        return hasNumbers(next) || !!matchLibraryExact(next.name);
      });

    if (!bulleted && (titleFirstLine || isHeaderLine(line, p))) {
      startRoutine(cleanHeader(line));
      return;
    }

    const item = toItem(p);
    if (!item) { unparsed.push(trimmed); return; }
    if (p.unit) units.add(p.unit);
    if (!current) startRoutine('Imported routine');
    current.items.push(item);
  });

  return {
    routines: routines.filter((r) => r.items.length),
    unparsed,
    units: [...units],
  };
}
