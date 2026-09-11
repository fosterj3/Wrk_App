/* Turns a goal into a real starting program.

   Deliberately not an LLM. Someone asking "where do I start" needs a correct
   answer instantly and offline, not a generated one — and the answers here are
   settled training practice, not novel advice.

   The shape is movement patterns, not exercise names: every training day is a
   list of slots (squat, hinge, horizontal push...) and the equipment you have
   decides which exercise fills each slot. That's how programs are actually
   written, and it means one template covers a full gym, a pair of dumbbells,
   or nothing at all. */

'use strict';

/* ------------------------------------------------------------------- goals */

const PLAN_GOALS = {
  weightloss: { label: 'Lose weight', blurb: 'Keep muscle while losing, plus cardio' },
  strength: { label: 'Get stronger', blurb: 'Heavier compounds, lower reps' },
  muscle: { label: 'Build muscle / tone up', blurb: 'More sets in the 8–12 range' },
  metabolic: { label: 'Health markers', blurb: 'A1C, blood pressure, metabolic health' },
  general: { label: 'General fitness', blurb: 'A bit of everything, sustainably' },
};

/**
 * What the week is actually made of.
 *
 * Separate from the goal on purpose: "lose weight" says nothing about whether
 * someone wants to be under a barbell or on a mat, and the old builder assumed
 * barbell every time. Two people with the same goal can want completely
 * different weeks.
 */
const PLAN_MODALITIES = {
  strength: { label: 'Lifting', blurb: 'Barbells, dumbbells, machines, bodyweight' },
  cardio:   { label: 'Cardio', blurb: 'Walking, running, riding, rowing' },
  practice: { label: 'Yoga or pilates', blurb: 'Flow, mat work, mobility' },
};

/* What the four old single-choice styles meant, so plans and callers written
   against them still build. "Lifting and cardio" stopped being a style of its
   own the moment you could tick both — and ticking both is the only way to ask
   for cardio *and* yoga, which the old list could not express at all. */
const LEGACY_STYLES = {
  lift: ['strength'],
  mixed: ['strength', 'cardio'],
  cardio: ['cardio'],
  mindbody: ['practice'],
};

/**
 * Five hard lifting days a week is the top of what recovers, whatever the
 * calendar says. Asking for seven does not make the sixth and seventh useful —
 * it makes them the reason the first five stop working. Days past this become
 * something the body can actually absorb.
 */
const MAX_STRENGTH_DAYS = 5;

const PLAN_EQUIPMENT = {
  gym: { label: 'A full gym', blurb: 'Barbells, machines, cables' },
  dumbbell: { label: 'Dumbbells at home', blurb: 'A pair or a set, maybe a bench' },
  bodyweight: { label: 'No equipment', blurb: 'Bodyweight only' },
};

const PLAN_LEVELS = {
  new: { label: 'New to this', blurb: 'Never trained, or not for years' },
  some: { label: 'Some experience', blurb: 'I know the basic lifts' },
  experienced: { label: 'Experienced', blurb: 'Trained consistently before' },
};

/* --------------------------------------------------- patterns -> exercises */

/* null means the pattern can't be trained with that kit, so the slot is skipped. */
const PATTERNS = {
  squat:   { main: true,  gym: 'Barbell Back Squat',     dumbbell: 'Goblet Squat',               bodyweight: 'Bodyweight Squat' },
  hinge:   { main: true,  gym: 'Romanian Deadlift',      dumbbell: 'Dumbbell Romanian Deadlift', bodyweight: 'Glute Bridge' },
  pushH:   { main: true,  gym: 'Barbell Bench Press',    dumbbell: 'Dumbbell Bench Press',       bodyweight: 'Push-Up' },
  pushV:   { main: true,  gym: 'Overhead Press',         dumbbell: 'Dumbbell Shoulder Press',    bodyweight: 'Pike Push-Up',  easier: 'Push-Up' },
  pullH:   { main: true,  gym: 'Seated Cable Row',       dumbbell: 'Dumbbell Row',               bodyweight: 'Inverted Row' },
  pullV:   { main: true,  gym: 'Lat Pulldown',           dumbbell: 'Dumbbell Row',               bodyweight: 'Pull-Up',       easier: 'Inverted Row' },
  lunge:   { main: false, gym: 'Walking Lunge',          dumbbell: 'Dumbbell Lunge',             bodyweight: 'Walking Lunge' },
  calf:    { main: false, gym: 'Calf Raise',             dumbbell: 'Calf Raise',                 bodyweight: 'Calf Raise' },
  curl:    { main: false, gym: 'Barbell Curl',           dumbbell: 'Dumbbell Curl',              bodyweight: null },
  triceps: { main: false, gym: 'Triceps Pushdown',       dumbbell: 'Skull Crusher',              bodyweight: null },
  lateral: { main: false, gym: 'Dumbbell Lateral Raise', dumbbell: 'Dumbbell Lateral Raise',     bodyweight: null },
  core:    { main: false, timed: true, gym: 'Plank',     dumbbell: 'Plank',                      bodyweight: 'Plank' },
};

