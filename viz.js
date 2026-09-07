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

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

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

  const buckets = [];
  const cur = new Date(first.getFullYear(), first.getMonth(), 1);
  while (cur <= now) {
    const s = new Date(cur);
    const e = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    buckets.push({
      start: s,
      end: e,
      label: s.toLocaleDateString(undefined, { month: 'short' }),
      full: s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return { mode: 'month', buckets };
}

function sessionsIn(sessions, from, to) {
  return sessions.filter((s) => {
    const t = +new Date(s.date);
    return t >= +from && t < +to;
  });
}

/* --------------------------------------------------------------- measures */

/* Volume only counts sets that have both a weight and reps — a bodyweight set
   logged as reps-only would otherwise silently contribute zero and drag the
   average down. */
function sessionVolume(s) {
  let total = 0;
  s.entries.forEach((e) => {
    if (e.type === 'cardio') return;
    e.sets.forEach((set) => {
      const w = Number(set.weight);
      const r = Number(set.reps);
      if (set.weight !== '' && set.reps !== '' && !isNaN(w) && !isNaN(r)) total += w * r;
    });
  });
  return total;
}

function sessionCardioMinutes(s) {
  let total = 0;
  s.entries.forEach((e) => {
    if (e.type !== 'cardio') return;
    e.sets.forEach((set) => {
      const m = Number(set.minutes);
      if (set.minutes !== '' && !isNaN(m)) total += m;
    });
  });
  return total;
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
      if (e.type === 'cardio' || e.name !== name) return;
      e.sets.forEach((set) => {
        const w = Number(set.weight);
        const r = Number(set.reps);
        if (set.weight === '' || isNaN(w)) return;
        const v = metric === 'e1rm' ? e1rm(w, isNaN(r) ? 0 : r) : w;
        if (v > best) best = v;
      });
    });
    if (best > 0) {
      points.push({
        date: new Date(s.date),
        value: Math.round(best),
        label: new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      });
    }
  });
  return points;
}

/* Lifting exercises worth charting, most-logged first. */
function trackableExercises(sessions) {
  const counts = new Map();
  sessions.forEach((s) => {
    const seen = new Set();
    s.entries.forEach((e) => {
      if (e.type === 'cardio' || seen.has(e.name)) return;
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

  const every = Math.ceil(points.length / 5);
  const xt = points.map((p, i) => (i % every === 0 || i === points.length - 1
    ? `<text class="viz-tick" x="${px(i)}" y="${H - 9}" text-anchor="${i === 0 ? 'start' : (i === points.length - 1 ? 'end' : 'middle')}">${esc(p.label)}</text>`
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
