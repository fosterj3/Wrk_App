/* Assertions for the pure logic. Open tests.html to run them.

   Every case here is a bug that actually shipped at some point, or a rule that
   would be expensive to break silently. When you fix a bug in parse.js,
   plan.js or viz.js, add the case that would have caught it. */

'use strict';

const results = [];
let group = 'general';

function describe(name, fn) { group = name; fn(); }

function check(what, pass, why) {
  results.push({ group, what, pass: !!pass, why: pass ? '' : why || '' });
}

function eq(what, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(what, a === e, `got ${a}, expected ${e}`);
}

/* --------------------------------------------------------------- utilities */

describe('utilities', () => {
  eq('esc neutralises angle brackets', esc('<script>'), '&lt;script&gt;');
  eq('esc handles null', esc(null), '');

  eq('one workout is singular', plural(1, 'workout'), '1 workout');
  eq('two workouts are not', plural(2, 'workout'), '2 workouts');
  eq('zero takes the plural', plural(0, 'routine'), '0 routines');

  /* Durations are stored as total minutes; hours are an input convenience. */
  eq('minutes split into hours', splitDuration(95), { h: 1, m: 35 });
  eq('under an hour has no hours', splitDuration(45), { h: 0, m: 45 });
  eq('blank is zero', splitDuration(''), { h: 0, m: 0 });
  eq('hours and minutes join up', joinDuration(2, 15), 135);
  eq('a blank hour box still counts the minutes', joinDuration('', 40), 40);
  eq('typing 90 minutes is 90 minutes', joinDuration('', 90), 90);

  /* Regression: rounding after dividing turned 119.6 into "1h 60m". */
  eq('a fraction under the hour rolls up', splitDuration(119.6), { h: 2, m: 0 });
  eq('the stopwatch value rounds for display', splitDuration(43.5), { h: 0, m: 44 });

  eq('formatting reads in hours past 60', formatMinutes(95), '1h 35m');
  eq('a round hour drops the minutes', formatMinutes(60), '1h');
  eq('short sessions stay in minutes', formatMinutes(45), '45 min');
  eq('nothing logged shows a dash', formatMinutes(0), '—');

  /* dayKey must use local parts: toISOString() would file a late workout under
     tomorrow for anyone west of UTC. */
  const evening = new Date(2026, 0, 15, 23, 30);
  eq('dayKey uses local date', dayKey(evening), '2026-01-15');
  eq('keyToDate round-trips', dayKey(keyToDate('2026-03-09')), '2026-03-09');

  eq('startOfWeek lands on Sunday', startOfWeek(new Date(2026, 8, 9)).getDay(), 0);

  eq('lb to kg', convertWeight(185, 'lb', 'kg'), 83.9);
  eq('kg to lb', convertWeight(83.9, 'kg', 'lb'), 185);
  eq('same unit is a no-op', convertWeight(100, 'lb', 'lb'), 100);

  /* Weights are stored to one decimal, so a there-and-back conversion can land
     0.1 out (225 -> 102.1 -> 225.1). Fine in a gym; just don't assert equality. */
  const there = convertWeight(225, 'lb', 'kg');
  const back = convertWeight(there, 'kg', 'lb');
  check('round trip drifts less than 0.2', Math.abs(back - 225) < 0.2, `got ${back}`);
});

/* ------------------------------------------------------------ state repair */

describe('surviving bad stored data', () => {
  const D = {
    version: 1, settings: { units: 'lb', restSeconds: 90 },
    routines: [], weights: [], sessions: [], active: null,
  };
  const walk = (s) => {
    /* Roughly what the app does on first render. */
    s.sessions.forEach((x) => x.entries.forEach((e) => e.sets.forEach(() => {})));
    s.routines.forEach((r) => r.items.forEach(() => {}));
    s.weights.forEach(() => {});
    return true;
  };
  const survives = (blob) => {
    try { return walk(normalizeState(blob, D)); } catch (e) { return `threw: ${e.message}`; }
  };

  /* Each of these crashed the app to a blank screen before normalizeState. */
  check('null sessions', survives({ sessions: null, routines: [] }) === true);
  check('sessions is a string', survives({ sessions: 'oops', routines: [] }) === true);
  check('session with no entries',
    survives({ sessions: [{ id: 'x', name: 'W', date: new Date().toISOString() }], routines: [] }) === true);
  check('entry with no sets',
    survives({ sessions: [{ date: new Date().toISOString(), entries: [{ name: 'Squat' }] }], routines: [] }) === true);
  check('routine with no items', survives({ sessions: [], routines: [{ name: 'R' }] }) === true);
  check('whole blob is a string', survives('nonsense') === true);
  check('whole blob is null', survives(null) === true);

  eq('an undated session is dropped',
    normalizeState({ sessions: [{ name: 'no date' }] }, D).sessions.length, 0);
  eq('a valid session is kept',
    normalizeState({ sessions: [{ date: '2026-01-01T08:00:00Z', entries: [] }] }, D).sessions.length, 1);
  eq('an unknown exercise type is coerced to lifting',
    normalizeState({ sessions: [{ date: '2026-01-01T08:00:00Z',
      entries: [{ name: 'X', type: 'bogus' }] }] }, D).sessions[0].entries[0].type, 'lifting');
  eq('a weigh-in with no value is dropped',
    normalizeState({ weights: [{ date: '2026-01-01', value: 0 }, { date: '2026-01-02', value: 180 }] }, D).weights.length, 1);

  /* A note is free text that gets rendered, so it has to be a string whatever
     the stored file says. An object here would reach the page as
     "[object Object]". */
  eq('a note survives a reload',
    normalizeState({ routines: [{ name: 'R', items: [{ name: 'Squat', note: 'knees out' }] }] }, D)
      .routines[0].items[0].note, 'knees out');
  eq('a note that is not text is coerced',
    typeof normalizeState({ routines: [{ name: 'R', items: [{ name: 'Squat', note: { a: 1 } }] }] }, D)
      .routines[0].items[0].note, 'string');
  eq('good data is left alone',
    normalizeState({ sessions: [], routines: [], weights: [], settings: { units: 'kg' } }, D).settings.units, 'kg');
});

/* ---------------------------------------------------------------- platform */

