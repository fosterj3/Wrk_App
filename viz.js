/* Chart building for the Data tab.

   Hand-rolled inline SVG — no chart library, because the app has no build step
   and has to work offline. Everything renders from tokens defined in
   styles.css so both themes stay in step.

   The three series colours (lifting / cardio / both) were validated with the
   data-viz palette checker in both modes: lightness band, chroma floor,
   protan/deutan separation, normal-vision floor, and contrast vs the card
   surface. Don't hand-edit them — re-run the validator. */

'use strict';

/* ------------------------------------------------------------------ ranges */

/* Short windows bucket by day — two or four weekly bars would be a bar chart
   with almost nothing in it. Two weeks is the floor anywhere in this tab. */
const MIN_DAYS = 14;

const RANGES = {
  '2w':  { days: 14, label: '2 weeks' },
  '4w':  { days: 28, label: '4 weeks' },
  '12w': { weeks: 12, label: '12 weeks' },
  '26w': { weeks: 26, label: '6 months' },
  'all': { label: 'All time' },
};

function dayBuckets(start, n) {
  const buckets = [];
  for (let i = 0; i < n; i++) {
    const s = new Date(start);
    s.setDate(start.getDate() + i);
    const e = new Date(s);
    e.setDate(s.getDate() + 1);
    buckets.push({
      start: s,
      end: e,
      label: `${s.getMonth() + 1}/${s.getDate()}`,
      full: s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    });
  }
  return { mode: 'day', buckets };
}

/* The last `n` days, ending today. */
function lastDays(n) {
  const start = startOfDay(new Date());
  start.setDate(start.getDate() - (n - 1));
  return dayBuckets(start, n);
}