const PLAN_DAYS = {
  fullA:  { name: 'Full Body A', slots: ['squat', 'pushH', 'pullH', 'core'] },
  fullB:  { name: 'Full Body B', slots: ['hinge', 'pushV', 'pullV', 'lunge'] },
  fullC:  { name: 'Full Body C', slots: ['squat', 'pushH', 'pullV', 'core'] },
  push:   { name: 'Push',    slots: ['pushH', 'pushV', 'lateral', 'triceps'] },
  pull:   { name: 'Pull',    slots: ['pullV', 'pullH', 'curl', 'core'] },
  legs:   { name: 'Legs',    slots: ['squat', 'hinge', 'lunge', 'calf'] },
  upperA: { name: 'Upper A', slots: ['pushH', 'pullV', 'pushV', 'curl'] },
  upperB: { name: 'Upper B', slots: ['pullH', 'pushH', 'lateral', 'triceps'] },
  lowerA: { name: 'Lower A', slots: ['squat', 'hinge', 'lunge', 'core'] },
  lowerB: { name: 'Lower B', slots: ['hinge', 'lunge', 'calf', 'core'] },
};

/* Beginners and fat-loss plans do better on full-body days: every pattern gets
   trained two or three times a week instead of once, and missing a day costs
   less. A split only earns its place at four days or with real experience. */
function pickSplit(days, goal, level, equipment) {
  /* With no equipment there aren't enough distinct loadable patterns to fill a
     split: a bodyweight "Push" day has no lateral raise or pushdown, and for a
     beginner both push slots regress to the same movement — leaving a
     one-exercise workout. Full-body sessions on a rotation are the right
     structure here, and three distinct ones is the useful maximum. */
  if (equipment === 'bodyweight') {
    return ['fullA', 'fullB', 'fullC'].slice(0, Math.max(2, Math.min(3, days)));
  }

  if (days <= 2) return ['fullA', 'fullB'];

  if (days === 3) {
    const wantsSplit = (goal === 'strength' || goal === 'muscle') && level === 'experienced';
    return wantsSplit ? ['push', 'pull', 'legs'] : ['fullA', 'fullB', 'fullC'];
  }

  if (days === 4) return ['upperA', 'lowerA', 'upperB', 'lowerB'];
  return ['push', 'pull', 'legs', 'upperA', 'lowerA'];
}

/* ------------------------------------------------------------------ volume */

const SCHEMES = {
  strength:   { main: { sets: 4, reps: 5 },  accessory: { sets: 3, reps: 8 },  cardioMin: 0 },
  muscle:     { main: { sets: 4, reps: 8 },  accessory: { sets: 3, reps: 12 }, cardioMin: 0 },
  weightloss: { main: { sets: 3, reps: 10 }, accessory: { sets: 3, reps: 12 }, cardioMin: 20 },
  metabolic:  { main: { sets: 2, reps: 12 }, accessory: { sets: 2, reps: 12 }, cardioMin: 25 },
  general:    { main: { sets: 3, reps: 8 },  accessory: { sets: 3, reps: 10 }, cardioMin: 12 },
};

const PLANK_SECONDS = { new: 20, some: 30, experienced: 45 };

/* ------------------------------------------------- cardio and practice days */

/* What's actually available to do the cardio on. A treadmill incline walk is
   in the gym list deliberately: it is the least punishing way to accumulate
   real effort, which is what most people starting out need. */
