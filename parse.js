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

/* Unit words left stranded once the number beside them has been read. */
const UNIT_LEFTOVER = /^(s|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|lb|lbs|kg|kgs|rep|reps|set|sets|x)$/i;

/* Coaching notes and section labels people keep alongside their exercises.
   These are surfaced as skipped lines rather than turned into exercises. */
const NOISE_RE = /^(rest|notes?|remember|reminder|warm\s?-?\s?up|warmup|cool\s?-?\s?down|stretch(?:ing)?|superset|circuit|amrap|emom|tempo|optional|todo|goal|deload|repeat|finisher)\b/i;

/* Prose giveaways — full sentences rather than an exercise name. */
const PROSE_RE = /\b(remember|don'?t|make sure|try to|between sets|each side|as needed|if you|then do|focus on|keep the|aim for)\b|[!?]\s*$/i;

/* A link is never an exercise. Programs get pasted out of chats, blogs and
   emails, and a stray URL used to come through as an exercise named after the
   address — punctuation stripped, sitting in the routine looking like a bug. */
const LINK_RE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|io|app|co|uk|gg|me)\b/i;

/* Labelled preamble — "Equipment: bands", "Duration: ~45-60 minutes". Only
   labels on this list count, which is the whole point: a custom exercise
   written "Band Chest Press: 4 x 5" has to stay an exercise, and the only
   reliable way to tell the two apart is to know the label. */
const META_LABEL = /^(equipment|gear|kit|goal|goals|focus|aim|duration|length|level|difficulty|frequency|schedule|when|where|why|program|programme|plan|split|phase|block|intensity|rpe|tempo|rest|rounds?|coach|author|source|summary|overview|description|reminders?|caution|warning|safety)$/i;

/* Labels whose value is genuinely a note about the exercise above, rather than
   preamble to throw away. "Back-friendly alternative: glute bridge" is worth
   keeping — attached to the lift it replaces. */
/* Labels that are pure scaffolding — the value is the whole note. Anything
   else on the NOTE_LABEL list describes what kind of note it is and is kept. */
const BARE_NOTE_LABEL = /^(notes?|cues?|tips?)$/i;

const NOTE_LABEL = /^(notes?|tips?|cues?|form|technique|setup|set\s?-?up|alternatives?|alt|subs?|substitutions?|substitute|swap|regression|progression|modifications?|modify|variation|easier|harder|(?:[a-z-]+\s+)?(?:friendly\s+)?alternative)$/i;

/* Section labels inside one workout, as opposed to the name of a new one.
   Deliberately excludes split names — "Push", "Legs", "Upper" mean a different
   day and should still start a new routine. These mean "still the same
   session, different part of it". */
const SECTION_WORD = /^(strength|lifting|weights?|resistance|cardio|conditioning|metcon|core|abs|accessor(?:y|ies)|finisher|mobility|stretch(?:ing)?|flexibility|practice|yoga|pilates|main|circuit|superset)(\s+(?:work|training|block|section|circuit|finisher|portion|part))?$/i;

/* Function words that pad a coaching cue but rarely an exercise name. Split
   names ("up", "down", "back", "over") are left out on purpose: Pull Up, Step
   Up, Bent Over Row and Back Squat are all real names. */
const CUE_WORDS = /\b(the|your|you|if|then|until|while|between|through|toward|towards|onto|into)\b/i;

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

