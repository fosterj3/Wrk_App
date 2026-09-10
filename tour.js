/**
 * The first-run walkthrough.
 *
 * A spotlight tour rather than a wall of text: dim the app, ring one real
 * control, say what it's for, move on. Eight steps, one sentence each.
 *
 * Deliberately **not a cage**. The scrim is pointer-events:none, so every part
 * of the app stays usable while the tour is up — wander off and the bubble
 * waits. Being trapped in a tutorial is worse than not having one, and the
 * people most likely to tap something unexpected are exactly the people this
 * is for.
 *
 * Steps whose target isn't on screen are dropped before the tour starts, so a
 * changed layout degrades to a shorter tour instead of a broken one.
 */

'use strict';

/* Above the tab bar (30) and the top bar (20), below the sheet (70) so a tour
   can never bury a modal. `lift` names what has to rise above the dimming:
   .tabbar has its own stacking context from backdrop-filter, so raising a tab
   button inside it does nothing — the bar itself has to move. */
const TOUR_STEPS = [
  {
    id: 'welcome',
    center: true,
    title: 'Welcome to Cadence',
    body: 'Half a minute and you\'ll know where everything is. You can stop any time.',
  },
  {
    id: 'workout',
    target: '.tab[data-view="workout"]',
    lift: '.tabbar',
    view: 'workout',
    title: 'Workout is now',
    body: 'Whatever you\'re doing today happens on this tab — add exercises, tick sets off as you go.',
  },
  {
    id: 'start',
    target: '[data-action="start-empty"]',
    view: 'workout',
    title: 'Start here',
    body: 'Tap this to begin an empty workout, then add exercises one at a time. Nothing is saved until you finish.',
  },
  {
    id: 'routines',
    target: '.tab[data-view="routines"]',
    lift: '.tabbar',
    view: 'routines',
    title: 'Routines are the ones you repeat',
    body: 'Save "Push Day A" once and load it instead of retyping it every week.',
  },
  {
    id: 'paste',
    target: '[data-action="paste-import"]',
    view: 'routines',
    title: 'Already written it down?',
    body: 'Paste the program sitting in your notes app and Cadence reads it into routines. It shows you what it understood first.',
  },
  {
    id: 'plan',
    target: '[data-action="plan-start"]',
    view: 'routines',
    title: 'Or let it write one',
    body: 'Five questions — lifting, cardio, yoga, whatever you\'re after — and you get a real starting program.',
  },
  {
    id: 'calendar',
    target: '.tab[data-view="calendar"]',
    lift: '.tabbar',
    view: 'calendar',
    title: 'Every day you trained',
    body: 'Colour-coded by what you did. Forgot to log Tuesday? Tap Tuesday and add it — you can set the time too.',
  },
  {
    id: 'data',
    target: '.tab[data-view="data"]',
    lift: '.tabbar',
    view: 'data',
    title: 'Whether it\'s working',
    body: 'How often you show up, when of day you train, and whether the weight on the bar is actually going up.',
  },
  {
    id: 'settings',
    target: '.tab[data-view="settings"]',
    lift: '.tabbar',
    view: 'settings',
    title: 'Everything else',
    body: 'Themes, units, backups — and this walkthrough again whenever you want it.',
  },
  {
    id: 'done',
    center: true,
    title: 'That\'s the whole app',
    body: 'Start a workout, or paste in a routine you already have. Your log stays on this device.',
  },
];

const TOUR_GAP = 12;        /* between the ring and the bubble */
const TOUR_MARGIN = 10;     /* minimum distance from the viewport edge */

/**
 * Where to put the bubble relative to the thing being pointed at.
 *
 * Below when there's room, above otherwise, and horizontally centred on the
 * target but clamped inside the viewport — a bubble pointing at the last tab
 * would otherwise hang off the right edge on a phone. Pure, so the awkward
 * cases are testable without a browser.
 *
 * @param {{top:number,left:number,width:number,height:number}} rect
 * @param {{width:number,height:number}} bubble
 * @param {{width:number,height:number}} view
 */
function placeBubble(rect, bubble, view) {
  const below = rect.top + rect.height + TOUR_GAP;
  const above = rect.top - bubble.height - TOUR_GAP;

  /* Prefer below; go above only if below would run off and above actually
     fits. If neither fits, take whichever leaves more room and let the clamp
     deal with it. */
  let top;
  let placement;
  if (below + bubble.height + TOUR_MARGIN <= view.height) {
    top = below; placement = 'below';
  } else if (above >= TOUR_MARGIN) {
    top = above; placement = 'above';
  } else {
    const roomBelow = view.height - below;
    const roomAbove = rect.top;
    placement = roomBelow >= roomAbove ? 'below' : 'above';
    top = placement === 'below' ? below : above;
  }

  const maxTop = Math.max(TOUR_MARGIN, view.height - bubble.height - TOUR_MARGIN);
  top = Math.min(Math.max(TOUR_MARGIN, top), maxTop);

  let left = rect.left + rect.width / 2 - bubble.width / 2;
  const maxLeft = Math.max(TOUR_MARGIN, view.width - bubble.width - TOUR_MARGIN);
  left = Math.min(Math.max(TOUR_MARGIN, left), maxLeft);

  return { top, left, placement };
}

/**
 * Steps whose target can actually be found, plus the ones that need none.
 *
 * `find` receives the step as well as the selector, because a caller may have
 * to switch to the right tab before the target exists — testing every step
 * against whatever happens to be on screen drops the ones that live elsewhere.
 */
function usableSteps(steps, find) {
  return steps.filter((s) => !s.target || !!find(s.target, s));
}

if (typeof module !== 'undefined') {
  module.exports = { TOUR_STEPS, placeBubble, usableSteps };
}