const CARDIO_KIT = {
  gym:        { steady: 'Treadmill', gentle: 'Incline Treadmill Walk', hard: 'Rowing Machine', long: 'Treadmill' },
  dumbbell:   { steady: 'Run',       gentle: 'Walk',                   hard: 'Jump Rope',      long: 'Cycling' },
  bodyweight: { steady: 'Run',       gentle: 'Walk',                   hard: 'Jump Rope',      long: 'Run' },
};

/**
 * Easy days are walked rather than run for anyone new to this.
 *
 * Somebody starting out and asking for six or seven sessions a week is not
 * asking to run every day — and running every day from a standing start is the
 * reliable way to be injured by week three. Walking daily is genuinely good for
 * you; running daily, untrained, is not.
 */
function easyKit(kit, level, days) {
  return (level === 'new' || days >= 5) ? kit.gentle : kit.steady;
}

/* Minutes per session, by experience. Deliberately modest at the low end —
   the failure mode for new runners is doing too much in week one. */
const CARDIO_MINUTES = {
  easy:      { new: 20, some: 30, experienced: 35 },
  intervals: { new: 15, some: 20, experienced: 25 },
  long:      { new: 30, some: 45, experienced: 60 },
};

/* A walk at the same effort simply takes longer, so the gentle days get more
   clock. It also lands a beginner's week where it should be: half an hour to
   an hour on their feet. */
const WALK_BONUS = 15;

const CARDIO_DAYS = {
  easy:      { name: 'Easy Effort', kit: 'steady', minutes: 'easy' },
  intervals: { name: 'Intervals',   kit: 'hard',   minutes: 'intervals' },
  long:      { name: 'Long Effort', kit: 'long',   minutes: 'long' },
};

const PRACTICE_MINUTES = { new: 25, some: 40, experienced: 55 };

const PRACTICE_DAYS = {
  flow:     { name: 'Flow',            exercise: 'Vinyasa Yoga' },
  gentle:   { name: 'Gentle',          exercise: 'Yin Yoga', scale: 1.1 },
  control:  { name: 'Core & Control',  exercise: 'Mat Pilates' },
  mobility: { name: 'Mobility',        exercise: 'Mobility', scale: 0.6 },
};

/**
 * One long day, and at most two hard ones however big the week gets.
 *
 * Generated rather than tabulated so it scales to a seven-day week without
 * inventing a fourth hard session. The hard days are spaced through the week
 * instead of listed together: two of them back to back is the single most
 * common way people hurt themselves early on, and the easy days are what let
 * the hard ones be hard.
 */
function cardioPattern(days) {
  if (days <= 1) return ['easy'];
  const keys = new Array(days).fill('easy');
  keys[days - 1] = 'long';
  const hard = days >= 5 ? 2 : days >= 3 ? 1 : 0;
  for (let i = 0; i < hard; i++) {
    const at = Math.round(((i + 1) * (days - 1)) / (hard + 1));
    if (keys[at] === 'easy') keys[at] = 'intervals';
  }
  return keys;
}

/* A mat practice can genuinely be daily, so this just cycles — but it cycles
   through varied work rather than repeating one thing seven times, and lands
   on the gentle day so the week winds down. */
const PRACTICE_CYCLE = ['flow', 'control', 'mobility', 'flow', 'control', 'mobility'];

function practicePattern(days) {
  if (days <= 1) return ['flow'];
  return [...PRACTICE_CYCLE.slice(0, days - 1), 'gentle'];
}

/* ------------------------------------------------------ dividing the week */

/** Whatever was ticked, falling back through the old single-choice styles. */
function planModalities(answers, scheme) {
  const picked = (Array.isArray(answers.modalities) ? answers.modalities : [])
    .filter((m) => PLAN_MODALITIES[m]);
  if (picked.length) return picked;
  if (LEGACY_STYLES[answers.style]) return LEGACY_STYLES[answers.style];
  /* Nothing said at all: what the builder did before any of this existed. */
  return scheme.cardioMin > 0 ? ['strength', 'cardio'] : ['strength'];
}

/**
 * Split the week between what was ticked, as evenly as it divides.
 *
 * Strength takes any remainder first — a third lifting day is worth more than a
 * third yoga session — but never more than it can recover from. Days it cannot
 * use go to whatever else was picked, and if lifting was the only thing on the
 * list they become easy days rather than a sixth session of the same work.
 */