/* ------------------------------------------------------------ name matching

   norm() and singularize() live in util.js: the app needs them too, to spot
   that a freshly typed "planks" is the "Plank" already in the log.          */

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

  /* "barbell bench press (heavy)" contains a library name — take the longest.
     Flagged as qualified, because the extra words may well make it a different
     exercise: Copenhagen Plank is not a Plank and a Band Lat Pulldown is not a
     Lat Pulldown. The caller keeps the name the user wrote and takes only the
     type, which is the part it actually needed. */
  const contained = lib
    .filter((e) => k.includes(e.key) && e.key.length >= 4)
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (contained) return { ...contained, qualified: true };

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

  /* "185lb x 5" — the unit stopped the sets pattern from matching, so the 5 was
     left on the floor and ended up in the name: an exercise called "Bench
     Press 5". Only safe after a weight has been read, or this would eat the
     reps out of "3x8". */
  if (out.reps == null && out.scheme == null && out.weight != null) {
    eat(/[x×]\s*(\d+)\b/i, (m) => { out.reps = +m[1]; });
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

  /* "Plank 3x45s" reads 3 and 45 out of "3x45" and leaves the "s" stranded, so
     the name came through as "Plank s". It went unnoticed for as long as the
     library supplied the name instead. Only done when numbers were actually
     read, or "Mile Repeats" would lose its distance word. */
  let tokens = name.split(' ').filter(Boolean);
  if (hasNumbers(out)) tokens = tokens.filter((t) => !UNIT_LEFTOVER.test(t));

  /* "5k in 28 min" leaves behind only the word "in" — that isn't a name. */
  out.name = (tokens.length && tokens.every((t) => FILLER_WORDS.test(t)))
    ? '' : tokens.join(' ');

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

/* --------------------------------------------------- notes, labels, sections */

/**
 * Is this line a coaching cue belonging to the exercise above it?
 *
 * Programs kept in a notes app read "4. Band Lateral Raise / 3 x 8 / * Stand on
 * band. / * Lower slowly." Every one of those bullets used to come back as its
 * own exercise, which is what made a six-lift workout import as forty rows.
 *
 * Two signals do the work, and both are about shape rather than vocabulary:
 * sentence punctuation, and length. The title-case check is the important
 * guard — "Single Arm Dumbbell Overhead Press" is five words but obviously a
 * name, because a name capitalises and a sentence does not.
 */
function looksLikeCue(line) {
  const t = String(line == null ? '' : line).trim();
  if (!t) return false;
  if (/\d/.test(t)) return false;               // numbers are prescribing work
  if (matchLibraryExact(t)) return false;       // "- Deadlift." is still a lift

  if (/[.,;:!?]$/.test(t)) return true;         // a sentence, not a name
  /* "Brisk outdoor walk, OR" — a line left hanging on a conjunction is the
     first half of a choice, never the name of an exercise. */
  if (/,?\s+(?:or|and)$/i.test(t)) return true;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 5) {
    const capped = words.filter((w) => /^[A-Z]/.test(w)).length;
    if (capped < words.length - 1) return true;
  }
  return words.length >= 4 && CUE_WORDS.test(t);
}