function weekBuckets(start, n) {
  const buckets = [];
  for (let i = 0; i < n; i++) {
    const s = new Date(start);
    s.setDate(start.getDate() + 7 * i);
    const e = new Date(s);
    e.setDate(s.getDate() + 7);
    buckets.push({
      start: s,
      end: e,
      label: `${s.getMonth() + 1}/${s.getDate()}`,
      full: `Week of ${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    });
  }
  return { mode: 'week', buckets };
}

/* Weekly buckets, except for a long "all time" span, which switches to months
   so the axis doesn't turn into 200 unreadable slivers. */
function makeBuckets(range, sessions) {
  const now = new Date();

  if (range !== 'all') {
    const spec = RANGES[range];
    if (spec.days) return lastDays(spec.days);
    const start = startOfWeek(now);
    start.setDate(start.getDate() - 7 * (spec.weeks - 1));
    return weekBuckets(start, spec.weeks);
  }

  /* "All time" for someone who started yesterday still shows two weeks, so the
     chart reads as a chart rather than a lone bar. */
  if (!sessions.length) return lastDays(MIN_DAYS);

  const first = new Date(Math.min(...sessions.map((s) => +new Date(s.date))));
  const spanDays = Math.round((startOfDay(now) - startOfDay(first)) / 86400000) + 1;
  if (spanDays <= 28) return lastDays(Math.max(MIN_DAYS, spanDays));

  const span = Math.round((startOfWeek(now) - startOfWeek(first)) / (7 * 86400000)) + 1;
  if (span <= 26) return weekBuckets(startOfWeek(first), span);

  /* Bare month names repeat once the history passes a year — "Sep, Apr, Nov,
     Jun" gives no clue which Sep. Only some labels survive thinning, so tag
     every one rather than relying on a January that may be dropped. Two digits
     keeps it inside the band. */
  const multiYear = first.getFullYear() !== now.getFullYear();
  const buckets = [];
  const cur = new Date(first.getFullYear(), first.getMonth(), 1);
  while (cur <= now) {
    const s = new Date(cur);
    const e = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const month = s.toLocaleDateString(undefined, { month: 'short' });
    buckets.push({
      start: s,
      end: e,
      label: multiYear ? `${month} '${String(s.getFullYear()).slice(2)}` : month,
      full: s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return { mode: 'month', buckets };
}

/* Parsing a session's date is the single most repeated operation in this file:
   the Data tab asks for the same range once per chart, per bucket. Keyed on the
   session object, so replacing a session naturally invalidates its entry. */
const SESSION_STAMPS = new WeakMap();

function sessionStamp(s) {
  let t = SESSION_STAMPS.get(s);
  if (t === undefined) {
    t = +new Date(s.date);
    SESSION_STAMPS.set(s, t);
  }
  return t;
}

function sessionsIn(sessions, from, to) {
  const a = +from;
  const b = +to;
  return sessions.filter((s) => {
    const t = sessionStamp(s);
    return t >= a && t < b;
  });
}

/* --------------------------------------------------------------- measures */

/* Volume only counts sets that have both a weight and reps — a bodyweight set
   logged as reps-only would otherwise silently contribute zero and drag the
   average down. */
function sessionVolume(s) {
  let total = 0;
  s.entries.forEach((e) => {
    if (e.type !== 'lifting') return;   /* timed holds have no weight to count */
    e.sets.forEach((set) => {
      const w = Number(set.weight);
      const r = Number(set.reps);
      if (set.weight !== '' && set.reps !== '' && !isNaN(w) && !isNaN(r)) total += w * r;
    });
  });
  return total;
}

/* Minutes logged against the given types. Cardio and practice are counted
   separately in the UI — an hour of yoga and an hour of intervals are not the
   same hour, and averaging them together would flatter a quiet week. */
function sessionMinutes(s, types) {
  let total = 0;
  s.entries.forEach((e) => {
    if (!types.includes(e.type)) return;
    e.sets.forEach((set) => {
      const m = Number(set.minutes);
      if (set.minutes !== '' && !isNaN(m)) total += m;
    });
  });
  return total;
}

function sessionCardioMinutes(s) { return sessionMinutes(s, ['cardio']); }
function sessionPracticeMinutes(s) { return sessionMinutes(s, ['practice']); }

/**
 * Does this session's clock time mean anything?
 *
 * New sessions carry an explicit `timeSet`. Anything logged before that flag
 * existed does not, so fall back to the tell: backdated entries were parked at
 * exactly 12:00:00.000, which a real workout essentially never hits. A handful
 * of genuine noon sessions will be misread as unset — that is the right way
 * round, since the cost is one missing bar rather than a fake lunchtime spike
 * built out of every workout anyone ever logged late.
 */
function hasRealTime(s) {
  if (typeof s.timeSet === 'boolean') return s.timeSet;
  const d = new Date(s.date);
  return !(d.getHours() === 12 && d.getMinutes() === 0
    && d.getSeconds() === 0 && d.getMilliseconds() === 0);
}

/**
 * When of day people actually train.
 *
 * Three-hour bands rather than 24 bars: nobody trains at "the 7 o'clock hour"
 * consistently enough for hourly resolution to say anything, and 24 columns in
 * 296px is a smear. Sessions whose time was never set are excluded and counted
 * separately, so the chart can say how much it is leaving out instead of
 * quietly averaging placeholder noon into the answer.
 */
const TIME_BANDS = [
  { from: 5,  to: 8,  label: 'Early' },
  { from: 8,  to: 11, label: 'Morning' },
  { from: 11, to: 14, label: 'Midday' },
  { from: 14, to: 17, label: 'Afternoon' },
  { from: 17, to: 20, label: 'Evening' },
  { from: 20, to: 29, label: 'Night' },   /* 29 wraps: 8pm through 4:59am */
];

function timeOfDayBands(sessions) {
  const bands = TIME_BANDS.map((b) => ({ ...b, count: 0, volume: 0 }));
  let unset = 0;

  sessions.forEach((s) => {
    if (!hasRealTime(s)) { unset++; return; }
    const h = new Date(s.date).getHours();
    /* Anything before 5am belongs to the previous evening's "Night". */
    const hour = h < 5 ? h + 24 : h;
    const band = bands.find((b) => hour >= b.from && hour < b.to);
    if (!band) return;
    band.count++;
    band.volume += sessionVolume(s);
  });

  return { bands, unset, counted: sessions.length - unset };
}

/* Epley. Lets a 3x5 session be compared with a 3x10 one. */
function e1rm(weight, reps) {
  return reps > 0 ? weight * (1 + reps / 30) : weight;
}

function exerciseSeries(sessions, name, metric) {
  const points = [];
  [...sessions].reverse().forEach((s) => {
    let best = 0;
    s.entries.forEach((e) => {
      if (e.type !== 'lifting' || e.name !== name) return;
      e.sets.forEach((set) => {
        const w = Number(set.weight);
        const r = Number(set.reps);
        if (set.weight === '' || isNaN(w)) return;
        const v = metric === 'e1rm' ? e1rm(w, isNaN(r) ? 0 : r) : w;
        if (v > best) best = v;
      });
    });
    if (best > 0) {
      points.push({ date: new Date(s.date), value: Math.round(best) });
    }
  });

  /* Label once the whole span is known: over a multi-year history "Jul 1" reads
     as this July, so the axis names the year instead. The tooltip always keeps
     the full date, since two points can share a month. */
  const spansYears = points.length > 1
    && crossesYears(points[0].date, points[points.length - 1].date);
  points.forEach((p) => {
    p.label = axisDate(p.date, spansYears);
    p.full = formatDate(p.date, spansYears
      ? { year: 'numeric', month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric' });
  });
  return points;
}

/* Lifting exercises worth charting, most-logged first. */
function trackableExercises(sessions) {
  const counts = new Map();
  sessions.forEach((s) => {
    const seen = new Set();
    s.entries.forEach((e) => {
      if (e.type !== 'lifting' || seen.has(e.name)) return;
      const hasWeight = e.sets.some((set) => set.weight !== '' && !isNaN(Number(set.weight)));
      if (!hasWeight) return;
      seen.add(e.name);
      counts.set(e.name, (counts.get(e.name) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

function topExercises(sessions, limit) {
  const counts = new Map();
  sessions.forEach((s) => s.entries.forEach((e) => {
    counts.set(e.name, (counts.get(e.name) || 0) + e.sets.length);
  }));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, sets]) => ({ name, sets }));
}

/* Consecutive weeks, ending with the current one, containing a workout. */
function currentStreak(sessions) {
  if (!sessions.length) return 0;
  const weeks = new Set(sessions.map((s) => +startOfWeek(new Date(s.date))));
  let streak = 0;
  const cur = startOfWeek(new Date());
  /* This week not counting yet shouldn't break a run that's still alive. */
  if (!weeks.has(+cur)) cur.setDate(cur.getDate() - 7);
  while (weeks.has(+cur)) {
    streak++;
    cur.setDate(cur.getDate() - 7);
  }
  return streak;
}

/* ------------------------------------------------------------- formatting */

/* toLocaleDateString allocates a formatter on every call, which is slow enough
   to show up when labelling hundreds of points. Reuse one per format. */
const FORMATTERS = new Map();

function formatDate(date, opts) {
  const key = JSON.stringify(opts);
  if (!FORMATTERS.has(key)) FORMATTERS.set(key, new Intl.DateTimeFormat(undefined, opts));
  return FORMATTERS.get(key).format(date instanceof Date ? date : new Date(date));
}

/**
 * An axis endpoint. Adds the year when the range crosses one — otherwise a
 * two-year span reads as "Jul 1 – Sep 7", which looks like two months.
 */
function axisDate(date, spansYears) {
  return formatDate(date, spansYears
    ? { month: 'short', year: 'numeric' }
    : { month: 'short', day: 'numeric' });
}

function crossesYears(a, b) {
  return new Date(a).getFullYear() !== new Date(b).getFullYear();
}

function compact(n) {
  const v = Math.round(n);
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return v.toLocaleString();
}

/* `integer` forces a whole-number step. Without it a 0..1 workout count picks a
   0.5 step and the axis renders as "0, 1, 1" once the labels are rounded. */
function niceScale(max, ticks, integer) {
  if (!(max > 0)) return { max: 1, step: 1 };
  const raw = max / (ticks || 4);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  if (integer) step = Math.max(1, Math.round(step));
  return { max: Math.ceil(max / step) * step, step };
}

/* --------------------------------------------------------------- geometry */

const W = 340;
const H = 190;
const PAD = { top: 14, right: 8, bottom: 26, left: 36 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const MAX_BAR = 24;          /* mark spec: bars never fill their band */

/* Square at the baseline, 4px rounded at the data end. */
function colPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x} ${y + h} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y}`
    + ` L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} Z`;
}

function rowPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h / 2, w));
  return `M${x} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr}`
    + ` L${x + w} ${y + h - rr} Q${x + w} ${y + h} ${x + w - rr} ${y + h} L${x} ${y + h} Z`;
}

/* Ticks are derived from the scale's own step, so every label is a value the
   step can actually land on. */
function gridAndAxis(scale, fmt) {
  const ticks = Math.max(1, Math.round(scale.max / scale.step));
  let out = '';
  for (let i = 0; i <= ticks; i++) {
    const v = scale.step * i;
    const y = PAD.top + PLOT_H - (v / scale.max) * PLOT_H;
    out += `<line class="viz-grid" x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}"/>`;
    out += `<text class="viz-tick" x="${PAD.left - 6}" y="${y + 3.5}" text-anchor="end">${fmt(v)}</text>`;
  }
  return out;
}

/* Thin x labels so they never collide — the mark spec forbids clipping. */
function xLabels(items, bandW, keepEvery) {
  return items.map((d, i) => (i % keepEvery === 0
    ? `<text class="viz-tick" x="${PAD.left + bandW * (i + 0.5)}" y="${H - 9}" text-anchor="middle">${esc(d.label)}</text>`
    : '')).join('');
}

/* ------------------------------------------------------------ chart types */

/**
 * Column chart, one series. `data`: [{label, value, tip, partial}]
 * Partial buckets (the week still in progress) are de-emphasised rather than
 * dropped, so a half-finished week can't read as a collapse in training.
 */
function columnChart(data, opts) {
  if (!data.length) return '';
  const { integer, labelEvery } = opts || {};
  const scale = niceScale(Math.max(...data.map((d) => d.value)), 4, integer);
  const bandW = PLOT_W / data.length;
  const barW = Math.min(MAX_BAR, Math.max(3, bandW - 6));

  const bars = data.map((d, i) => {
    const h = (d.value / scale.max) * PLOT_H;
    const x = PAD.left + bandW * i + (bandW - barW) / 2;
    const y = PAD.top + PLOT_H - h;
    const cls = d.partial ? 'viz-bar viz-bar-dim' : 'viz-bar';
    return `
      <path class="${cls}" d="${colPath(x, y, barW, Math.max(h, d.value > 0 ? 2 : 0), 4)}"/>
      <rect class="viz-hit" x="${PAD.left + bandW * i}" y="${PAD.top}" width="${bandW}" height="${PLOT_H}"
            data-tip="${esc(d.tip)}"/>`;
  }).join('');

  return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(data.length)} bars">
    ${gridAndAxis(scale, (v) => compact(v))}
    ${bars}
    ${xLabels(data, bandW, labelEvery || Math.ceil(data.length / 6))}
  </svg>`;
}

/**
 * Line chart, one series — so no legend; the card title names it.
 * Endpoint carries the only direct label.
 */
function lineChart(points, fmtValue) {
  if (points.length < 2) return '';
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  /* Don't zero-base: progress of 185 -> 205 would be invisible against 0. */
  const pad = (hi - lo) * 0.25 || Math.max(hi * 0.1, 1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const span = max - min || 1;

  const px = (i) => PAD.left + (PLOT_W / (points.length - 1)) * i;
  const py = (v) => PAD.top + PLOT_H - ((v - min) / span) * PLOT_H;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${px(points.length - 1).toFixed(1)} ${PAD.top + PLOT_H} L${px(0).toFixed(1)} ${PAD.top + PLOT_H} Z`;

  const last = points[points.length - 1];
  const lastX = px(points.length - 1);
  const lastY = py(last.value);
  const labelRight = lastX > W - 46;

  const dots = points.map((p, i) => `
    <circle class="viz-hit-dot" cx="${px(i)}" cy="${py(p.value)}" r="12" data-tip="${esc(p.tip)}"/>`).join('');

  let gridY = '';
  for (let i = 0; i <= 3; i++) {
    const v = min + (span / 3) * i;
    const y = py(v);
    gridY += `<line class="viz-grid" x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}"/>`
      + `<text class="viz-tick" x="${PAD.left - 6}" y="${y + 3.5}" text-anchor="end">${compact(v)}</text>`;
  }

  /* The last point always gets a label — it's the number people actually came
     to see — so an evenly spaced label can land right on top of it when the
     series length isn't a neat multiple. Keep the two ends and drop any middle
     label that can't clear them, instead of letting them collide. The gap is a
     fraction of the plot rather than a pixel guess, so it holds regardless of
     which font is rendering. */
  const lastI = points.length - 1;
  const every = Math.ceil(points.length / 5);
  const MIN_GAP = PLOT_W / 6;
  const keep = [0];
  for (let i = every; i < lastI; i += every) {
    if (px(i) - px(keep[keep.length - 1]) >= MIN_GAP && px(lastI) - px(i) >= MIN_GAP) keep.push(i);
  }
  if (lastI > 0) keep.push(lastI);

  const shownLabels = new Set(keep);
  const xt = points.map((p, i) => (shownLabels.has(i)
    ? `<text class="viz-tick" x="${px(i)}" y="${H - 9}" text-anchor="${i === 0 ? 'start' : (i === lastI ? 'end' : 'middle')}">${esc(p.label)}</text>`
    : '')).join('');

  return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress over time">
    ${gridY}
    <path class="viz-area" d="${area}"/>
    <path class="viz-line" d="${line}"/>
    <circle class="viz-dot" cx="${lastX}" cy="${lastY}" r="4.5"/>
    <text class="viz-endlabel" x="${labelRight ? lastX - 8 : lastX + 8}" y="${lastY - 8}"
          text-anchor="${labelRight ? 'end' : 'start'}">${esc(fmtValue(last.value))}</text>
    ${dots}
    ${xt}
  </svg>`;
}

/** Horizontal bars — long exercise names need the room. */
function barRows(items, fmtValue) {
  if (!items.length) return '';
  const rowH = 30;
  const h = items.length * rowH + 8;
  const labelW = 128;
  const trackW = W - labelW - 44;
  const scale = Math.max(...items.map((i) => i.value)) || 1;

  const rows = items.map((it, i) => {
    const y = i * rowH + 4;
    const w = Math.max((it.value / scale) * trackW, 2);
    return `
      <text class="viz-rowlabel" x="0" y="${y + 19}">${esc(it.label)}</text>
      <path class="viz-bar" d="${rowPath(labelW, y + 7, w, 16, 4)}"/>
      <text class="viz-rowvalue" x="${labelW + w + 6}" y="${y + 19}">${esc(fmtValue(it.value))}</text>
      <rect class="viz-hit" x="0" y="${y}" width="${W}" height="${rowH}" data-tip="${esc(it.tip)}"/>`;
  }).join('');

  return `<svg class="viz" viewBox="0 0 ${W} ${h}" role="img" aria-label="Ranked bars">${rows}</svg>`;
}

/**
 * One stacked bar, part-to-whole. Segments are separated by a 2px gap in the
 * surface colour rather than a stroke, per the mark spec.
 */
function stackedBar(segments) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  if (!total) return '';
  const gap = 2;
  const live = segments.filter((s) => s.value > 0);
  const usable = W - gap * (live.length - 1);

  let x = 0;
  const parts = live.map((s, i) => {
    const w = (s.value / total) * usable;
    const first = i === 0;
    const last = i === live.length - 1;
    const r = 4;
    const path = (first || last)
      ? roundedEnds(x, 0, w, 26, r, first, last)
      : `M${x} 0 h${w} v26 h${-w} Z`;
    /* No label inside the segment: an interior segment has no free end to put
       one on, and the legend below already carries the exact counts. */
    const seg = `<path class="viz-seg k-${s.key}" d="${path}" data-tip="${esc(s.tip)}"/>`;
    x += w + gap;
    return seg;
  }).join('');

  return `<svg class="viz" viewBox="0 0 ${W} 26" role="img" aria-label="Training split">${parts}</svg>`;
}

function roundedEnds(x, y, w, h, r, roundLeft, roundRight) {
  const rl = roundLeft ? Math.min(r, w / 2) : 0;
  const rr = roundRight ? Math.min(r, w / 2) : 0;
  return `M${x + rl} ${y}`
    + ` L${x + w - rr} ${y}`
    + (rr ? ` Q${x + w} ${y} ${x + w} ${y + rr}` : '')
    + ` L${x + w} ${y + h - rr}`
    + (rr ? ` Q${x + w} ${y + h} ${x + w - rr} ${y + h}` : '')
    + ` L${x + rl} ${y + h}`
    + (rl ? ` Q${x} ${y + h} ${x} ${y + h - rl}` : '')
    + ` L${x} ${y + rl}`
    + (rl ? ` Q${x} ${y} ${x + rl} ${y}` : '')
    + ' Z';
}

/* ------------------------------------------------- history lookups */

/* Most recent finished session containing this exercise. The active workout is
   never in state.sessions, so this can't return the set you're typing into. */
function lastPerformance(sessions, name) {
  const list = [...sessions].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  for (const s of list) {
    const entry = s.entries.find((e) => e.name === name);
    if (entry && entry.sets.length) {
      return { date: new Date(s.date), type: entry.type, sets: entry.sets };
    }
  }
  return null;
}

/* The one place a set turns into text. Used by the calendar, the routine list,
   and the "last time" line, so they can't drift apart. */
function formatSet(type, set, units) {
  /* A long ride reads as "1h 45m", not "105min" — the same reason the input
     grew an hours box. */
  if (type === 'cardio') {
    const dist = set.distance ? `${set.distance} · ` : '';
    return `${dist}${formatMinutes(set.minutes)}`;
  }
  if (type === 'practice') return formatMinutes(set.minutes);
  if (type === 'timed') return `${set.seconds || '—'}s`;
  return `${set.weight || '—'}${units}×${set.reps || '—'}`;
}

function summarizeSets(perf, units) {
  return perf.sets.map((s) => formatSet(perf.type, s, units)).join(', ');
}

/* Best estimated 1RM ever recorded for an exercise. */
function bestE1rm(sessions, name) {
  let best = 0;
  sessions.forEach((s) => s.entries.forEach((e) => {
    if (e.type !== 'lifting' || e.name !== name) return;
    e.sets.forEach((set) => {
      const w = Number(set.weight);
      const r = Number(set.reps);
      if (set.weight === '' || isNaN(w)) return;
      const v = e1rm(w, isNaN(r) ? 0 : r);
      if (v > best) best = v;
    });
  }));
  return best;
}

/* ------------------------------------------------------ weekly goal */

function weekProgress(sessions, goal) {
  const start = startOfWeek(new Date());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const done = sessionsIn(sessions, start, end).length;
  const daysLeft = Math.max(0, Math.ceil((+end - Date.now()) / 86400000));
  const remaining = Math.max(0, goal - done);
  return {
    done,
    goal,
    remaining,
    daysLeft,
    /* Behind enough that every remaining day has to be a training day. */
    atRisk: remaining > 0 && remaining >= daysLeft,
  };
}

function progressRing(done, goal) {
  const size = 84;
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(1, done / goal) : 0;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" role="img"
      aria-label="${done} of ${goal} workouts done this week">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}"/>
    <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}"
            stroke-dasharray="${(c * pct).toFixed(1)} ${(c + 1).toFixed(1)}"
            transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text class="ring-num" x="${size / 2}" y="${size / 2 + 3}" text-anchor="middle">${done}</text>
    <text class="ring-den" x="${size / 2}" y="${size / 2 + 19}" text-anchor="middle">of ${goal}</text>
  </svg>`;
}

/* -------------------------------------------------- plate calculator */

const PLATES = {
  lb: [45, 35, 25, 10, 5, 2.5],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
};

/* What goes on ONE side of the bar. */
function plateBreakdown(target, bar, units) {
  const plates = PLATES[units] || PLATES.lb;
  if (!(target > 0) || !(bar >= 0)) return { ok: false, reason: 'empty' };
  if (target < bar) return { ok: false, reason: 'under-bar' };

  let side = (target - bar) / 2;
  const out = [];
  plates.forEach((p) => {
    const n = Math.floor(side / p + 1e-9);
    if (n > 0) {
      out.push({ plate: p, count: n });
      side -= n * p;
    }
  });
  return { ok: true, perSide: out, leftover: Math.round(side * 100) / 100 };
}

/* ------------------------------------------------------ share card */

/* Renders the week as a square PNG for the share sheet. Canvas can't read CSS
   custom properties, so the live token values are pulled off :root first —
   that keeps the card in step with whichever theme is active. */
function buildRecapCanvas(sessions, units) {
  const css = getComputedStyle(document.documentElement);
  const tok = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;

  const bg = tok('--bg', '#08060c');
  const card = tok('--surface', '#130f1c');
  const ink = tok('--text', '#ffffff');
  const muted = tok('--muted', '#a99ec4');
  const lift = tok('--series-lift', '#8b5cf6');
  const cardioCol = tok('--series-cardio', '#c98500');
  const mixed = tok('--series-mixed', '#199e70');
  const practiceCol = tok('--series-practice', '#64B4AE');
  const line = tok('--line', '#312748');

  const S = 1080;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const sans = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);

  const start = startOfWeek(new Date());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const week = sessionsIn(sessions, start, end);
  const volume = week.reduce((n, s) => n + sessionVolume(s), 0);
  const minutes = week.reduce((n, s) => n + sessionCardioMinutes(s), 0);

  g.fillStyle = muted;
  g.font = `600 34px ${sans}`;
  g.fillText('CADENCE', 90, 130);
  g.font = `400 34px ${sans}`;
  g.fillText(`Week of ${start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`, 90, 186);

  g.fillStyle = ink;
  g.font = `700 260px ${sans}`;
  g.fillText(String(week.length), 84, 430);
  g.fillStyle = muted;
  g.font = `500 44px ${sans}`;
  g.fillText(week.length === 1 ? 'workout' : 'workouts', 90, 500);

  /* One dot per day, coloured the way the calendar colours it. */
  const byDay = new Map();
  week.forEach((s) => {
    const k = dayKey(s.date);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  });

  const dotY = 620;
  const gap = 128;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const list = byDay.get(dayKey(d)) || [];
    const cx = 108 + i * gap;
    /* Combine across the day: a morning lift plus an evening run is "both". */
    const kinds = new Set(list.map(sessionKind));
    const kind = !list.length ? null
      : kinds.size > 1 || kinds.has('mixed') ? 'mixed'
      : [...kinds][0];

    g.beginPath();
    g.arc(cx, dotY, 40, 0, Math.PI * 2);
    g.fillStyle = kind === 'cardio' ? cardioCol
      : kind === 'practice' ? practiceCol
      : kind === 'mixed' ? mixed
      : kind ? lift : card;
    g.fill();
    if (!kind) {
      g.strokeStyle = line;
      g.lineWidth = 3;
      g.stroke();
    }

    g.fillStyle = muted;
    g.font = `500 26px ${sans}`;
    g.textAlign = 'center';
    g.fillText('SMTWTFS'[i], cx, dotY + 92);
    g.textAlign = 'left';
  }

  /* Two supporting figures, only when there's something to say. */
  const stats = [];
  if (volume > 0) stats.push([compact(volume), `${units} lifted`]);
  if (minutes > 0) stats.push([compact(minutes), 'min cardio']);

  stats.forEach((s, i) => {
    const x = 90 + i * 480;
    g.fillStyle = ink;
    g.font = `700 82px ${sans}`;
    g.fillText(s[0], x, 850);
    g.fillStyle = muted;
    g.font = `400 34px ${sans}`;
    g.fillText(s[1], x, 900);
  });

  g.fillStyle = muted;
  g.font = `400 28px ${sans}`;
  g.fillText('fosterj3.github.io/Wrk_App', 90, 1000);

  return cv;
}