function allocateDays(modalities, days) {
  const order = ['strength', 'cardio', 'practice'].filter((m) => modalities.includes(m));
  if (!order.length) return { strength: days };

  const each = Math.floor(days / order.length);
  const out = {};
  order.forEach((m) => { out[m] = each; });

  let left = days - each * order.length;
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i]] += 1;

  if (out.strength > MAX_STRENGTH_DAYS) {
    let spare = out.strength - MAX_STRENGTH_DAYS;
    out.strength = MAX_STRENGTH_DAYS;
    const others = order.filter((m) => m !== 'strength');
    if (others.length) {
      for (let i = 0; spare > 0; i = (i + 1) % others.length, spare--) out[others[i]] += 1;
    } else {
      out.recovery = spare;
    }
  }
  return out;
}

/**
 * Deal the sessions out so the same kind doesn't stack up.
 *
 * Take from whichever block has the most left, but never twice in a row while
 * something else is available — otherwise three lifting days and two runs come
 * out as two lifts, a run, a lift, a run. Spacing the hard work is most of the
 * value of a mixed week; a plan that front-loads it is just two plans stapled
 * together.
 */
function interleaveWeek(blocks) {
  const pools = blocks.filter((b) => b.items.length)
    .map((b) => ({ kind: b.kind, items: b.items.slice() }));
  const out = [];
  let last = null;

  while (pools.some((p) => p.items.length)) {
    const live = pools.filter((p) => p.items.length);
    live.sort((a, b) => b.items.length - a.items.length);
    /* Prefer the fullest block that isn't what we just used; fall back to the
       fullest when it's the only thing left. */
    const pick = live.find((p) => p.kind !== last) || live[0];
    out.push(pick.items.shift());
    last = pick.kind;
  }
  return out;
}

/* Distinct names, so "Easy Effort" twice in a week becomes A and B and the
   routines list stays navigable. */
function nameRun(names) {
  const seen = {};
  const total = names.reduce((m, n) => ({ ...m, [n]: (m[n] || 0) + 1 }), {});
  return names.map((n) => {
    if (total[n] === 1) return n;
    seen[n] = (seen[n] || 0) + 1;
    return `${n} ${String.fromCharCode(64 + seen[n])}`;
  });
}

function buildCardioWeek(days, equipment, level) {
  const kit = CARDIO_KIT[equipment] || CARDIO_KIT.bodyweight;
  const easy = easyKit(kit, level, days);
  const walking = easy === kit.gentle;

  /* A walking week has no interval day. Somebody who wants half an hour on
     their feet every day is not looking for a jump-rope session on Wednesday,
     and prescribing one is how a plan gets abandoned in week one. */
  const keys = cardioPattern(days).map((k) => (walking && k === 'intervals' ? 'easy' : k));
  const names = nameRun(keys.map((k) => CARDIO_DAYS[k].name));

  return keys.map((k, i) => {
    const day = CARDIO_DAYS[k];
    const name = k === 'easy' ? easy
      : k === 'long' ? (walking ? kit.gentle : kit.long)
      : kit.hard;
    /* A walk at the same effort simply takes longer. */
    const stretch = walking ? WALK_BONUS : 0;
    return {
      name: names[i],
      items: [{
        name,
        type: 'cardio',
        sets: [{ minutes: CARDIO_MINUTES[day.minutes][level] + stretch }],
      }],
    };
  });
}

/* Days a lifting-only week cannot use. Not padding: this is what the sixth and
   seventh day should be if someone insists on training daily. */
function buildRecoveryWeek(days, equipment) {
  const kit = CARDIO_KIT[equipment] || CARDIO_KIT.bodyweight;
  const names = nameRun(new Array(days).fill('Easy Day'));
  return names.map((name) => ({
    name,
    items: [{ name: kit.gentle, type: 'cardio', sets: [{ minutes: 30 }] }],
  }));
}

function buildPracticeWeek(days, level) {
  const keys = practicePattern(days);
  const names = nameRun(keys.map((k) => PRACTICE_DAYS[k].name));
  return keys.map((k, i) => {
    const day = PRACTICE_DAYS[k];
    return {
      name: names[i],
      items: [{
        name: day.exercise,
        type: 'practice',
        sets: [{ minutes: Math.round(PRACTICE_MINUTES[level] * (day.scale || 1) / 5) * 5 }],
      }],
    };
  });
}

