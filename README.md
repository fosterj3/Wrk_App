# Wrk

A workout tracker that runs in the browser and installs to your phone's home screen.
Log lifting and cardio, save reusable routines, and time your rest between sets.

**Live app:** https://fosterj3.github.io/Wrk_App/

## What it does

- **Log workouts** — add exercises, record weight × reps (lifting) or distance / minutes (cardio), tick sets off as you go.
- **Paste from your notes** — paste a workout or a whole program straight out of Notes and it becomes routines, with sets, reps and weights filled in. It shows you what it understood before saving anything.
- **Routines** — save a workout as a template ("Push Day A") and load it instead of retyping it every session.
- **Rest timer** — starts automatically when you tick a set, with a chime and a vibration when it's up. Configurable, or off.
- **Calendar** — month and week views showing which days you trained, colour-coded by what you did. Tap any day to see that day's workouts in full.
- **History** — a running list of everything you've finished.
- **Works offline** — a service worker caches the app, so it runs in the gym with no signal.

## Installing it on your phone

Open the live link, then:

- **Android (Chrome):** menu ⋮ → *Add to Home screen*
- **iPhone (Safari):** Share → *Add to Home Screen*

It then opens full-screen like a normal app.

## Where your data lives

Everything is stored in `localStorage` on the device that entered it. There is no server and no
account, which means:

- Your phone and a friend's phone keep entirely separate logs — nothing syncs between them.
- Clearing your browser data erases your history.
- On iPhone, iOS can evict a web app's storage if you don't open it for several weeks.

So use **Settings → Export backup file** now and then. *Import* restores it.

## Running it locally

The app is plain HTML, CSS and JavaScript — no build step and no dependencies. But it does need to
be served over HTTP rather than opened as a file, because service workers don't register on `file://`.

If you have Python or Node available:

```bash
python -m http.server 8080
```

Otherwise this repo includes a small PowerShell server that needs nothing installed:

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080
```

Then open <http://localhost:8080/>.

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Page shell — tab bar, view containers, bottom sheet |
| `app.js` | All app logic: state, storage, rendering, rest timer |
| `parse.js` | Turns pasted free-form workout text into routines |
| `styles.css` | Styling, dark theme, mobile-first layout |
| `sw.js` | Service worker for offline use |
| `manifest.webmanifest` | Makes it installable as a PWA |
| `tools/serve.ps1` | Local static server for development |

### A note on `sw.js`

The service worker caches the app shell under a versioned key. **After changing `index.html`,
`app.js` or `styles.css`, bump `CACHE` in `sw.js`** (`wrk-v1` → `wrk-v2`) so installed copies pick
up the new version instead of serving the old cache.

## Not built yet

Progress charts and per-exercise trends, supersets, plate calculator, and any kind of cross-device sync.

## What the paste parser understands

Routines tab → **Paste from notes**. It reads the common ways people write workouts down:

| You wrote | It reads |
| --- | --- |
| `Bench Press 3x8 @ 185` | 3 sets of 8 at 185 |
| `Squat 5x5 315` | 5 sets of 5 at 315 |
| `Incline DB Press 3 sets of 10` | 3 sets of 10 |
| `RDL 3 x 8-10 @ 135` | 3 sets, 8–10 reps, 135 |
| `Squats 12/10/8 @ 185` | three sets: 12, 10 then 8 reps |
| `Bench Press` / `135 x 5` / `185 x 3` | one exercise with two sets at those weights |
| `Run 3.1 mi 28 min` | cardio: 3.1 miles in 28 minutes |
| `5k in 28 min` | cardio: 5km in 28 minutes |

Headings like `Push Day A`, `Day 1`, or `Monday` split the text into separate routines.
Shorthand is matched against the built-in exercise list, so `bench`, `OHP`, `RDL` and `pullups`
resolve to full names; anything it doesn't recognise is kept as a custom exercise and marked *new*.

Coaching notes (`rest 90s between sets`, `remember to stretch`) are skipped and listed back to you,
so nothing disappears without you seeing it. Nothing is saved until you press **Add routines**.

Weights are imported as written — if your notes are in kg and the app is set to lb, it says so
rather than converting.

## The calendar

Month view shows the whole month at a glance, with a coloured dot on every day you trained.
Week view widens the cells so each workout shows by name. Either way, tapping a day opens that
day's workouts underneath — exercises, sets, weights and the time you started.

Days are coloured by what kind of session it was:

| Colour | Means |
| --- | --- |
| Blue | Lifting only |
| Amber | Cardio only |
| Green | Both in the same session |

Today is circled, the selected day is outlined, and paging between months or weeks moves the
selection with you so the panel underneath always describes something you can see.