describe('platform detection', () => {
  /* Only Safari can install a standalone web app on iOS. Getting this wrong
     means sending someone hunting for a button that cannot exist. */
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
  const as = (ua) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ';

  as(`${IOS}Version/18.0 Mobile/15E148 Safari/604.1`);
  eq('iPhone Safari is recognised', iosBrowserName(), 'Safari');
  check('iPhone Safari can install', !isIosWrongBrowser());

  as(`${IOS}CriOS/131.0 Mobile/15E148 Safari/604.1`);
  eq('iPhone Chrome is recognised', iosBrowserName(), 'Chrome');
  check('iPhone Chrome cannot install', isIosWrongBrowser());

  as(`${IOS}FxiOS/133.0 Mobile/15E148 Safari/605.1.15`);
  eq('iPhone Firefox is recognised', iosBrowserName(), 'Firefox');

  as(`${IOS}EdgiOS/131.0 Mobile/15E148 Safari/605.1.15`);
  eq('iPhone Edge is recognised', iosBrowserName(), 'Edge');

  as('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36');
  check('Android Chrome is not iOS', !isIos());
  check('Android Chrome is not blocked', !isIosWrongBrowser());

  as('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  check('desktop Chrome is not blocked', !isIosWrongBrowser());

  delete navigator.userAgent;
  if (original) Object.defineProperty(Navigator.prototype, 'userAgent', original);
});

/* ------------------------------------------------------------- the library */

describe('exercise library', () => {
  const names = LIBRARY.map((e) => e.name);
  check('no duplicate names', new Set(names).size === names.length,
    `duplicates: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
  /* Against the shared list, not a copy of it: normalizeState rewrites any
     type it does not recognise to 'lifting', so a library entry using a type
     that is not registered would be silently destroyed on the next load. */
  check('every entry has a known type',
    LIBRARY.every((e) => EXERCISE_TYPES.includes(e.type)),
    `bad: ${LIBRARY.filter((e) => !EXERCISE_TYPES.includes(e.type)).map((e) => e.name)}`);
  check('the library covers practice', LIBRARY.some((e) => e.type === 'practice'));
  check('every entry has a group', LIBRARY.every((e) => !!e.group));
});

/* ---------------------------------------------------------------- parsing */

describe('paste parser', () => {
  const one = (text) => parseWorkoutText(text).routines[0];

  eq('sets x reps at a weight',
    one('Bench Press 3x8 @ 185').items[0].sets,
    [{ reps: 8, weight: 185 }, { reps: 8, weight: 185 }, { reps: 8, weight: 185 }]);

  /* Regression: a bare trailing number is the weight. */
  eq('bare weight after sets x reps',
    one('Squat 5x5 315').items[0].sets[0], { reps: 5, weight: 315 });

  eq('"3 sets of 10" longhand', one('Cable Fly 3 sets of 10').items[0].sets.length, 3);

  eq('rep scheme becomes distinct sets',
    one('Squats 12/10/8 @ 185').items[0].sets.map((s) => s.reps), [12, 10, 8]);

  /* Regression: "135 x 5" under an exercise is weight x reps, not 135 sets. */
  const perSet = one('Bench Press\n135 x 5\n185 x 3');
  eq('per-set lines are weight x reps',
    perSet.items[0].sets, [{ reps: 5, weight: 135 }, { reps: 3, weight: 185 }]);
  eq('the placeholder set is dropped', perSet.items[0].sets.length, 2);

  eq('shorthand resolves via the library', one('bench 3x8').items[0].name, 'Barbell Bench Press');
  eq('unknown names are kept as custom', one('Zercher Carry 3x8').items[0].custom, true);

  /* The matcher still accepts a name that *contains* a library name, but only
     to borrow the type from it. It used to adopt the library's name too, which
     quietly renamed the exercise: "Copenhagen Plank" became "Plank" and shared
     its history with a different movement. Now the words you wrote survive and
     the library only settles how the exercise is recorded. */
  eq('a qualified name is kept, not replaced by the library one',
    one('Copenhagen Plank 3x30s').items[0].name, 'Copenhagen Plank');
  eq('...but the library still supplies the type',
    one('Copenhagen Plank 3x30s').items[0].type, 'timed');
  /* Capitals the user typed are left as typed, so this keeps its lowercase h. */
  eq('a qualifier before a library name is kept too',
    one('Barbell Bench Press heavy 3x5').items[0].name, 'Barbell Bench Press heavy');
  eq('an exact library name is still canonicalised',
    one('bench 3x8').items[0].name, 'Barbell Bench Press');

  /* Regression: "Plank 3x45s" reads the 45 and leaves the "s" behind, so the
     name was "Plank s" all along — masked until the library stopped renaming
     it. */
  eq('a stranded unit letter is not part of the name',
    one('Plank 3x45s').items[0].name, 'Plank');
  eq('a distance word in a name survives when nothing consumed it',
    one('Mile Repeats 4x1').items[0].name, 'Mile Repeats');

  eq('cardio distance and duration',
    one('Run 3.1 mi 28 min').items[0].sets[0], { distance: 3.1, minutes: 28 });

  /* Regression: "5k in 28 min" once produced an exercise called "In". */
  eq('filler words are not a name', one('5k in 28 min').items[0].name, 'Cardio');

  /* Regression: a bare number on a timed exercise is seconds, not reps. */
  eq('timed holds read as seconds', one('Plank 3x45s').items[0].sets[0], { seconds: 45 });
  eq('bare number on a timed lift is seconds', one('Plank 3x60').items[0].sets[0], { seconds: 60 });

  const messy = parseWorkoutText('MY PROGRAM\nremember to stretch!!\nBench 3x8\nrest 90s between sets');
  eq('a title line becomes the routine name', messy.routines[0].name, 'MY PROGRAM');
  eq('coaching notes are reported, not dropped', messy.unparsed.length, 2);

  const twoDay = parseWorkoutText('Day 1\nBench 3x8\nDay 2\nSquat 5x5');
  eq('headings split into routines', twoDay.routines.map((r) => r.name), ['Day 1', 'Day 2']);
});

/* ------------------------------------------------- programs kept in a notes app

   The shape a real user pasted in: a title, a labelled preamble, section
   headings, numbered exercises with the sets on the *next* line, and a block of
   bulleted coaching cues under each one. It imported as forty exercises, most
   of them sentences like "Keep knees tracking over toes".                     */

describe('pasting a program written out in full', () => {
  const PROGRAM = [
    'Full Body – Monday Strength (Home)',
    'Equipment: resistance bands, EZbar, handles, door anchor',
    'Goal: Full-body strength',
    'Duration: ~45–60 minutes',
    'Strength',
    '1. EZbar Band Squat',
    '4 × 5',
    '',
    '* Stand on the middle of the band.',
    '* Keep knees tracking over toes.',
    '',
    '2. Band Lateral Raise',
    '3 × 8',
    '',
    '* Stand on band.',
    '* Use lighter resistance if needed.',
    '',
    'Back-friendly alternative: Banded glute bridge – 3 × 10–12.',
    '3. Forearm Plank',
    '3 × 60 sec',
    '',
    '* Elbows under shoulders.',
    '',
    'Cardio',
    '10 minutes',
    '',
    '* Brisk outdoor walk, OR',
    '* March in place.',
    '',
    'Reminder: Start lighter than you think.',
  ].join('\n');

  const out = parseWorkoutText(PROGRAM);
  const r = out.routines[0];

  eq('the whole thing is one workout, not one per section', out.routines.length, 1);
  eq('the title line names it', r.name, 'Full Body – Monday Strength (Home)');

  /* The headline number. Forty before, four now. */
  eq('cues do not become exercises', r.items.length, 4);
  eq('the exercises are the exercises', r.items.map((i) => i.name),
    ['EZbar Band Squat', 'Band Lateral Raise', 'Forearm Plank', 'Cardio']);

  /* "4 × 5" on its own line under a bare name means four sets of five. Read as
     weight × reps it gave one set of 5 reps at 4lb. */
  eq('sets on the following line are sets, not weight', r.items[0].sets.length, 4);
  eq('...with the reps on every one', r.items[0].sets, [
    { reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5 },
  ]);

  eq('a hold keeps its set count too', r.items[2].sets,
    [{ seconds: 60 }, { seconds: 60 }, { seconds: 60 }]);
  eq('a qualified hold is still typed as a hold', r.items[2].type, 'timed');

  eq('bulleted cues land on the exercise above them',
    r.items[0].note, 'Stand on the middle of the band.\nKeep knees tracking over toes.');

  /* A labelled alternative belongs to the lift it replaces. */
  check('a labelled alternative is kept as a note',
    /Banded glute bridge/.test(r.items[1].note || ''), r.items[1].note);

  /* A section heading has to break the chain: without that, "10 minutes" read
     as another set of the plank above it. */
  eq('a section heading starts a new exercise', r.items[3].type, 'cardio');
  eq('...and carries the duration', r.items[3].sets[0], { minutes: 10 });

  eq('preamble is reported as skipped, not silently dropped', out.unparsed, [
    'Equipment: resistance bands, EZbar, handles, door anchor',
    'Goal: Full-body strength',
    'Duration: ~45–60 minutes',
    'Reminder: Start lighter than you think.',
  ]);
});

describe('telling a cue from an exercise name', () => {
  /* The discriminator is shape, not vocabulary: a sentence ends in punctuation
     and runs long, a name is short and capitalised. Getting this wrong in
     either direction is bad — invented exercises one way, lost work the other. */
  const cue = (s) => looksLikeCue(s);

  check('a sentence is a cue', cue('Keep hips level.'));
  check('a long uncapitalised line is a cue', cue('brace your abs and squeeze the glutes'));
  check('a dangling conjunction is a cue', cue('Brisk outdoor walk, OR'));

  check('a bare exercise name is not', !cue('Band Chest Press'));
  check('a long capitalised name is not', !cue('Single Arm Dumbbell Overhead Press'));
  check('a library name with a full stop is not', !cue('Squat.'));
  check('anything with a number is not', !cue('Stand on 1 leg'));

  /* Bulleted lists of bare exercise names are the common case this must not
     break: every line is numberless and bulleted, and every one is an
     exercise. */
  const bulleted = parseWorkoutText('Push Day\n- Bench Press\n- Overhead Press\n- Dips');
  eq('a bulleted list of names stays a list of exercises',
    bulleted.routines[0].items.map((i) => i.name),
    ['Barbell Bench Press', 'Overhead Press', 'Dips']);
});

describe('set lines under an exercise', () => {
  const sets = (text) => parseWorkoutText(text).routines[0].items[0].sets;

  /* Both of these are "name, then numbers on the next line" and they mean
     opposite things. The first number decides: nobody does 185 sets. */
  eq('a big first number is a weight', sets('Bench Press\n185 x 5'), [{ reps: 5, weight: 185 }]);
  eq('a small first number is a set count', sets('Band Squat\n4 x 5'),
    [{ reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5 }]);
  /* An explicit unit settles it outright, whatever the number. */
  eq('a stated unit means weight', sets('Bench Press\n8 kg x 5'), [{ reps: 5, weight: 8 }]);

  /* A weight of its own leaves nothing to guess about: the other number is the
     set count, whatever its size. */
  eq('a separate weight makes the first number a set count',
    sets('Barbell Row\n3 x 8 135lb'),
    [{ reps: 8, weight: 135 }, { reps: 8, weight: 135 }, { reps: 8, weight: 135 }]);

  /* Several logged sets in a row still stack up as they always did. */
  eq('logged sets accumulate', sets('Bench Press\n185 x 5\n195 x 3'),
    [{ reps: 5, weight: 185 }, { reps: 3, weight: 195 }]);
});

/* --------------------------------------------------------------- csv round trip */

describe('csv export / import', () => {
  const sessions = [{
    id: 's1', name: 'Run, easy', date: new Date(2026, 4, 6, 7, 35).toISOString(), durationMs: 0,
    entries: [
      { id: 'a', name: 'Barbell Bench Press', type: 'lifting', sets: [{ weight: '185', reps: '8' }, { weight: '185', reps: '7' }] },
      { id: 'b', name: 'Plank', type: 'timed', sets: [{ seconds: '45' }] },
      { id: 'c', name: 'Run', type: 'cardio', sets: [{ distance: '3.1', minutes: '28' }] },
    ],
  }];

  const csv = buildCsv(sessions, 'lb');
  check('starts with a BOM so Excel reads UTF-8', csv.charCodeAt(0) === 0xFEFF);

  /* Notes are per exercise but the file is per set, so the note repeats down
     the rows. A newline inside it has to survive the quoting, or the file
     breaks at that row and takes the rest of the export with it. */
  const withNotes = buildCsv([{
    id: 's3', name: 'Noted', date: new Date(2026, 4, 8, 9, 0).toISOString(), durationMs: 0,
    entries: [{ id: 'f', name: 'Band Squat', type: 'lifting',
      note: 'Stand on the band.\nKnees out', sets: [{ weight: '', reps: '5' }, { weight: '', reps: '5' }] }],
  }], 'lb');
  eq('a multi-line note round-trips through the csv',
    csvToSessions(withNotes).sessions[0].entries[0].note, 'Stand on the band.\nKnees out');
  eq('...and does not split the row', csvToSessions(withNotes).sessions[0].entries[0].sets.length, 2);
  /* An export from before notes existed has no Note column at all. The
     importer maps columns by name, so a missing one has to be a non-event
     rather than an off-by-one down the rest of the row. */
  const oldFormat = csv.split('\r\n')
    .map((line) => line.replace(/,[^,]*$/, ''))    /* drop the last column */
    .join('\r\n');
  const oldBack = csvToSessions(oldFormat);
  eq('a csv with no note column still imports', oldBack.sessions.length, 1);
  eq('...with its sets unshifted',
    oldBack.sessions[0].entries.map((e) => `${e.name}:${e.type}:${e.sets.length}`),
    ['Barbell Bench Press:lifting:2', 'Plank:timed:1', 'Run:cardio:1']);
  eq('...and no note', oldBack.sessions[0].entries[0].note, undefined);

  const back = csvToSessions(csv);
  eq('one session comes back', back.sessions.length, 1);
  /* Regression: a comma in the name must survive, i.e. quoting works. */
  eq('a quoted name survives', back.sessions[0].name, 'Run, easy');
  eq('the day is preserved', dayKey(back.sessions[0].date), dayKey(sessions[0].date));
  eq('all three exercises return',
    back.sessions[0].entries.map((e) => `${e.name}:${e.type}:${e.sets.length}`),
    ['Barbell Bench Press:lifting:2', 'Plank:timed:1', 'Run:cardio:1']);

  /* A practice session round-trips, and — the part that matters — a cardio
     machine logged with minutes and no distance stays cardio. Both are
     "minutes, no distance" in a CSV, so shape alone cannot tell them apart;
     the importer resolves it by name. Getting this wrong would silently
     re-file every treadmill row in every CSV exported before practice
     existed. */
  const mixed = buildCsv([{
    id: 's2', name: 'Mixed', date: new Date(2026, 4, 7, 8, 0).toISOString(), durationMs: 0,
    entries: [
      { id: 'd', name: 'Vinyasa Yoga', type: 'practice', sets: [{ minutes: 75 }] },
      { id: 'e', name: 'Treadmill', type: 'cardio', sets: [{ distance: '', minutes: '30' }] },
    ],
  }], 'lb');
  eq('practice and distance-less cardio both survive',
    csvToSessions(mixed).sessions[0].entries.map((e) => `${e.name}:${e.type}`),
    ['Vinyasa Yoga:practice', 'Treadmill:cardio']);

  /* Same rows with the Type column stripped, which is what a hand-made or
     third-party file looks like. */
  const noType = mixed.split('\n').map((line, i) => {
    const cells = line.split(',');
    cells[4] = '';
    return cells.join(',');
  }).join('\n');
  eq('without a Type column the names still decide',
    csvToSessions(noType).sessions[0].entries.map((e) => `${e.name}:${e.type}`),
    ['Vinyasa Yoga:practice', 'Treadmill:cardio']);
  eq('set values survive', back.sessions[0].entries[0].sets.map((s) => `${s.weight}x${s.reps}`),
    ['185x8', '185x7']);

  /* Tolerance for a hand-made or third-party sheet. */
  const loose = csvToSessions([
    'Date,Session,Movement,Load (kg),Rep,Hold',
    '3/14/2026,Morning,Front Squat,100,5,',
    '3/14/2026,Morning,Dead Hang,,,60',
  ].join('\n'));
  eq('loose headers map', loose.sessions[0].entries.map((e) => e.name), ['Front Squat', 'Dead Hang']);
  eq('type inferred from filled columns', loose.sessions[0].entries[1].type, 'timed');
  eq('US dates parse', dayKey(loose.sessions[0].date), '2026-03-14');

  /* A wholly blank line is nothing, not a failure — it shouldn't be reported.
     A row with an exercise but no readable date is a real skip. */
  eq('blank lines are ignored silently',
    csvToSessions('Date,Exercise\n\n2026-01-01,Squat').skipped, 0);
  eq('a row with no usable date is counted',
    csvToSessions('Date,Exercise\n,Squat\n2026-01-01,Bench').skipped, 1);

  let threw = false;
  try { csvToSessions('Foo,Bar\n1,2'); } catch (e) { threw = true; }
  check('a non-Cadence csv is rejected', threw);
});

/* ------------------------------------------------------------ plan builder */

describe('plan builder', () => {
  const libNames = new Set(LIBRARY.map((e) => e.name));
  const goals = Object.keys(PLAN_GOALS);
  const kits = Object.keys(PLAN_EQUIPMENT);
  const levels = Object.keys(PLAN_LEVELS);

  const problems = [];
  let combos = 0;

  /* Every non-empty combination of what can be ticked. */
  const modalityKeys = Object.keys(PLAN_MODALITIES);
  const modalitySets = [];
  for (let mask = 1; mask < (1 << modalityKeys.length); mask++) {
    modalitySets.push(modalityKeys.filter((_, i) => mask & (1 << i)));
  }

  goals.forEach((goal) => [2, 3, 4, 5, 6, 7].forEach((days) => kits.forEach((equipment) => levels.forEach((level) => {
    modalitySets.forEach((modalities) => {
    combos++;
    const plan = buildPlan({ goal, days, equipment, level, modalities });
    const tag = `${goal}/${days}/${equipment}/${level}/${modalities.join('+')}`;

    if (!plan.routines.length) problems.push(`${tag}: no routines`);
    if (!plan.notes.length) problems.push(`${tag}: no notes`);
    if (plan.weeklyGoal !== days) problems.push(`${tag}: weeklyGoal ${plan.weeklyGoal}`);

    /* A week fills the days asked for. It may hold fewer *distinct* sessions —
       three full-body days rotated across five is deliberate without equipment
       — but it must never invent more sessions than days. */
    if (plan.routines.length > days) {
      problems.push(`${tag}: ${plan.routines.length} sessions for ${days} days`);
    }
    if (equipment !== 'bodyweight' && plan.routines.length !== days) {
      problems.push(`${tag}: ${plan.routines.length} sessions for ${days} days`);
    }

    /* Never more than five real lifting days, however the week is sliced. */
    const liftingDays = plan.routines.filter((r) => r.items.some((i) => i.type === 'lifting')).length;
    if (liftingDays > 5) problems.push(`${tag}: ${liftingDays} lifting days`);

    plan.routines.forEach((r) => {
      /* Regression: bodyweight splits collapsed to one exercise a day. A
         cardio or practice session is legitimately one thing, so the floor
         only applies where the day is built out of movement patterns. */
      const liftingDay = r.items.some((i) => i.type === 'lifting');
      if (liftingDay && r.items.length < 3) problems.push(`${tag} ${r.name}: ${r.items.length} exercises`);
      if (!r.items.length) problems.push(`${tag} ${r.name}: empty`);

      r.items.forEach((it) => {
        if (!libNames.has(it.name)) problems.push(`${tag}: "${it.name}" not in library`);
        const lib = LIBRARY.find((x) => x.name === it.name);
        if (lib && lib.type !== it.type) problems.push(`${tag}: "${it.name}" typed ${it.type}, library says ${lib.type}`);
        if (!it.sets.length) problems.push(`${tag}: "${it.name}" has no sets`);
        /* A duration-based session with no duration is not a plan. */
        if (MINUTE_TYPES.includes(it.type) && !(Number(it.sets[0].minutes) > 0)) {
          problems.push(`${tag}: "${it.name}" has no minutes`);
        }
      });

      const names = r.items.map((i) => i.name);
      if (new Set(names).size !== names.length) problems.push(`${tag} ${r.name}: duplicate exercise`);
    });

    const routineNames = plan.routines.map((r) => r.name);
    if (new Set(routineNames).size !== routineNames.length) {
      problems.push(`${tag}: duplicate routine name (${routineNames.join(',')})`);
    }
    });
  }))));

  check(`all ${combos} goal x days x kit x level x modality combinations are valid`, problems.length === 0,
    [...new Set(problems)].slice(0, 5).join(' | '));

  const typesOf = (modalities, days = 3) =>
    buildPlan({ goal: 'weightloss', days, equipment: 'gym', level: 'some', modalities })
      .routines.flatMap((r) => r.items.map((i) => i.type));

  check('lifting alone has no cardio bolted on',
    !typesOf(['strength']).includes('cardio'), typesOf(['strength']).join(','));
  check('cardio alone is cardio',
    typesOf(['cardio']).every((t) => t === 'cardio'));
  check('yoga alone is practice',
    typesOf(['practice']).every((t) => t === 'practice'));

  /* The thing the old single-choice list could not express at all. */
  const yogaAndRun = typesOf(['cardio', 'practice'], 4);
  check('cardio and yoga together gives both',
    yogaAndRun.includes('cardio') && yogaAndRun.includes('practice'), yogaAndRun.join(','));

  const allThree = buildPlan({ goal: 'general', days: 7, equipment: 'gym', level: 'some',
    modalities: ['strength', 'cardio', 'practice'] });
  const kindsIn = new Set(allThree.routines.flatMap((r) => r.items.map((i) => i.type)));
  check('a seven-day week can hold all three', kindsIn.has('lifting') && kindsIn.has('cardio') && kindsIn.has('practice'),
    [...kindsIn].join(','));
  eq('and it is seven sessions', allThree.routines.length, 7);

  /* Someone older asking to walk daily: seven cardio days, new to it. Should be
     walks of a useful length, not seven runs. */
  const dailyWalk = buildPlan({ goal: 'general', days: 7, equipment: 'bodyweight', level: 'new',
    modalities: ['cardio'] });
  const walkNames = new Set(dailyWalk.routines.flatMap((r) => r.items.map((i) => i.name)));
  check('a daily beginner cardio week walks rather than runs',
    walkNames.has('Walk') && !walkNames.has('Run'), [...walkNames].join(','));
  const walkMinutes = dailyWalk.routines.flatMap((r) => r.items.map((i) => Number(i.sets[0].minutes)));
  check('and the walks are 30 to 60 minutes',
    walkMinutes.every((m) => m >= 30 && m <= 60), walkMinutes.join(','));

  /* Seven days of lifting is not a plan, it is an injury. The surplus has to
     turn into something the body can absorb. */
  const sevenLift = buildPlan({ goal: 'strength', days: 7, equipment: 'gym', level: 'experienced',
    modalities: ['strength'] });
  eq('seven lifting days still yields seven sessions', sevenLift.routines.length, 7);
  const hardDays = sevenLift.routines.filter((r) => r.items.some((i) => i.type === 'lifting')).length;
  eq('but only five of them are lifting', hardDays, 5);
  check('and the plan says why', sevenLift.notes.some((n) => /five/i.test(n)),
    sevenLift.notes.join(' | ').slice(0, 120));

  /* Older callers pass no modalities at all — they must still build. */
  const legacy = buildPlan({ goal: 'weightloss', days: 3, equipment: 'gym', level: 'some' });
  const legacyTypes = new Set(legacy.routines.flatMap((r) => r.items.map((i) => i.type)));
  check('no answer still builds a lifting-and-cardio week',
    legacyTypes.has('lifting') && legacyTypes.has('cardio'), [...legacyTypes].join(','));

  /* And the four old style strings still map onto the new model. */
  const viaStyle = buildPlan({ goal: 'general', days: 3, equipment: 'gym', level: 'some', style: 'mindbody' });
  check('an old style string still works',
    viaStyle.routines.flatMap((r) => r.items.map((i) => i.type)).every((t) => t === 'practice'));

  /* Regression: prescribing pull-ups to someone who can't do one. */
  const newBw = buildPlan({ goal: 'general', days: 3, equipment: 'bodyweight', level: 'new' });
  const newBwNames = newBw.routines.flatMap((r) => r.items.map((i) => i.name));
  check('bodyweight beginners are not given pull-ups', !newBwNames.includes('Pull-Up'), newBwNames.join(','));

  const expBw = buildPlan({ goal: 'muscle', days: 3, equipment: 'bodyweight', level: 'experienced' });
  check('experienced bodyweight still gets pull-ups',
    expBw.routines.flatMap((r) => r.items.map((i) => i.name)).includes('Pull-Up'));

  check('bodyweight never gets a split',
    buildPlan({ goal: 'strength', days: 5, equipment: 'bodyweight', level: 'experienced' })
      .routines.every((r) => r.name.startsWith('Full Body')));

  check('beginners get fewer sets than the experienced',
    buildPlan({ goal: 'muscle', days: 3, equipment: 'gym', level: 'new' }).routines[0].items[0].sets.length
    < buildPlan({ goal: 'muscle', days: 3, equipment: 'gym', level: 'experienced' }).routines[0].items[0].sets.length);

  /* Cardio used to be appended to every lifting day; it now gets days of its
     own, so the week contains it rather than every session carrying it. */
  check('fat-loss plans include cardio',
    buildPlan({ goal: 'weightloss', days: 3, equipment: 'gym', level: 'some' })
      .routines.some((r) => r.items.some((i) => i.type === 'cardio')));

  check('the health-markers plan carries the medical note',
    buildPlan({ goal: 'metabolic', days: 3, equipment: 'gym', level: 'some' })
      .notes.some((t) => /not medical advice/i.test(t)));
});

/* ------------------------------------------------------------------ stats */

describe('stats', () => {
  const mk = (date, entries) => ({ id: uid(), name: 'W', date, durationMs: 0, entries });
  const lift = (name, sets) => ({ id: uid(), name, type: 'lifting', sets });

  const sessions = [
    mk(new Date(2026, 8, 7, 8).toISOString(), [lift('Bench', [{ weight: '200', reps: '5' }])]),
    mk(new Date(2026, 8, 1, 8).toISOString(), [lift('Bench', [{ weight: '185', reps: '8' }])]),
  ];

  eq('volume is weight x reps', sessionVolume(sessions[1]), 185 * 8);

  /* Timed and cardio work has no weight and must not enter volume maths. */
  eq('timed work adds no volume',
    sessionVolume(mk('2026-09-01T08:00:00Z', [{ id: 'x', name: 'Plank', type: 'timed', sets: [{ seconds: '60' }] }])), 0);

  eq('cardio minutes add up',
    sessionCardioMinutes(mk('2026-09-01T08:00:00Z',
      [{ id: 'x', name: 'Run', type: 'cardio', sets: [{ minutes: '28' }, { minutes: '12' }] }])), 40);

  /* Epley: 185x8 estimates higher than 200x5, which is the point of using it. */
  check('e1rm makes rep ranges comparable', e1rm(185, 8) > e1rm(200, 5),
    `${e1rm(185, 8)} vs ${e1rm(200, 5)}`);

  eq('progress series runs oldest first',
    exerciseSeries(sessions, 'Bench', 'top').map((p) => p.value), [185, 200]);

  /* Regression: an all-time axis read "Jul 1 – Sep 7" for a two-year span,
     which looks like ten weeks. Long spans name the year on the axis, and the
     tooltip keeps the day so two points in one month stay distinguishable. */
  const oneYear = exerciseSeries(sessions, 'Bench', 'top');
  check('a within-year axis keeps the day', /\d/.test(oneYear[0].label)
    && !/20\d\d/.test(oneYear[0].label), oneYear[0].label);

  const spanning = [
    mk('2026-09-01T08:00:00Z', [{ id: 'a', name: 'Bench', type: 'lifting', sets: [{ weight: '205', reps: '5' }] }]),
    mk('2024-07-01T08:00:00Z', [{ id: 'b', name: 'Bench', type: 'lifting', sets: [{ weight: '185', reps: '5' }] }]),
  ];
  const multi = exerciseSeries(spanning, 'Bench', 'top');
  check('a multi-year axis names the year',
    multi.every((p) => /20\d\d/.test(p.label)), multi.map((p) => p.label).join(' – '));
  check('the tooltip still carries the day',
    multi.every((p) => /20\d\d/.test(p.full) && /\b1\b|\b7\b/.test(p.full)),
    multi.map((p) => p.full).join(' | '));

  eq('set formatting per type', [
    formatSet('lifting', { weight: '185', reps: '8' }, 'lb'),
    formatSet('timed', { seconds: '45' }, 'lb'),
    formatSet('cardio', { distance: '3.1', minutes: '28' }, 'lb'),
    formatSet('practice', { minutes: 45 }, 'lb'),
  ], ['185lb×8', '45s', '3.1 · 28 min', '45 min']);

  /* The whole point of the hours box: a long ride should not read as "95min". */
  eq('a long session reads in hours',
    formatSet('cardio', { distance: '24', minutes: 95 }, 'lb'), '24 · 1h 35m');
  eq('cardio with no distance drops the separator',
    formatSet('cardio', { distance: '', minutes: 30 }, 'lb'), '30 min');

  eq('compact shortens big numbers', [compact(950), compact(12900), compact(2400000)],
    ['950', '12.9K', '2.4M']);

  /* Regression: a 0-1 count axis picked a 0.5 step and rendered "0, 1, 1". */
  const small = niceScale(1, 4, true);
  check('integer scales use whole steps', Number.isInteger(small.step) && small.step >= 1,
    JSON.stringify(small));

  /* Rolling average is what makes a bodyweight chart readable. */
  const weights = [
    { date: new Date(2026, 8, 1).toISOString(), value: 200 },
    { date: new Date(2026, 8, 2).toISOString(), value: 198 },
    { date: new Date(2026, 8, 3).toISOString(), value: 202 },
  ];
  const rolled = rollingAverage(weights, 7);
  eq('rolling average smooths the scale', rolled.map((r) => r.avg), [200, 199, 200]);
  eq('rolling average keeps the raw value', rolled[2].value, 202);

  const trend = weightTrend(weights, new Date(2026, 7, 1), new Date(2026, 9, 1));
  eq('trend reports the average move', trend.change, 0);
  eq('trend counts the weigh-ins', trend.count, 3);
});

/* ------------------------------------------------------ sharing a routine */

describe('sharing a routine', () => {
  const routine = { id: 'x', name: 'Push Day A', items: [
    { name: 'Barbell Bench Press', type: 'lifting',
      sets: [{ reps: 8, weight: 185 }, { reps: 8, weight: 185 }, { reps: 8, weight: 185 }] },
    { name: 'Plank', type: 'timed', sets: [{ seconds: 45 }, { seconds: 45 }] },
    { name: 'Treadmill', type: 'cardio', sets: [{ distance: 2, minutes: 20 }] },
    { name: 'Vinyasa Yoga', type: 'practice', sets: [{ minutes: 45 }] },
  ] };

  /* The share sheet's whole promise is that this text pastes straight back in.
     If this breaks, that sentence becomes a lie — and it is the only sharing
     mechanism now, so there is no fallback behind it. */
  const text = routineToText(routine, 'lb');
  const reparsed = parseWorkoutText(text).routines[0];
  eq('text round-trips through the paste parser',
    reparsed.items.map((i) => `${i.name}:${i.type}`),
    ['Barbell Bench Press:lifting', 'Plank:timed', 'Treadmill:cardio', 'Vinyasa Yoga:practice']);
  eq('with the weights intact', reparsed.items[0].sets[0], { reps: 8, weight: 185 });
  eq('the distance intact', reparsed.items[2].sets[0].distance, 2);
  eq('and the practice duration intact', reparsed.items[3].sets[0].minutes, 45);

  /* Non-ASCII names have to come through a copy-paste unharmed. */
  const accented = routineToText({ name: 'Día de Piernas', items: [
    { name: 'Sentadilla Búlgara', type: 'lifting', sets: [{ reps: 10 }] }] }, 'kg');
  check('accents survive the text form', /Sentadilla Búlgara/.test(accented), accented);

  /* Shared text lands in a chat next to whatever else was said, and a link is
     the most likely neighbour. A URL must never come back as an exercise. */
  const withLink = parseWorkoutText(`${text}\n\nGot this from https://fosterj3.github.io/Wrk_App/`);
  eq('a pasted link is skipped, not turned into an exercise',
    withLink.routines[0].items.map((i) => i.name),
    ['Barbell Bench Press', 'Plank', 'Treadmill', 'Vinyasa Yoga']);
  check('and it is reported rather than silently dropped',
    withLink.unparsed.some((l) => /fosterj3/.test(l)), withLink.unparsed.join(' | '));
  eq('a bare domain is skipped too',
    parseWorkoutText('Squat 3x5\ncadence.app').routines[0].items.map((i) => i.name), ['Barbell Back Squat']);

  /* Notes travel with the routine. Written as "- Note: ..." rather than a bare
     bullet because a bare bullet only returns as a note if it happens to read
     like a sentence — "Band only" would come back as an exercise. */
  const noted = { name: 'Band Day', items: [
    { name: 'Band Squat', type: 'lifting', sets: [{ reps: 5 }], note: 'Stand on the band.\nBand only' },
  ] };
  const notedText = routineToText(noted, 'lb');
  check('a note is written out', /Note: Band only/.test(notedText), notedText);
  eq('a note comes back attached to its exercise',
    parseWorkoutText(notedText).routines[0].items[0].note,
    'Stand on the band.\nBand only');
  eq('...and does not become an exercise of its own',
    parseWorkoutText(notedText).routines[0].items.length, 1);
});

/* ------------------------------------------------------------ the data tab */

describe('time of day', () => {
  /* The band names were the whole UI for six ranges nobody was ever shown. */
  eq('a band inside one half of the day drops the repeat',
    bandHours({ from: 5, to: 8 }), '5–8am');
  eq('a band crossing noon keeps both', bandHours({ from: 11, to: 14 }), '11am–2pm');
  eq('an afternoon band reads in pm', bandHours({ from: 14, to: 17 }), '2–5pm');
  /* 29 is 5am the next day — the night band wraps. */
  eq('the night band wraps past midnight', bandHours({ from: 20, to: 29 }), '8pm–5am');
  /* Midnight is 12am, not 12pm — so this one keeps both suffixes. */
  eq('a band ending at midnight says am', bandHours({ from: 22, to: 24 }), '10pm–12am');

  const at = (hour, entries, durationMin) => ({
    id: uid(), name: 'W', date: new Date(2026, 4, 6, hour, 30).toISOString(),
    timeSet: true, durationMs: (durationMin || 0) * 60000, entries: entries || [],
  });
  const lift = (weight, reps) => [{ id: uid(), name: 'Squat', type: 'lifting',
    sets: [{ id: uid(), weight: String(weight), reps: String(reps) }] }];

  const banded = timeOfDayBands([at(6, lift(100, 5)), at(18, lift(200, 5))]);
  eq('a 6am workout lands in Early', banded.bands[0].count, 1);
  eq('a 6pm workout lands in Evening', banded.bands[4].count, 1);
  eq('and the volume goes with it', banded.bands[4].volume, 1000);

  /* The guard is the point of the feature. Two workouts in a band is a
     coincidence, and stating it as a fact is worse than saying nothing. */
  const thin = timeOfDayBands([at(6, lift(100, 5)), at(18, lift(200, 5))]);
  check('two workouts is not enough to call it',
    bestTimeOfDay(thin.bands, 'volume').need > 0);

  /* Someone who only lifts in the evening has nothing to compare, however many
     evenings they log — so asking for another workout would be useless advice.
     That is a different answer from "not enough yet". */
  const oneBandOnly = timeOfDayBands([
    at(18, lift(100, 5)), at(18, lift(100, 5)), at(18, lift(100, 5)), at(18, lift(100, 5)),
    at(7, []), at(7, []), at(7, []),          /* cardio-less mornings: no volume */
  ]);
  const single = bestTimeOfDay(oneBandOnly.bands, 'volume');
  eq('one time of day is reported as such, not as a shortfall',
    single.need, undefined);
  eq('...and names the band it all happens in', single.only.label, 'Evening');

  eq('nothing at all to measure', bestTimeOfDay(timeOfDayBands([]).bands, 'volume').only, null);

  const enough = timeOfDayBands([
    at(6, lift(100, 5)), at(6, lift(100, 5)), at(6, lift(100, 5)),
    at(18, lift(200, 5)), at(18, lift(200, 5)), at(18, lift(200, 5)),
  ]);
  const called = bestTimeOfDay(enough.bands, 'volume');
  eq('three a side is enough', called.best.label, 'Evening');
  eq('...against the weakest band', called.worst.label, 'Early');
  eq('...with the gap as a percentage', called.pct, 100);
  eq('...and the sample it rests on', called.sample, 6);

  /* Averages, not totals: six mornings out-total two evenings whatever
     happened in them. */
  const lopsided = timeOfDayBands([
    at(6, lift(100, 5)), at(6, lift(100, 5)), at(6, lift(100, 5)), at(6, lift(100, 5)),
    at(18, lift(120, 5)), at(18, lift(120, 5)), at(18, lift(120, 5)),
  ]);
  eq('more sessions do not win on their own',
    bestTimeOfDay(lopsided.bands, 'volume').best.label, 'Evening');

  /* A couple of percent between two parts of the day is noise with a number
     attached to it. */
  const nearlyEqual = timeOfDayBands([
    at(6, lift(100, 5)), at(6, lift(100, 5)), at(6, lift(100, 5)),
    at(18, lift(102, 5)), at(18, lift(102, 5)), at(18, lift(102, 5)),
  ]);
  check('a 2% gap is reported as no difference',
    bestTimeOfDay(nearlyEqual.bands, 'volume').flat === true);

  /* Length only counts workouts that recorded one. */
  const timed = timeOfDayBands([
    at(6, [], 30), at(6, [], 30), at(6, [], 30),
    at(18, [], 90), at(18, [], 90), at(18, [], 90),
  ]);
  eq('length uses the timed ones', bestTimeOfDay(timed.bands, 'length').best.label, 'Evening');
  eq('...and says by how much', bestTimeOfDay(timed.bands, 'length').pct, 200);

  const untimed = timeOfDayBands([at(6, [], 0), at(6, [], 0), at(6, [], 0)]);
  check('workouts with no length are not counted as zero-length',
    untimed.bands[0].timed === 0 && untimed.bands[0].count === 3);

  check('counting workouts needs no verdict', bestTimeOfDay(enough.bands, 'count').need === 0);
});

describe('drawing a trend', () => {
  const pts = (...vals) => vals.map((v, i) => ({ label: `w${i}`, value: v, tip: '' }));

  /* A count has to be read against zero. Cropped to the data, one workout
     against two would draw as though training had halved off a cliff, and a
     zero week would float above the baseline as if it were something. */
  const counts = lineChart(pts(3, 4, 0, 2), (v) => `${v}`, { zeroBase: true, integer: true });
  check('a zero-based axis starts at 0', /<text[^>]*>0<\/text>/.test(counts), counts.slice(0, 200));
  check('...and has no fractional workouts', !/>\d+\.\d+</.test(counts));

  /* Strength is the opposite case, and the reason zeroBase is opt-in: 185 to
     205 against a zero axis is a flat line. */
  const strength = lineChart(pts(185, 190, 205), (v) => `${v}`);
  check('a cropped axis does not start at 0', !/<text[^>]*>0<\/text>/.test(strength));

  /* The week still running is short on days, not on effort. */
  const running = [...pts(4, 4, 1)];
  running[running.length - 1].partial = true;
  const live = lineChart(running, (v) => `${v}`, { zeroBase: true, integer: true });
  check('an unfinished bucket dashes the last segment', /viz-line-partial/.test(live));
  check('...and marks its endpoint', /viz-dot-partial/.test(live));
  check('a finished series draws solid throughout',
    !/viz-line-partial/.test(lineChart(pts(4, 4, 3), (v) => `${v}`, { zeroBase: true })));

  /* One point is not a trend; fall back rather than render an empty box. */
  eq('a single point draws no line', lineChart(pts(3), (v) => `${v}`), '');
});

describe('what a stat tile opens up to', () => {
  const sess = (dateStr, entries, durationMin) => ({
    id: uid(), name: 'W', date: new Date(dateStr).toISOString(),
    durationMs: (durationMin || 0) * 60000, entries,
  });
  const sessions = [
    sess('2026-05-06T08:00:00', [
      { id: 'a', name: 'Squat', type: 'lifting', sets: [
        { weight: '100', reps: '5' }, { weight: '100', reps: '5' }] },
      { id: 'b', name: 'Bench', type: 'lifting', sets: [{ weight: '80', reps: '5' }] },
      { id: 'c', name: 'Run', type: 'cardio', sets: [{ distance: '5', minutes: '30' }] },
    ], 60),
    sess('2026-05-08T08:00:00', [
      { id: 'd', name: 'Squat', type: 'lifting', sets: [{ weight: '120', reps: '3' }] },
      { id: 'e', name: 'Cycling', type: 'cardio', sets: [{ distance: '20', minutes: '45' }] },
    ], 0),
  ];

  /* "Volume" told you a number and nothing about where it came from. */
  const byEx = volumeByExercise(sessions);
  eq('volume splits by exercise, biggest first',
    byEx.map((r) => `${r.name}:${r.volume}`), ['Squat:1360', 'Bench:400']);
  eq('and counts the sets behind it', byEx[0].sets, 3);
  eq('cardio contributes no volume', byEx.length, 2);

  const top = heaviestSet(sessions);
  eq('the heaviest set is found', `${top.name} ${top.weight}x${top.reps}`, 'Squat 120x3');

  /* A run and a ride are not one thing called "cardio". */
  const cardio = cardioBreakdown(sessions);
  eq('cardio splits by what it was',
    cardio.kinds.map((k) => `${k.name}:${k.minutes}`), ['Cycling:45', 'Run:30']);
  eq('the days are listed, newest first', cardio.days.length, 2);
  eq('...most recent first', cardio.days[0].minutes, 45);
  eq('and the total agrees', cardio.total, 75);

  /* An imported workout carries no duration. Counting it as zero would drag
     the average down and quietly lie; it's excluded and reported instead. */
  const t = trainingTime(sessions);
  eq('only timed workouts count toward the total', t.minutes, 60);
  eq('the untimed ones are reported', t.untimed, 1);
  eq('the average is over the timed ones', t.average, 60);
  eq('the longest is named', t.longest.minutes, 60);

  eq('nothing logged is nothing claimed', trainingTime([]).minutes, 0);
  eq('...and no average', trainingTime([]).average, 0);
  eq('an empty range has no heaviest set', heaviestSet([]), null);
  eq('an empty range has no cardio', cardioBreakdown([]).kinds, []);
});

/* --------------------------------------------------- one exercise, one name */

describe('spotting the same exercise written differently', () => {
  /* Case, punctuation and a trailing plural — the ways the same exercise gets
     typed twice. Everything that makes the log useful matches on the name, so
     these are one history split in two. */
  check('case differs', sameExercise('Plank', 'plank'));
  check('a trailing plural differs', sameExercise('Plank', 'Planks'));
  check('punctuation differs', sameExercise('Pull-Up', 'Pull Up'));
  check('spacing differs', sameExercise('  Pull  Up ', 'pull up'));

  /* Deliberately narrow. These are different movements at different
     difficulty, and pairing them for a one-tap merge would combine histories
     that should stay apart. */
  check('a qualifier makes it a different exercise', !sameExercise('Forearm Plank', 'Plank'));
  check('...in either direction', !sameExercise('Plank', 'Copenhagen Plank'));
  check('unrelated names do not match', !sameExercise('Squat', 'Deadlift'));
  /* "Press" ends in a double s, so singularising must leave it alone. */
  check('a word ending in ss is not singularised', !sameExercise('Leg Press', 'Leg Pres'));
  check('two blanks are not a match', !sameExercise('', ''));
  check('a blank matches nothing', !sameExercise('', 'Plank'));

  /* The grouping keeps input order, which is how the caller knows which
     spelling to merge into: the list arrives most-used first. */
  eq('duplicates group together',
    duplicateNameGroups(['Plank', 'Squat', 'planks', 'Deadlift']), [['Plank', 'planks']]);
  eq('a name repeated exactly is not a duplicate group',
    duplicateNameGroups(['Plank', 'Plank']), []);
  eq('nothing in common is no groups',
    duplicateNameGroups(['Squat', 'Bench', 'Row']), []);
  eq('three spellings make one group',
    duplicateNameGroups(['Pull Up', 'pull-ups', 'PULLUP'])[0].length, 3);
  eq('an empty list is fine', duplicateNameGroups([]), []);
  eq('a null list is fine', duplicateNameGroups(null), []);
});

/* ------------------------------------------------------ editing an exercise */

describe('sets and reps as editable fields', () => {
  /* The editor says "4 sets of 8"; storage holds four sets. These two have to
     agree, because collapse(spread(x)) runs on every repaint — if they
     disagree the number changes while you look at it. */
  eq('one value fills every set', spreadValues('8', 3), [8, 8, 8]);
  eq('a list is taken as written', spreadValues('8/8/6', 3), [8, 8, 6]);
  eq('a short list repeats its last value', spreadValues('8/6', 4), [8, 6, 6, 6]);
  eq('a long list is truncated', spreadValues('8/8/6/6', 2), [8, 8]);
  eq('blank stays blank', spreadValues('', 2), [null, null]);
  eq('nonsense is not a zero', spreadValues('abc', 2), [null, null]);

  eq('uniform sets collapse to one number', collapseValues([8, 8, 8]), '8');
  eq('a pyramid keeps its shape', collapseValues([8, 8, 6]), '8/8/6');
  eq('nothing at all is empty', collapseValues([]), '');

  const roundTrip = (text, n) => collapseValues(spreadValues(text, n));
  eq('a single value survives the round trip', roundTrip('8', 4), '8');
  eq('a pyramid survives the round trip', roundTrip('8/8/6', 3), '8/8/6');

  /* The editor writes the target sets, so the shape has to match what the
     workout screen and the CSV already read. */
  eq('a lift builds weight and reps', buildTargetSets('lifting', 3, { reps: '8', weight: '185' }),
    [{ reps: 8, weight: 185 }, { reps: 8, weight: 185 }, { reps: 8, weight: 185 }]);
  eq('a pyramid builds per-set reps', buildTargetSets('lifting', 3, { reps: '8/8/6', weight: '185' }),
    [{ reps: 8, weight: 185 }, { reps: 8, weight: 185 }, { reps: 6, weight: 185 }]);
  eq('a hold builds seconds', buildTargetSets('timed', 2, { seconds: '60' }),
    [{ seconds: 60 }, { seconds: 60 }]);
  /* One duration for the exercise: nobody logs a yoga class as three sets. */
  eq('a class is one duration', buildTargetSets('practice', 1, { minutes: '45' }), [{ minutes: 45 }]);
  eq('cardio takes distance and duration', buildTargetSets('cardio', 1, { distance: '3.1', minutes: '28' }),
    [{ distance: 3.1, minutes: 28 }]);
  eq('a blank field is left out rather than stored as zero',
    buildTargetSets('lifting', 1, { reps: '8', weight: '' }), [{ reps: 8 }]);

  eq('at least one set, always', buildTargetSets('lifting', 0, { reps: '8' }).length, 1);
  eq('a fat-fingered set count is capped',
    buildTargetSets('lifting', 9000, { reps: '8' }).length, MAX_TARGET_SETS);

  /* Reading an exercise back out is what fills the boxes on every repaint. */
  eq('targets read back out of an exercise',
    itemTargets({ type: 'lifting', sets: [{ reps: 8, weight: 185 }, { reps: 6, weight: 185 }] }),
    { sets: 2, reps: '8/6', weight: '185', seconds: '', distance: '', minutes: '' });
  eq('an exercise with no sets still shows one',
    itemTargets({ type: 'lifting' }).sets, 1);

  /* The full loop: what the editor shows, edited, stored, and shown again. */
  const item = { name: 'Band Squat', type: 'lifting', sets: buildTargetSets('lifting', 4, { reps: '5' }) };
  eq('four sets of five, as typed', itemTargets(item),
    { sets: 4, reps: '5', weight: '', seconds: '', distance: '', minutes: '' });
});

/* Regression: setFrom() had no practice branch, so a practice line fell into
   the lifting case and came back with no duration at all — anyone pasting
   "Yoga 45 min" out of their notes silently lost the 45. */
describe('pasting a practice session', () => {
  const one = parseWorkoutText('Yoga 45 min').routines[0].items[0];
  eq('a yoga line keeps its minutes', one.sets[0], { minutes: 45 });
  eq('and is typed as practice', one.type, 'practice');

  eq('an hour reads as sixty minutes',
    parseWorkoutText('Mat Pilates 1h').routines[0].items[0].sets[0], { minutes: 60 });
});

/* ------------------------------------------------------------- noticing */

describe('what the app notices', () => {
  const at = (daysAgo, weight, name) => {
    const d = new Date(); d.setDate(d.getDate() - daysAgo);
    return { id: uid(), name: 'W', date: d.toISOString(), durationMs: 0, timeSet: true,
      entries: [{ id: uid(), name: name || 'Barbell Bench Press', type: 'lifting',
        sets: [{ id: uid(), weight: String(weight), reps: '8', done: true }] }] };
  };
  const texts = (sessions) => observations(sessions, { units: 'lb' }).map((o) => o.text).join(' | ');

  check('three sessions at the same weight is a stall',
    /sat at 185 lb for three sessions/.test(texts([at(1, 185), at(8, 185), at(15, 185)])));

  /* Two is a normal fortnight, not a plateau. Calling it one would be noise,
     and noise is what makes people stop believing the next observation. */
  check('two is not', !/three sessions/.test(texts([at(1, 185), at(8, 185)])));
  check('nor is a lift that is still going up',
    !/three sessions/.test(texts([at(1, 195), at(8, 190), at(15, 185)])));

  check('coming back after a month is noticed',
    /First session back after 4 weeks/.test(texts([at(0, 135), at(30, 185)])));
  check('but a normal weekly gap is not',
    !/back after/.test(texts([at(0, 185), at(7, 185)])));

  check('a run of weeks is noticed',
    /4 weeks in a row/.test(texts([at(1, 185), at(8, 190), at(15, 195), at(22, 200)])));

  eq('an empty log says nothing at all', observations([], { units: 'lb' }).length, 0);

  /* Ids have to be stable enough to dismiss, and specific enough that
     dismissing one doesn't silence the next. */
  const notes = observations([at(1, 185), at(8, 185), at(15, 185)], { units: 'lb' });
  check('each observation carries an id', notes.every((n) => !!n.id));
  check('ids distinguish different observations',
    new Set(notes.map((n) => n.id)).size === notes.length);
});

/* ------------------------------------------------------ what to aim for */

describe('next-set suggestion', () => {
  const sets = (...pairs) => pairs.map(([weight, reps]) => ({ weight, reps }));

  /* Finished every set at the same weight: earn the increase. */
  const up = suggestNext('lifting', sets(['185', '8'], ['185', '8'], ['185', '8']), 'Chest', 'lb');
  eq('a finished session earns a rise', [up.weight, up.reps, up.hold], ['190', '8', false]);

  /* Big lifts move in bigger steps than a lateral raise. */
  eq('legs go up by ten', suggestNext('lifting', sets(['225', '5'], ['225', '5']), 'Legs', 'lb').weight, '235');
  eq('kilos use plate-sized steps',
    suggestNext('lifting', sets(['100', '5'], ['100', '5']), 'Legs', 'kg').weight, '105');
  eq('and smaller ones for arms',
    suggestNext('lifting', sets(['30', '12'], ['30', '12']), 'Arms', 'lb').weight, '35');

  /* The part that matters most: adding weight on top of a set you did not
     finish is how people stall and decide they have stopped progressing. */
  const held = suggestNext('lifting', sets(['185', '8'], ['185', '8'], ['185', '6']), 'Chest', 'lb');
  check('a dropped rep means hold, not more weight', held.hold && held.weight === '185', JSON.stringify(held));
  const ramped = suggestNext('lifting', sets(['135', '8'], ['185', '5']), 'Chest', 'lb');
  check('uneven weights also hold', ramped.hold, JSON.stringify(ramped));

  /* Nothing to load, so progress is a rep. */
  eq('bodyweight adds a rep',
    suggestNext('lifting', sets(['', '10'], ['', '10']), 'Back', 'lb').reps, '11');
  check('bodyweight holds after a drop',
    suggestNext('lifting', sets(['', '10'], ['', '7']), 'Back', 'lb').hold);

  /* Silence is the right answer when there is nothing honest to say. */
  check('cardio gets no suggestion', suggestNext('cardio', [{ distance: '5', minutes: 30 }], 'Cardio', 'lb') === null);
  check('practice gets no suggestion', suggestNext('practice', [{ minutes: 45 }], 'Practice', 'lb') === null);
  check('a set with no reps gets none', suggestNext('lifting', sets(['185', '']), 'Chest', 'lb') === null);
  check('no history gets none', suggestNext('lifting', [], 'Chest', 'lb') === null);
  check('junk gets none', suggestNext('lifting', sets(['abc', '8']), 'Chest', 'lb') === null);
});

/* ---------------------------------------------------------- time of day */

describe('when you trained', () => {
  const at = (hour, extra) => ({
    id: uid(), name: 'W', durationMs: 0, entries: [],
    date: new Date(2026, 8, 9, hour, 15).toISOString(), ...extra,
  });

  check('a live session has a real time', hasRealTime(at(6, { timeSet: true })));
  check('a backdated one does not', !hasRealTime(at(12, { timeSet: false })));

  /* Logged before the flag existed: exactly midday was the parked default,
     anything else was a real clock reading. */
  const legacyNoon = { id: 'x', name: 'W', durationMs: 0, entries: [],
    date: new Date(2026, 8, 9, 12, 0, 0, 0).toISOString() };
  check('legacy midday is treated as unset', !hasRealTime(legacyNoon));
  const legacyEvening = { id: 'y', name: 'W', durationMs: 0, entries: [],
    date: new Date(2026, 8, 9, 18, 30).toISOString() };
  check('a legacy evening session counts', hasRealTime(legacyEvening));

  const bands = timeOfDayBands([
    at(6, { timeSet: true }), at(7, { timeSet: true }),
    at(19, { timeSet: true }),
    at(12, { timeSet: false }),
  ]);
  eq('untimed sessions are excluded, not guessed', bands.unset, 1);
  eq('the rest are counted', bands.counted, 3);
  eq('early risers land in Early', bands.bands.find((b) => b.label === 'Early').count, 2);
  eq('an evening session lands in Evening', bands.bands.find((b) => b.label === 'Evening').count, 1);

  /* 1am belongs to the night before, not to a band nobody reads. */
  const nightOwl = timeOfDayBands([at(1, { timeSet: true })]);
  eq('after midnight counts as Night', nightOwl.bands.find((b) => b.label === 'Night').count, 1);

  /* Every hour of the day has somewhere to go — an unbanded hour would vanish
     from the chart without anything saying so. */
  const covered = Array.from({ length: 24 }, (_, h) =>
    timeOfDayBands([at(h, { timeSet: true })]).bands.reduce((n, b) => n + b.count, 0));
  check('all 24 hours fall into a band', covered.every((n) => n === 1), covered.join(','));
});

/* ----------------------------------------------------------- walkthrough */

describe('walkthrough placement', () => {
  const PHONE = { width: 375, height: 812 };
  const BUBBLE = { width: 320, height: 190 };
  const rect = (left, top, width, height) => ({ left, top, width, height });

  /* Plenty of room underneath: the bubble goes below, centred on the target. */
  const under = placeBubble(rect(40, 120, 300, 48), BUBBLE, PHONE);
  eq('a target near the top gets a bubble below it', under.placement, 'below');
  check('and it is centred on the target', Math.abs(under.left + BUBBLE.width / 2 - 190) < 1,
    `left ${under.left}`);

  /* The tab bar. Nothing fits underneath, so it has to flip. */
  const tab = placeBubble(rect(300, 749, 75, 63), BUBBLE, PHONE);
  eq('a tab bar target flips the bubble above', tab.placement, 'above');
  check('the bubble stays on screen horizontally',
    tab.left >= 10 && tab.left + BUBBLE.width <= PHONE.width - 10, `left ${tab.left}`);
  check('and vertically', tab.top >= 10 && tab.top + BUBBLE.height <= PHONE.height - 10,
    `top ${tab.top}`);

  /* Regression guard: pointing at the last tab used to hang the bubble off the
     right edge, because it was centred without being clamped. */
  const lastTab = placeBubble(rect(345, 760, 30, 50), BUBBLE, PHONE);
  check('a target in the far corner does not push the bubble off screen',
    lastTab.left + BUBBLE.width <= PHONE.width - 10, `right edge ${lastTab.left + BUBBLE.width}`);

  const firstTab = placeBubble(rect(0, 760, 30, 50), BUBBLE, PHONE);
  check('nor off the left', firstTab.left >= 10, `left ${firstTab.left}`);

  /* A target taller than the screen leaves room nowhere; it still has to land
     somewhere visible rather than at a negative offset. */
  const huge = placeBubble(rect(0, 0, 375, 812), BUBBLE, PHONE);
  check('an oversized target still yields an on-screen bubble',
    huge.top >= 10 && huge.top + BUBBLE.height <= PHONE.height - 10, JSON.stringify(huge));

  /* Every real step, at a plausible position, must stay inside the phone. */
  const spots = [rect(16, 90, 343, 52), rect(16, 400, 343, 52), rect(0, 749, 75, 63),
    rect(150, 749, 75, 63), rect(300, 749, 75, 63), rect(16, 700, 343, 48)];
  const escapes = spots.filter((r) => {
    const p = placeBubble(r, BUBBLE, PHONE);
    return p.left < 0 || p.top < 0
      || p.left + BUBBLE.width > PHONE.width || p.top + BUBBLE.height > PHONE.height;
  });
  check('no plausible target puts the bubble off screen', escapes.length === 0,
    `${escapes.length} of ${spots.length} escaped`);
});

describe('walkthrough steps', () => {
  const steps = [
    { id: 'a' },
    { id: 'b', target: '.present' },
    { id: 'c', target: '.missing' },
    { id: 'd', target: '.present', view: 'routines' },
  ];
  const find = (sel) => (sel === '.present' ? {} : null);

  eq('steps with no target are always kept',
    usableSteps(steps, find).map((s) => s.id), ['a', 'b', 'd']);

  /* A step is tested on its own tab, so the finder is handed the step and can
     switch views first. Without this the tour silently lost every step whose
     target lives on another tab. */
  const seen = [];
  usableSteps(steps, (sel, step) => { seen.push(step.view || null); return {}; });
  eq('the finder is told which view each targeted step wants', seen, [null, null, 'routines']);

  /* The shipped tour: unique ids, every step says something. */
  const ids = TOUR_STEPS.map((s) => s.id);
  check('tour step ids are unique', new Set(ids).size === ids.length, ids.join(','));
  check('every step has a title and a body',
    TOUR_STEPS.every((s) => s.title && s.body));
  check('every targeted step names the tab it lives on',
    TOUR_STEPS.every((s) => !s.target || !!s.view || s.target.startsWith('.tab')),
    TOUR_STEPS.filter((s) => s.target && !s.view && !s.target.startsWith('.tab')).map((s) => s.id).join(','));
});

/* ----------------------------------------------------------------- report */

(function report() {
  const out = document.getElementById('out');
  const failed = results.filter((r) => !r.pass);
  const groups = [...new Set(results.map((r) => r.group))];

  document.getElementById('summary').innerHTML = failed.length
    ? `<span style="color:var(--danger)">${failed.length} failed</span> · ${results.length - failed.length} passed`
    : `<span style="color:var(--good)">All ${results.length} passed</span>`;

  out.innerHTML = groups.map((g) => `
    <div class="grp">
      <h2>${esc(g)}</h2>
      ${results.filter((r) => r.group === g).map((r) => `
        <div class="t ${r.pass ? 'pass' : 'fail'}">
          <span class="mark">${r.pass ? '✓' : '✕'}</span>
          <span>${esc(r.what)}${r.why ? `<span class="why">${esc(r.why)}</span>` : ''}</span>
        </div>`).join('')}
    </div>`).join('');

  /* So a headless run can read the outcome without scraping the DOM. */
  window.__testResults = { total: results.length, failed: failed.length, failures: failed };
})();