function repeated(n, target) {
  return Array.from({ length: n }, () => ({ ...target }));
}

/**
 * @param {{goal:string, days:number, equipment:string, level:string}} answers
 * @returns {{routines:Array, notes:string[], weeklyGoal:number, summary:string}}
 */
function buildStrengthWeek(days, answers, scheme) {
  const { goal, equipment, level } = answers;
  /* pickSplit has a floor of two distinct days, which is right when lifting is
     the whole week and wrong when it is one day of a mixed one. Never more
     sessions than the days allotted. (It can still be fewer: three full-body
     days rotated across five is deliberate, not a shortfall.) */
  const split = pickSplit(days, goal, level, equipment).slice(0, Math.max(1, days));

  /* One fewer set per exercise for a true beginner — early on the limit is
     recovery and technique, not effort. */
  const trim = level === 'new' ? 1 : 0;

  return split.map((key) => {
    const day = PLAN_DAYS[key];
    const items = [];

    day.slots.forEach((slot) => {
      const pattern = PATTERNS[slot];
      /* Bodyweight beginners get the regression: prescribing "Pull-Up 3x10" to
         someone who can't do one isn't a plan, it's a wall. */
      const name = (equipment === 'bodyweight' && level === 'new' && pattern.easier)
        ? pattern.easier
        : pattern[equipment];
      if (!name) return;                                 /* not trainable */
      if (items.some((it) => it.name === name)) return;   /* already in this day */

      if (pattern.timed) {
        items.push({
          name,
          type: 'timed',
          sets: repeated(Math.max(2, 3 - trim), { seconds: PLANK_SECONDS[level] }),
        });
        return;
      }

      const base = pattern.main ? scheme.main : scheme.accessory;
      items.push({
        name,
        type: 'lifting',
        sets: repeated(Math.max(2, base.sets - trim), { reps: base.reps }),
      });
    });

    return { name: day.name, items };
  });
}

/**
 * @param {{goal:string, days:number, equipment:string, level:string,
 *          modalities?:string[], style?:string}} answers
 * @returns {{routines:Array, notes:string[], weeklyGoal:number, summary:string}}
 */
function buildPlan(answers) {
  const { days, equipment, level } = answers;
  const scheme = SCHEMES[answers.goal] || SCHEMES.general;
  const modalities = planModalities(answers, scheme);
  const spread = allocateDays(modalities, days);

  /* Each kind is built as its own run of sessions, then dealt out across the
     week. Separate days rather than one session with everything in it: a mixed
     week is what people actually mean by "some yoga, some lifting", and it is
     the only shape that still works at six or seven days. */
  const blocks = [
    { kind: 'strength', items: spread.strength ? buildStrengthWeek(spread.strength, answers, scheme) : [] },
    { kind: 'cardio', items: spread.cardio ? buildCardioWeek(spread.cardio, equipment, level) : [] },
    { kind: 'practice', items: spread.practice ? buildPracticeWeek(spread.practice, level) : [] },
    { kind: 'recovery', items: spread.recovery ? buildRecoveryWeek(spread.recovery, equipment) : [] },
  ];

  const routines = interleaveWeek(blocks);
  const kinds = Object.keys(spread).filter((k) => spread[k] > 0);

  return {
    routines,
    weeklyGoal: days,
    summary: `${days} days a week · ${plural(routines.length, 'session')}`,
    notes: planNotes({ ...answers, modalities }, scheme, spread, kinds),
  };
}

/* The part that actually answers "where do I start": why this plan, and what
   to do with it once it's in the app. */
