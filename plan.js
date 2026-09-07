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

function repeated(n, target) {
  return Array.from({ length: n }, () => ({ ...target }));
}

/**
 * @param {{goal:string, days:number, equipment:string, level:string}} answers
 * @returns {{routines:Array, notes:string[], weeklyGoal:number, summary:string}}
 */
function buildPlan(answers) {
  const { goal, days, equipment, level } = answers;
  const scheme = SCHEMES[goal] || SCHEMES.general;
  const split = pickSplit(days, goal, level, equipment);

  /* One fewer set per exercise for a true beginner — early on the limit is
     recovery and technique, not effort. */
  const trim = level === 'new' ? 1 : 0;

  const routines = split.map((key) => {
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

    if (scheme.cardioMin > 0) {
      items.push({
        name: equipment === 'gym' ? 'Treadmill' : 'Walk',
        type: 'cardio',
        sets: [{ minutes: scheme.cardioMin }],
      });
    }

    return { name: day.name, items };
  });

  return {
    routines,
    weeklyGoal: days,
    summary: `${days} days a week · ${routines.length} routine${routines.length === 1 ? '' : 's'}`,
    notes: planNotes(answers, scheme, split),
  };
}

/* The part that actually answers "where do I start": why this plan, and what
   to do with it once it's in the app. */
function planNotes(answers, scheme, split) {
  const { goal, days, equipment, level } = answers;
  const notes = [];

  if (split[0].startsWith('full')) {
    notes.push(`Every session trains your whole body, so each movement gets worked ${days} times a week. That beats a body-part split at this stage — more practice per movement, and missing a day costs you less.`);
  } else {
    notes.push('The week is split so each session can go harder on less, with a few days before you repeat a movement.');
  }

  notes.push('Weights are left blank on purpose. First session, work up to a weight where the last rep is hard but still clean. After that Cadence shows what you did last time, so you always know the number to beat.');

  if (goal === 'strength') {
    notes.push('Add a little — 5 lb upper body, 10 lb lower — whenever you complete every rep of every set. Stall twice in a row and drop 10%, then build back up.');
  } else {
    notes.push('Once all sets hit the top of the rep range comfortably, add a bit of weight and let the reps drop back down.');
  }

  if (scheme.cardioMin > 0) {
    notes.push(`Cardio sits at the end of each session — ${scheme.cardioMin} minutes at a pace where you could hold a conversation but wouldn't want to sing. Lift first, cardio after.`);
  }

  if (goal === 'weightloss') {
    notes.push('Training protects the muscle you already have; what you eat drives the weight itself. Keep lifting even while the scale moves — that is what keeps the loss from being muscle.');
  }

  if (goal === 'muscle') {
    notes.push('"Toning" is muscle plus lower body fat — there is no separate toning exercise. This is the muscle half of it.');
  }

  if (goal === 'metabolic') {
    notes.push('Volume here is deliberately moderate: consistency moves these markers more than intensity does. Regular sessions over months are the mechanism.');
    notes.push('This is general exercise information, not medical advice. If you are managing diabetes, blood pressure or heart disease — especially on medication that lowers blood glucose — talk to your doctor before starting, and ask specifically about exercise timing, hypoglycemia, and any intensity limits that apply to you.');
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