/* ------------------------------------------------------- csv export */

/* One row per set — the shape a spreadsheet or a coach can actually read.
   A JSON backup is for restoring; this is for looking at. */
function buildCsv(sessions, units) {
  const head = [
    'Date', 'Time', 'Workout', 'Exercise', 'Type', 'Set',
    `Weight (${units})`, 'Reps', 'Distance', 'Minutes', 'Seconds',
  ];

  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = [head.join(',')];

  [...sessions]
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))   /* oldest first reads better */
    .forEach((s) => {
      const d = new Date(s.date);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

      s.entries.forEach((e) => {
        e.sets.forEach((set, i) => {
          rows.push([
            date, time, s.name, e.name, e.type, i + 1,
            set.weight ?? '', set.reps ?? '',
            set.distance ?? '', set.minutes ?? '', set.seconds ?? '',
          ].map(cell).join(','));
        });
      });
    });

  /* Leading BOM so Excel opens it as UTF-8 rather than mangling any accents. */
  return `\ufeff${rows.join('\r\n')}\r\n`;
}

/* ------------------------------------------------------- csv import */

/* A real CSV reader: fields can be quoted, and a quoted field can contain
   commas, newlines and escaped quotes. Splitting on ',' would corrupt a
   workout called "Run, easy". */
function parseCsvRows(text) {
  const s = String(text).replace(/^\ufeff/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') { field += c; continue; }
      if (s[i + 1] === '"') { field += '"'; i++; continue; }   /* "" is one quote */
      quoted = false;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/* Header names we recognise. Tolerant so a hand-edited or foreign CSV still
   lands: "Weight (lb)" and "weight" are the same column. */
const CSV_COLUMNS = {
  date: 'date',
  time: 'time',
  workout: 'workout', session: 'workout',
  exercise: 'exercise', name: 'exercise', movement: 'exercise',
  type: 'type',
  set: 'set',
  weight: 'weight', load: 'weight', kg: 'weight', lb: 'weight', lbs: 'weight',
  reps: 'reps', rep: 'reps',
  distance: 'distance', dist: 'distance',
  minutes: 'minutes', min: 'minutes', mins: 'minutes', duration: 'minutes',
  seconds: 'seconds', sec: 'seconds', secs: 'seconds', hold: 'seconds',
};

function csvColumn(header) {
  const clean = String(header)
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')      /* drop the unit in "Weight (lb)" */
    .replace(/[^a-z]+/g, ' ')
    .trim();
  return CSV_COLUMNS[clean] || null;
}

/* Accepts YYYY-MM-DD and M/D/YYYY (US order), else lets Date try. Built in
   local time so a session can't drift into the neighbouring day. */
function csvDateToIso(date, time) {
  let y;
  let m;
  let d;

  let hit = String(date).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (hit) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }

  if (!hit) {
    hit = String(date).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (hit) { m = +hit[1]; d = +hit[2]; y = +hit[3]; }
  }

  if (!hit) {
    const loose = new Date(date);
    if (isNaN(+loose)) return null;
    y = loose.getFullYear(); m = loose.getMonth() + 1; d = loose.getDate();
  }

  const t = String(time || '').match(/^(\d{1,2}):(\d{2})/);
  const dt = new Date(y, m - 1, d, t ? +t[1] : 12, t ? +t[2] : 0, 0, 0);
  return isNaN(+dt) ? null : dt.toISOString();
}

/**
 * Turn exported-CSV text back into sessions.
 * @returns {{sessions: Array, skipped: number, rows: number}}
 * @throws if the file has no usable Exercise column.
 */
function csvToSessions(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('there are no rows in that file');

  const mapped = rows[0].map(csvColumn);
  if (!mapped.includes('exercise')) {
    throw new Error('no "Exercise" column — is this a Cadence CSV?');
  }

  const at = {};
  mapped.forEach((key, i) => { if (key && at[key] === undefined) at[key] = i; });
  const cell = (r, key) => (at[key] === undefined ? '' : String(r[at[key]] ?? '').trim());

  const byKey = new Map();
  let skipped = 0;

  rows.slice(1).forEach((r) => {
    const exercise = cell(r, 'exercise');
    const iso = csvDateToIso(cell(r, 'date'), cell(r, 'time'));
    if (!exercise || !iso) { skipped++; return; }

    const workout = cell(r, 'workout') || 'Imported workout';
    const key = `${iso}|${workout}`;
    if (!byKey.has(key)) {
      byKey.set(key, { id: uid(), name: workout, date: iso, durationMs: 0, entries: [] });
    }
    const session = byKey.get(key);

    const seconds = cell(r, 'seconds');
    const distance = cell(r, 'distance');
    const minutes = cell(r, 'minutes');
    const declared = cell(r, 'type').toLowerCase();

    /* Trust a Type column first, then the exercise's own name, and only then
       guess from which numbers are filled in.
     *
     * The name lookup matters: "Yoga, 45 minutes" and "Treadmill, 30 minutes"
     * are shaped identically in a CSV — minutes and no distance — so column
     * shape alone cannot tell a practice from a cardio machine. Guessing
     * 'practice' from bare minutes would quietly re-file every treadmill row
     * in every CSV exported before this existed. */
    const known = matchLibraryExact(exercise);
    const type = EXERCISE_TYPES.includes(declared) ? declared
      : known ? known.type
      : seconds ? 'timed'
      : (distance || minutes) ? 'cardio'
      : 'lifting';

    let entry = session.entries.find((e) => e.name === exercise && e.type === type);
    if (!entry) {
      entry = { id: uid(), name: exercise, type, sets: [] };
      session.entries.push(entry);
    }

    const set = { id: uid(), done: true };   /* it already happened */
    if (type === 'cardio') {
      set.distance = distance;
      set.minutes = minutes;
    } else if (type === 'practice') {
      set.minutes = minutes;
    } else if (type === 'timed') {
      set.seconds = seconds;
    } else {
      set.weight = cell(r, 'weight');
      set.reps = cell(r, 'reps');
    }
    entry.sets.push(set);
  });

  const sessions = [...byKey.values()]
    .filter((s) => s.entries.length)
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));

  return { sessions, skipped, rows: rows.length - 1 };
}