function planNotes(answers, scheme, spread, kinds) {
  const { goal, days, equipment, level } = answers;
  const notes = [];
  const mixed = kinds.filter((k) => k !== 'recovery').length > 1;

  if (mixed) {
    notes.push(`The week is dealt out so the same kind of work doesn't stack up — ${plural(days, 'day')} split across what you picked, alternating rather than running in blocks. Do them in whatever order the week allows; the spacing matters more than which day is which.`);
  }

  if (spread.recovery) {
    notes.push(`Five hard lifting days is the most a body actually absorbs, so the other ${plural(spread.recovery, 'day')} ${spread.recovery === 1 ? 'is an easy one' : 'are easy ones'}. That is not padding: training daily only works if some of those days are genuinely light, and the alternative is that the first five stop working.`);
  }

  if (spread.strength) {
    notes.push('Weights are left blank on purpose. First session, work up to a weight where the last rep is hard but still clean. After that Cadence shows what you did last time, so you always know the number to beat.');
    if (goal === 'strength') {
      notes.push('Add a little — 5 lb upper body, 10 lb lower — whenever you complete every rep of every set. Stall twice in a row and drop 10%, then build back up.');
    } else {
      notes.push('Once all sets hit the top of the rep range comfortably, add a bit of weight and let the reps drop back down.');
    }
  }

  if (spread.cardio) {
    notes.push('On an easy day you should be able to hold a conversation the whole way. If you can\'t, it is not an easy day, and the next hard session will suffer for it.');
    notes.push('Add roughly ten percent a week to the long session and leave the rest alone. When it starts feeling routine, add time before you add speed.');
    if (level === 'new' || spread.cardio >= 5) {
      notes.push('The easy days are walks rather than runs on purpose. Walking daily is genuinely good for you; running daily from a standing start is the reliable way to be injured by week three. Swap them for runs once the habit is the easy part.');
    }
  }

  if (spread.practice) {
    notes.push('The durations are a starting point, not a target. A shorter session you actually do beats a longer one you keep putting off.');
    notes.push('Cadence records these as a duration, so the chart shows consistency rather than load. That is the honest measure here: with yoga and pilates, showing up regularly is the progression.');
    if (!spread.strength) {
      notes.push('Strength and bone density need resistance, which a mat practice does not really provide. One or two sessions a week with weights sits alongside this well if you ever want them — it is not a replacement for what you have chosen.');
    }
  }

  if (spread.cardio && !spread.strength && days >= 3) {
    notes.push('Two short strength sessions a week — squats, hinges, calf work — do more for staying injury-free than any amount of stretching. Worth adding once the cardio itself feels settled.');
  }

  if (goal === 'weightloss') {
    notes.push('Training protects the muscle you already have; what you eat drives the weight itself. Neither one does it alone.');
  }
  /* Stated for every metabolic plan, whatever it is made of. Someone managing
     blood glucose needs this whether their week is barbells or walking, and it
     used to only appear on the lifting path. */
  if (goal === 'metabolic') {
    notes.push('Regular movement of any kind helps metabolic markers, and consistency matters more than intensity. Sessions over months are the mechanism.');
    notes.push('This is general exercise information, not medical advice. If you are managing diabetes, blood pressure or heart disease — especially on medication that lowers blood glucose — talk to your doctor before starting, and ask specifically about exercise timing, hypoglycemia, and any intensity limits that apply to you.');
  }

  /* The lifting-specific structure notes only make sense when lifting is most
     of the week; in a mixed plan they would be describing two days out of six. */
  if (!spread.strength || mixed) return notes;

  const split = pickSplit(spread.strength, goal, level, equipment);
  if (split[0].startsWith('full')) {
    notes.push(`Every session trains your whole body, so each movement gets worked ${days} times a week. That beats a body-part split at this stage — more practice per movement, and missing a day costs you less.`);
  } else {
    notes.push('The week is split so each session can go harder on less, with a few days before you repeat a movement.');
  }

  if (goal === 'muscle') {
    notes.push('"Toning" is muscle plus lower body fat — there is no separate toning exercise. This is the muscle half of it.');
  }

  if (goal === 'metabolic') {
    notes.push('Volume here is deliberately moderate: consistency moves these markers more than intensity does. Regular sessions over months are the mechanism.');
  }

  if (level === 'new') {
    notes.push('Sets are kept low on purpose for the first few weeks. Getting the movement right and showing up matter more than volume, and you will still progress.');
  }

  if (equipment === 'bodyweight') {
    notes.push('With no equipment, progress comes from leverage and tempo rather than load. When an exercise starts feeling easy, move to a harder variation instead of just adding reps.');
    if (days > 3) {
      notes.push(`Three distinct full-body sessions is the useful maximum without equipment, so rotate through them across your ${days} days rather than inventing a fourth.`);
    }
  }

  notes.push(`Your weekly goal is set to ${days}, so Cadence will tell you mid-week if you are falling behind.`);

  return notes;
}
