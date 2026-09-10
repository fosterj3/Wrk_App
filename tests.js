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

  /* Known limitation, pinned here so it stays visible: the matcher accepts a
     name that *contains* a library name, which is what makes "Barbell Bench
     Press (heavy)" resolve — but it also swallows "Copenhagen Plank" into
     "Plank", a different exercise. The paste preview shows the resolved name
     and lets you edit it, and Settings > Exercise names can split it after the
     fact. Change this expectation if the matcher is ever tightened. */
  eq('a qualifier before a library name still matches (by design)',
    one('Barbell Bench Press heavy 3x5').items[0].name, 'Barbell Bench Press');
  eq('known over-match: Copenhagen Plank resolves to Plank',
    one('Copenhagen Plank 3x30s').items[0].name, 'Plank');

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

  const styles = Object.keys(PLAN_STYLES);

  goals.forEach((goal) => [2, 3, 4, 5].forEach((days) => kits.forEach((equipment) => levels.forEach((level) => {
    styles.forEach((style) => {
    combos++;
    const plan = buildPlan({ goal, days, equipment, level, style });
    const tag = `${goal}/${days}/${equipment}/${level}/${style}`;

    if (!plan.routines.length) problems.push(`${tag}: no routines`);
    if (!plan.notes.length) problems.push(`${tag}: no notes`);
    if (plan.weeklyGoal !== days) problems.push(`${tag}: weeklyGoal ${plan.weeklyGoal}`);

    if (plan.routines.length !== Math.min(5, Math.max(2, days)) && (style === 'cardio' || style === 'mindbody')) {
      problems.push(`${tag}: ${plan.routines.length} sessions for ${days} days`);
    }

    plan.routines.forEach((r) => {
      /* Regression: bodyweight splits collapsed to one exercise a day. A
         cardio or practice session is legitimately one thing, so the floor
         only applies where the day is built out of movement patterns. */
      const liftingDay = style === 'lift' || style === 'mixed';
      if (liftingDay && r.items.length < 3) problems.push(`${tag} ${r.name}: ${r.items.length} exercises`);
      if (!liftingDay && !r.items.length) problems.push(`${tag} ${r.name}: empty`);

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

  check(`all ${combos} goal x days x kit x level x style combinations are valid`, problems.length === 0,
    [...new Set(problems)].slice(0, 5).join(' | '));

  /* The style has to actually change the week, or the question is decoration. */
  const styleOf = (style) => buildPlan({ goal: 'weightloss', days: 3, equipment: 'gym', level: 'some', style })
    .routines.flatMap((r) => r.items.map((i) => i.type));
  check('a lifting week has no cardio bolted on', !styleOf('lift').includes('cardio'), styleOf('lift').join(','));
  check('a mixed week has both', styleOf('mixed').includes('lifting') && styleOf('mixed').includes('cardio'));
  check('a cardio week is cardio', styleOf('cardio').every((t) => t === 'cardio'), styleOf('cardio').join(','));
  check('a yoga week is practice', styleOf('mindbody').every((t) => t === 'practice'), styleOf('mindbody').join(','));

  /* Older callers pass no style at all — they must keep the previous shape. */
  const legacy = buildPlan({ goal: 'weightloss', days: 3, equipment: 'gym', level: 'some' });
  check('no style still builds the old lifting-plus-cardio week',
    legacy.routines.every((r) => r.items.some((i) => i.type === 'lifting'))
    && legacy.routines.some((r) => r.items.some((i) => i.type === 'cardio')));

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

  check('fat-loss plans include cardio',
    buildPlan({ goal: 'weightloss', days: 3, equipment: 'gym', level: 'some' })
      .routines.every((r) => r.items.some((i) => i.type === 'cardio')));

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