/* "Equipment: bands" -> { label: 'Equipment', value: 'bands' }, or null. */
function readLabel(line) {
  const m = String(line == null ? '' : line).match(/^([A-Za-z][A-Za-z0-9 /&'’-]{0,30}?)\s*:\s*(\S.*)$/);
  if (!m) return null;
  return { label: m[1].trim(), value: m[2].trim() };
}

/* A modality heading inside one session, not the name of the next one. */
function isSectionLabel(clean) {
  return SECTION_WORD.test(String(clean == null ? '' : clean).trim());
}

/**
 * On a numbers-only line under an exercise, does "4 x 5" mean four sets of
 * five, or 4lb for five reps?
 *
 * A written program means sets; someone logging a set they just finished means
 * weight. An explicit unit settles it outright. Otherwise the first number
 * decides: nobody does 185 sets, and nobody benches 4lb.
 */
function setLineMeaning(p) {
  if (p.setCount == null || p.reps == null) return 'weight';
  /* A weight of its own on the line settles it outright: in "3 x 8 135lb" the
     135 is the load, so the 3 can only be a set count. */
  if (p.weight != null) return 'sets';
  /* A unit stuck to the first number makes that number the load: "8kg x 5". */
  if (p.unit) return 'weight';
  return p.setCount <= 12 ? 'sets' : 'weight';
}

/* Cap what one exercise can accumulate, so pasting an essay can't produce a
   note longer than the routine it belongs to. */
const NOTE_LIMIT = 600;

function addNote(item, text) {
  const line = String(text == null ? '' : text).trim();
  if (!item || !line) return;
  const next = item.note ? `${item.note}\n${line}` : line;
  item.note = next.length > NOTE_LIMIT ? `${next.slice(0, NOTE_LIMIT - 1).trimEnd()}…` : next;
}

/* ------------------------------------------------------------- line -> item */

function setFrom(type, p) {
  const s = {};
  if (type === 'cardio') {
    if (p.distance != null) s.distance = p.distance;
    if (p.minutes != null) s.minutes = p.minutes;
  } else if (type === 'practice') {
    /* Duration and nothing else. Without this branch a practice line fell
       through to the lifting case, which reads reps and weight — so "Yoga
       45 min" came back as a yoga session of no length at all. */
    if (p.minutes != null) s.minutes = p.minutes;
    else if (p.seconds != null) s.minutes = round2(p.seconds / 60);
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

function toItem(p, hint) {
  /* "5k in 28 min" has no usable name but is clearly a cardio effort. Under a
     section heading the heading is the better name: "Conditioning / 10 minutes"
     is ten minutes of conditioning, not of something called Cardio. */
  if (!p.name) {
    if (p.distance == null && p.minutes == null) return null;
    p = { ...p, name: hint || 'Cardio' };
  }

  const lib = matchLibrary(p.name);
  const cardioByWord = CARDIO_WORDS.test(p.name);
  const cardioByShape = p.reps == null && p.setCount == null
    && (p.minutes != null || p.distance != null);

  const type = lib ? lib.type : ((cardioByWord || cardioByShape) ? 'cardio' : 'lifting');

  /* A qualified match keeps what the user wrote. Collapsing "Forearm Plank"
     into "Plank" renames their exercise and merges its history with a
     different movement; the type is the only part worth borrowing. */
  const keepsOwnName = !lib || lib.qualified;

  const item = {
    name: keepsOwnName ? titleCase(p.name) : lib.name,
    type,
    sets: [],
  };
  if (keepsOwnName) item.custom = true;
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
  /* Tracked rather than read off the end of current.items, because a section
     heading has to break the chain: after "Cardio" a bare "10 minutes" is a new
     exercise, not another set of the plank above it. */
  let lastItem = null;
  let section = '';

  const startRoutine = (name) => {
    current = { name, items: [] };
    routines.push(current);
    lastItem = null;
    section = '';
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

    /* "Equipment: bands", "Duration: ~45-60 minutes" — preamble people keep at
       the top of a program. Notes-ish labels stay, as notes; the rest is
       reported as skipped so nothing vanishes without being mentioned.
       Checked before the cue rule so "Note: keep hips level." stores the note
       and not the word "Note:" along with it. */
    const labelled = readLabel(line);
    if (labelled && !matchLibraryExact(labelled.label)) {
      if (NOTE_LABEL.test(labelled.label) && lastItem) {
        /* "Note:" is scaffolding and comes off; "Back-friendly alternative:"
           is part of what the note says, so it stays. */
        addNote(lastItem, BARE_NOTE_LABEL.test(labelled.label) ? labelled.value : line);
        return;
      }
      if (META_LABEL.test(labelled.label) || NOTE_LABEL.test(labelled.label)) {
        unparsed.push(trimmed);
        return;
      }
    }

    /* A bulleted sentence under an exercise is a coaching cue. Keep it, on the
       exercise it describes, rather than inventing an exercise called "Keep
       knees tracking over toes". */
    if (bulleted && lastItem && looksLikeCue(line)) {
      addNote(lastItem, line);
      return;
    }

    /* "185 x 5" under an exercise -> another set of that exercise */
    if (lastItem && isSetOnly(line)) {
      const p = readLine(line);
      const last = lastItem;
      const meaning = last.type === 'cardio' ? 'weight' : setLineMeaning(p);
      /* On a logged set, "135 x 5" is weight × reps — not 135 sets of 5. */
      if (meaning === 'weight' && p.weight == null && p.setCount != null) {
        p.weight = p.setCount;
        delete p.setCount;
      }
      if (p.unit) units.add(p.unit);
      /* Drop the placeholder set the bare "Bench Press" line created. */
      if (last.sets.length === 1 && Object.keys(last.sets[0]).length === 0) last.sets = [];
      /* "Squat" then "4 x 5" prescribes four sets; only the weight reading
         describes a single one. */
      const repeat = meaning === 'sets' ? Math.max(1, p.setCount || 1) : 1;
      for (let i = 0; i < repeat; i++) last.sets.push(setFrom(last.type, p));
      return;
    }

    const p = readLine(line);

    /* Coaching notes, stray sentences and links: skip, but show them so the
       user can see nothing was quietly swallowed. */
    if (!matchLibraryExact(p.name)
        && (NOISE_RE.test(line) || PROSE_RE.test(line) || LINK_RE.test(line))) {
      unparsed.push(trimmed);
      return;
    }

    /* A title on the very first line ("MY PROGRAM"), confirmed by the next line
       actually looking like an exercise.
       A bare set line directly underneath rules it out: "Band Squat / 4 x 5" is
       one exercise and its sets, and reading the first line as a title left the
       sets with nothing to attach to, so the whole paste came back empty. */
    const titleFirstLine = idx === 0 && !bulleted && !hasNumbers(p)
      && !matchLibraryExact(p.name) && content.length > 1
      && !isSetOnly(content[1].line)
      && content.slice(1).some((r) => {
        if (NOISE_RE.test(r.line) || PROSE_RE.test(r.line)) return false;   // skip coaching notes
        const next = readLine(r.line);
        return hasNumbers(next) || !!matchLibraryExact(next.name);
      });

    /* "Strength" and "Cardio" on their own label a part of one workout.
       Splitting there would file half a session as a routine of its own, and
       treating it as an exercise invents a lift called Strength. Checked ahead
       of the heading rule because most of these words aren't headings — a
       program says "Strength", never "Strength Day 1". */
    const clean = cleanHeader(line);
    if (!bulleted && !titleFirstLine && !hasNumbers(p) && isSectionLabel(clean)) {
      if (current) {
        section = clean;
        lastItem = null;
      } else {
        startRoutine(clean);
      }
      return;
    }

    if (!bulleted && (titleFirstLine || isHeaderLine(line, p))) {
      startRoutine(clean);
      return;
    }

    const item = toItem(p, section);
    if (!item) { unparsed.push(trimmed); return; }
    if (p.unit) units.add(p.unit);
    if (!current) startRoutine('Imported routine');
    current.items.push(item);
    lastItem = item;
  });

  return {
    routines: routines.filter((r) => r.items.length),
    unparsed,
    units: [...units],
  };
}