/* Same key the export writes, to the minute — used to spot re-imports. */
function sessionKeyOf(s) {
  return `${new Date(s.date).toISOString().slice(0, 16)}|${s.name}`;
}

/* --------------------------------------------------- bodyweight */

/* Daily scale readings swing a few pounds on water alone, so the raw dots are
   context and the rolling average is the actual signal. */
function rollingAverage(entries, windowDays) {
  const span = windowDays * 86400000;

  /* Parse each date once. The obvious version — filter the whole array for
     every point — is O(n²) with a date parse in the inner loop, which cost
     340ms on a few hundred weigh-ins and froze the Data tab. */
  const rows = entries
    .map((e) => ({ date: e.date, value: e.value, t: +new Date(e.date), n: Number(e.value) }))
    .sort((a, b) => a.t - b.t);

  const out = [];
  let start = 0;
  let sum = 0;

  for (let i = 0; i < rows.length; i++) {
    sum += rows[i].n;
    /* Drop anything that has fallen out of the trailing window. */
    while (rows[start].t <= rows[i].t - span) {
      sum -= rows[start].n;
      start++;
    }
    const count = i - start + 1;
    out.push({
      date: rows[i].date,
      value: rows[i].value,
      avg: Math.round((sum / count) * 10) / 10,
    });
  }

  return out;
}

/**
 * Weight over time: faint dots for each weigh-in, an accent line for the
 * 7-day average. Not zero-based — a 6 lb move inside a 180 lb range is the
 * whole story and would be invisible against zero.
 */
function weightChart(entries, unit) {
  const rows = rollingAverage(entries, 7);
  if (rows.length < 2) return '';

  const values = rows.flatMap((r) => [Number(r.value), r.avg]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.25 || 2;
  const min = lo - pad;
  const max = hi + pad;
  const span = max - min || 1;

  const first = +new Date(rows[0].date);
  const last = +new Date(rows[rows.length - 1].date);
  const range = last - first || 1;

  const px = (d) => PAD.left + ((+new Date(d) - first) / range) * PLOT_W;
  const py = (v) => PAD.top + PLOT_H - ((v - min) / span) * PLOT_H;

  let grid = '';
  for (let i = 0; i <= 3; i++) {
    const v = min + (span / 3) * i;
    const y = py(v);
    grid += `<line class="viz-grid" x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}"/>`
      + `<text class="viz-tick" x="${PAD.left - 6}" y="${y + 3.5}" text-anchor="end">${v.toFixed(0)}</text>`;
  }

  /* The plot is ~296px wide, so past a couple of hundred weigh-ins the raw dots
     land on top of each other and the hit targets overlap into uselessness —
     while still costing a formatted date each. Thin them to what can actually
     be seen and touched. The average line keeps every point. */
  const step = Math.max(1, Math.ceil(rows.length / 120));
  const shown = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);

  const dots = shown.map((r) => `
    <circle class="viz-raw-dot" cx="${px(r.date).toFixed(1)}" cy="${py(Number(r.value)).toFixed(1)}" r="2.5"/>`).join('');

  const line = rows.map((r, i) => `${i ? 'L' : 'M'}${px(r.date).toFixed(1)} ${py(r.avg).toFixed(1)}`).join(' ');

  const endRow = rows[rows.length - 1];
  const endX = px(endRow.date);
  const endY = py(endRow.avg);

  const spansYears = crossesYears(rows[0].date, rows[rows.length - 1].date);
  const tipDate = (d) => formatDate(d, spansYears
    ? { year: 'numeric', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric' });

  const hits = shown.map((r) => `
    <circle class="viz-hit-dot" cx="${px(r.date).toFixed(1)}" cy="${py(Number(r.value)).toFixed(1)}" r="11"
            data-tip="${esc(tipDate(r.date))}\n${esc(r.value)} ${esc(unit)}\n7-day avg ${esc(r.avg)}"/>`).join('');

  const label = (d) => axisDate(d, spansYears);

  return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bodyweight over time">
    ${grid}
    <path class="viz-line" d="${line}"/>
    ${dots}
    <circle class="viz-dot" cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4.5"/>
    <text class="viz-endlabel" x="${endX > W - 52 ? endX - 8 : endX + 8}" y="${endY - 8}"
          text-anchor="${endX > W - 52 ? 'end' : 'start'}">${endRow.avg}</text>
    ${hits}
    <text class="viz-tick" x="${PAD.left}" y="${H - 9}" text-anchor="start">${esc(label(rows[0].date))}</text>
    <text class="viz-tick" x="${W - PAD.right}" y="${H - 9}" text-anchor="end">${esc(label(endRow.date))}</text>
  </svg>`;
}

/* Trend over the window: what the average moved, not what the scale said. */
function weightTrend(entries, from, to) {
  const inRange = entries.filter((e) => {
    const t = +new Date(e.date);
    return t >= +from && t < +to;
  });
  if (inRange.length < 2) return null;
  const rows = rollingAverage(inRange, 7);
  return {
    latest: rows[rows.length - 1].avg,
    change: Math.round((rows[rows.length - 1].avg - rows[0].avg) * 10) / 10,
    count: inRange.length,
  };
}
