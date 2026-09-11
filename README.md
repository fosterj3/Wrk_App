# Cadence

**Log the work. See the pattern.**

A workout log that runs in the browser and installs to your phone's home screen.
Lifting, running, cycling, yoga, pilates — one log, no account, works offline.

**Live:** [what it is](https://fosterj3.github.io/Wrk_App/) · [the app](https://fosterj3.github.io/Wrk_App/app.html)

The repo is still named `Wrk_App` — renaming it would change the published URL and break every
installed copy, so only the product name changed.

## What it does

- **Log workouts** — weight × reps for lifting, distance and time for cardio, a held time for planks, or just a duration for yoga and pilates. Tick sets off as you go.
- **Build me a plan** — five questions (goal, days, style, equipment, experience) and Cadence writes you a real starting program, with notes on how to run it. Lifting, cardio, both, or a yoga/pilates week.
- **Paste from your notes** — paste a workout or a whole program straight out of Notes and it becomes routines, with sets, reps and weights filled in. It shows you what it understood before saving anything.
- **Routines** — save a workout as a template ("Push Day A") and load it instead of retyping it every session.
- **Last time you did this** — every exercise shows what you did last session, with a Repeat button to copy those numbers in.
- **Personal records** — beat your best estimated 1RM on a lift and the app says so, once per exercise per workout.
- **Weekly goal** — set a target and a progress ring tells you where you are and whether the week is slipping away.
- **Plate calculator** — what to load per side for any target weight.
- **Share your week** — a square image of your week for the group chat.
- **Alerts you can hear** — a rest alert designed to cut through music, with volume and a test button, plus the screen staying awake so it actually fires.
- **Timers** — a rest countdown that starts on its own when you tick a set, and a stopwatch for planks, runs and classes that writes the elapsed time straight into the set.
- **Calendar** — month and week views showing which days you trained, colour-coded by lifting, cardio, practice or a mix. Tap any day to see, add or delete a workout — and set the time you actually trained, not when you got round to logging it.
- **Bodyweight** — log your weight, see a 7-day rolling average against a goal.
- **Data** — charts for how often you train, when of day you train, what kind, your strength progression per exercise, weekly volume and cardio, and your most-trained lifts.
- **Dark and light themes** — deep plum throughout, or plum on warm off-white. Follows your phone's setting on first run; switch it any time in Settings.
- **A walkthrough on first run** — a ten-step spotlight tour of the five tabs. Shows itself once; rerun it any time from Settings.
- **Works offline** — a service worker caches the app, so it runs in the gym with no signal.

## Installing it on your phone

Open the live link, then:

**Android (Chrome)** — three-dot menu → **Install and add shortcut** (older Chrome: *Add to Home
screen*) → confirm **Install**.

**iPhone (Safari)** — **Share** (behind the three-dot button beside the address bar on newer iOS)
→ scroll to **Add to Home Screen** → leave **Open as Web App** on → **Add**. It has to be Safari,
and with that toggle off you get a plain bookmark rather than an app: no full screen, no offline.

Installed, it opens full-screen like a normal app.

## Where your data lives

Everything is stored in `localStorage` on the device that entered it. There is no server and no
account, which means:

- Your phone and a friend's phone keep entirely separate logs — nothing syncs between them.
- Clearing your browser data erases your history.
- On iPhone, iOS can evict a web app's storage if you don't open it for several weeks.

So use **Settings → Backup file (.json)** now and then; *Import* restores it. There is also a
**Spreadsheet (.csv)** export for reading and sharing — see below.

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
| `index.html` | Landing page — what the app is, for first-time visitors |
| `app.html` | The app shell — tab bar, view containers, bottom sheet |
| `landing.css` | Landing page styling (palette tokens come from `styles.css`) |
| `app.js` | All app logic: state, storage, rendering, rest timer |
| `parse.js` | Turns pasted free-form workout text into routines |
| `plan.js` | Builds a starting program from a goal (the "where do I start" answer) |
| `util.js` | DOM-free helpers shared by the app and the tests |
| `library.js` | The exercise library, shared by the app and the tests |
| `tests.html` / `tests.js` | Pure-logic test suite — open the page to run it |
| `viz.js` | Chart building and stats aggregation for the Data tab |
| `tour.js` | The first-run walkthrough: its steps and the placement maths |
| `styles.css` | Styling, dark theme, mobile-first layout |
| `sw.js` | Service worker for offline use |
| `manifest.webmanifest` | Makes it installable as a PWA |
| `fonts/` | Self-hosted Inter (variable woff2) plus its OFL licence |
| `logo-mark-v2.png` | The brand mark as an alpha silhouette, tinted by CSS |
|  `favicon-*-v2.png`, `icons/` | Tab, Apple touch and home-screen icons |
| `tools/make-icons.html` | Regenerates every icon from the brand sheet |
| `tools/serve.ps1` | Local static server for development |

### Releasing a change

GitHub Pages serves assets with `Cache-Control: max-age=600`, so a browser can hold an old
`app.js` for ten minutes while already fetching the new `index.html`. That pairing is fatal — new
markup with old script means missing elements and a blank screen. Two things prevent it, and they
have to stay in step:

1. `ASSET_V` in `sw.js`
2. the `?v=` query on the asset tags in **both** `index.html` and `app.html`

**Bump both to the same number on every release.** A changed `?v=` is a new URL, so the browser
cannot serve a stale copy of it, and `ASSET_V` names the cache so the old one is dropped.

The font files in `fonts/` and the brand images carry no `?v=`. **Their version lives in the
filename instead**, so they are not re-downloaded on every release for nothing. They are still
listed in the worker's shell so they are cached for offline use.

That makes renaming them mandatory, not optional:

> **When the artwork changes, change the filename** — `icon-192-v2.png` → `icon-192-v3.png` — and
> update `manifest.webmanifest`, `sw.js`, `styles.css` and both HTML files.

This is not tidiness. **An installed app's launcher icon is rasterised at install time**, and Chrome
only replaces it when it notices the manifest pointing somewhere new — it compares icon URLs. Save
over `icon-192.png` in place and the manifest is byte-identical, so every phone that already has the
app keeps showing the old icon indefinitely. That is exactly what happened when the mark changed:
the files on the server were correct, every phone was still displaying the dumbbell.

Even with the rename, an already-installed app updates on Chrome's own schedule (roughly daily, and
not guaranteed). **Uninstalling and reinstalling is the only way to see a new icon immediately.**

The service worker also fetches with `cache: no-cache`, forcing a revalidation rather than trusting
a `max-age` copy, and installs with `cache: reload` so it can never bake a stale file into a fresh
cache. When a new worker takes over, the page reloads once — otherwise an update only appears on
the *second* refresh, which reads as "my deploy did not work".

## Not built yet

Supersets, cross-device sync, friends, notifications, an AI coach chat, and nutrition tracking.

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
| Purple | Lifting only |
| Amber | Cardio only |
| Green | Both in the same session |

Today is circled, the selected day is outlined, and paging between months or weeks moves the
selection with you so the panel underneath always describes something you can see.




## The first-run walkthrough

New users were opening the app and not knowing where to start. `tour.js` runs a ten-step spotlight
tour: dim everything, ring one real control, one sentence about what it's for, move on.

It introduces itself **once**, and lives in Settings → **Getting started** after that.

### It points, it doesn't trap

The scrim is `pointer-events:none`. Every part of the app stays usable while the tour is up — tap
something it didn't suggest and the bubble simply waits. Being stuck inside a tutorial is worse
than not having one, and the people most likely to tap something unexpected are exactly the people
it exists for. Tapping the ringed control advances the tour too, so following the instruction and
pressing **Next** amount to the same thing.

### Who sees it

| | |
| --- | --- |
| Fresh install, nothing logged | Runs automatically |
| Anything already logged | Silently marked done, never interrupted |
| Anyone, any time | Settings → Getting started |

Existing installs are marked done rather than shown the tour. Somebody with six months of history
does not need telling where the Workout tab is, and a walkthrough appearing over their log would
read as a bug.

### Three things that had to be got right

**Steps are tested on their own tab.** A target on the Routines tab does not exist while the
Workout tab is rendered. The first version filtered every step against the current screen and
silently dropped half the tour — `paste` and `plan` vanished. `startTour()` now switches to each
step's own view before testing for its target. `go()` and `render()` are synchronous, so the whole
sweep happens inside one frame and never paints.

**The tab bar has to rise as a whole.** `.tabbar` has `backdrop-filter`, which creates a stacking
context, so raising a tab button's `z-index` inside it does nothing against a scrim outside it. Each
step can name a `lift` selector — the ancestor that actually has to move above the dimming.

**No `requestAnimationFrame`.** rAF is suspended while a tab is in the background, which would leave
the tour started but never drawn. `setTimeout` fires either way (clamped to about a second when
backgrounded), and `getBoundingClientRect` is accurate in a hidden tab regardless.

### Placement

`placeBubble()` is pure and tested, because the awkward cases are all geometric: below the target
when there is room, flipped above when there isn't, centred horizontally but clamped to the
viewport. Pointing at the last tab used to hang the bubble off the right edge.

The ring is positioned from a viewport-relative rect, so scroll and resize reposition it rather than
locking the page — locking would have contradicted the whole "not a cage" design.

## Exercise types

Four, and the list is stated once in `util.js` as `EXERCISE_TYPES`:

| Type | Recorded as | Examples |
| --- | --- | --- |
| `lifting` | weight × reps | Bench press, curls |
| `cardio` | distance and a duration | Runs, rides, rowing |
| `timed` | a hold in seconds | Planks, dead hangs |
| `practice` | a duration and nothing else | Yoga, pilates, mobility |

**That constant is load-bearing.** `normalizeState()` uses it as a whitelist and rewrites anything
unrecognised to `lifting`, so adding a type without registering it there would silently destroy
every entry using it on the next load. The library test asserts against the same constant rather
than a copy of the list.

### Practice is not cardio with the distance left blank

A yoga class has a duration and no distance, no reps and no load. Filing it under `cardio` would
have meant a permanent empty column and a "—/45min" summary; filing it under `timed` would have
meant recording an hour of pilates as 3600 seconds.

The cost of a fourth type is a fourth calendar colour, which had to be found rather than picked —
see the chart colours section.

## Durations

Cardio and practice durations are stored as **total minutes**, unchanged, because that is what the
CSV, the charts and the paste parser have always read. The hours box is an input convenience over
that one number, not a second stored field:

```
set.minutes = 135      →  [ 2 ] h [ 15 ] m
```

Both boxes write `set.minutes` between them. Typing `90` into the minutes box stores 90 and comes
back as `1h 30m` on the next paint — nothing re-renders while you type, so the digits you entered
stay put until you look away.

The stored value may be fractional; the stopwatch writes what it measured. Everything shown to a
person rounds to the whole minute.

> Rounding happens on the **total**, not after dividing. `119.6` minutes must read `2h 0m`, not
> `1h 60m` — there is a test for exactly that.

## A stopwatch for runs and classes

The rest timer and the plank stopwatch already existed; the stopwatch now knows which field it is
filling. `timer.field` is `'seconds'` for a hold and `'minutes'` for anything measured in minutes,
so a 40-minute run is not recorded as `2400s`.

Cardio and practice cards get a **Start** button next to *+ Set*, rather than a play icon inside
the row — the cardio row already carries five columns and a sixth would not fit a phone.

Stopping a hold offers a rest countdown. Stopping a run or a yoga class does not: resting is not
what comes next, and the timer would only need dismissing.

## When you trained

The calendar shows the time of each session as an editable control — tapping it opens the native
time picker. Only the clock moves; the calendar day is held fixed, so scrolling the hour past
midnight cannot slide a 6am session onto the day before.

The retroactive log sheet also asks for the time up front, which is the better place to fix it.

### Placeholder times are excluded, not averaged

A backdated session with no stated time is parked at **midday** so it lands on the right calendar
day in every timezone. That placeholder must not become data: without care, every workout anyone
logged late would pile up at noon and invent a lunchtime habit nobody has.

Sessions carry `timeSet`. The **When you train** chart counts only the ones where it is true, and
says in plain text how many it left out and how to fix them.

Anything logged before that flag existed has no `timeSet`, so `hasRealTime()` falls back to the
tell: the old placeholder was *exactly* `12:00:00.000`, which a real workout essentially never
hits. A few genuine noon sessions get misread as unset. That is the right way round — the cost is
one missing bar rather than a fabricated spike.

## Plan styles

The builder used to assume a barbell. It now asks what the week is actually made of, separately
from the goal — "lose weight" says nothing about whether someone wants to be under a bar or on a
mat:

| Style | The week |
| --- | --- |
| `lift` | The lifting split, and nothing appended |
| `mixed` | The lifting split with cardio at the end of each session |
| `cardio` | Easy / interval / long sessions, alternating hard and easy |
| `mindbody` | Flow, mat work, mobility and a gentle day |

Each style stays pure to what was asked. Advice about what to add — strength work for runners,
resistance work alongside a mat practice — goes in the notes rather than being silently inserted
into the plan.

Two details worth keeping:

- **Omitting the style is still valid.** Older callers and the test sweep pass no style, and fall
  back to what the builder did before: lifting, with cardio bolted on for the goals whose scheme
  asked for it. There is a test pinning that.
- **The equipment question is skipped** for a mat practice, because nothing in the answer changes
  the plan. `PLAN_STEPS` entries can carry a `when` predicate; the step counter and the Back button
  both walk the filtered list, so going back past a skipped question can't strand you.

The sweep now covers **720 combinations** — goal × days × equipment × level × style — asserting
every exercise exists in the library, is typed the way the library types it, has sets, has minutes
where the type needs them, and that no routine name repeats within a week.

## The brand

Logo, wordmark, tagline and palette come from a supplied brand sheet. The typeface it specifies —
**Inter** — was already in use, so that part needed nothing.

| | |
| --- | --- |
| Purple | `#311432` |
| Plum floor (dark theme background) | `#1A0A1B` |
| Typeface | Inter |
| Tagline | Move forward |

### The mark is extracted, not redrawn

The mark is a pair of interlocking angular blades forming a **C**. It was supplied as a raster brand
sheet, and an early attempt to rebuild it as SVG by hand produced something in the right spirit but
visibly not the same shape — a logo that is *nearly* right is worse than no logo.

So `tools/make-icons.html` reads the sheet and lifts the artwork out of it. The mark is flat purple
on flat paper, which means its coverage can be recovered exactly rather than guessed:

```
alpha = clamp((0.97 − luminance) / 0.72)
```

That yields an antialiased **silhouette**, which is then tinted and tiled to produce every asset.
One extraction, several outputs, all pixel-faithful to what was supplied.

Run it by opening `tools/make-icons.html` with `brand-source.png` in the repo root — it renders the
set and downloads them. It is a build tool, not part of the app; nothing at runtime depends on it.
The brand sheet itself is gitignored, since it is artwork rather than source.

### One file, every background

`logo-mark-v2.png` is a white silhouette with an alpha channel, painted by CSS rather than baked into a
coloured image:

```css
.mark{
  background:var(--accent);
  -webkit-mask:url(logo-mark-v2.png) center/contain no-repeat;
          mask:url(logo-mark-v2.png) center/contain no-repeat;
}
```

So the same 12KB file serves purple-on-black, purple-on-cream and white-on-purple, and it follows
the theme token instead of needing a copy per background.

### Where it appears

- **Landing page** — the full lockup: mark, wordmark, tagline beneath.
- **Settings, at the foot** — the same lockup, small, above the workout count. Deliberately the only
  place the brand appears *inside* the app; a logo in the top bar during a workout is chrome
  competing with the set in front of you.
- **Icons** — home screen, favicon, Apple touch icon. White mark on the brand purple, matching the
  "light icon" on the sheet. The maskable icon gets a bigger inset because Android can crop to a
  circle inscribed in the middle 80%, and a mark drawn to the edges loses its terminals.

The tagline sits in the lockup rather than replacing the page headline. **"Move forward"** says what
Cadence is *for*; **"Log the work. See the pattern."** says what it *does*, which is the job of the
first thing a stranger reads.

### #311432 is a background, not a fill

The brand purple is `h298 s43% l14%` — a deep, muted plum. At 14% lightness it is **as dark as a
dark-mode background**, which decides where it can be used:

| `#311432` used as… | |
| --- | --- |
| Text colour behind white | 16.5:1 — excellent |
| A button on the light cream background | 14.8:1 — excellent |
| A button on a near-black background | **1.19:1 — invisible** |

A control needs about 3:1 to be seen at all, so on a black background this colour cannot be a fill.
Rather than lighten the brand colour, the **dark theme was rebuilt around it**: the floor is a
darker plum, cards *are* `#311432`, and only the elements that must rise above them — buttons,
chart marks — use a lifted plum. The theme reads as one colour instead of purple on grey.

```
dark   bg #1A0A1B  ·  surface #251126  ·  card #311432  ·  button #9C4A9E
light  bg #f5f3ed  ·  surface #ffffff  ·  button #311432
```

Light mode is where the brand colour works untouched, so it is the accent there directly.

### Everything was re-measured

| Pair | Dark | Light |
| --- | --- | --- |
| Body text on background | 19.0:1 | 17.0:1 |
| Muted text on background | 8.5:1 | 6.2:1 |
| Button label on button | 5.4:1 | 16.5:1 |
| Button against background (needs 3) | 3.5:1 | 14.8:1 |
| Purple text on background | 10.2:1 | 8.5:1 |

Two things the plum broke, both found by measuring rather than looking:

- **The lifting series merged with the cardio amber under tritanopia** (ΔE 7.2, floor 12). The old
  series colour was a blue-violet, which separated on the blue-yellow axis that tritans lose; a plum
  does not. Ten replacement plums were swept and *all* failed — the binding constraint was the
  amber, not the purple. Brightening cardio to `#E8A020` restores it at ΔE 20.9.
- **White calendar chips on the light-mode amber were 3.19:1.** Pre-existing rather than caused by
  the plum, but it is 9.5px text and it was found while re-checking, so it was fixed by darkening
  that amber to `#A45A06`.

Both palettes now clear every check: AA on all text pairs, 3:1 on all controls, and ΔE ≥ 12 between
every pair of series colours under normal, protan, deutan and tritan vision.

## Theming

Two themes, switched in Settings → Appearance:

| | Background | Accent | Text |
| --- | --- | --- | --- |
| Dark | Deep plum `#1A0A1B` | Lifted plum `#9C4A9E` | White |
| Light | Warm off-white `#f5f3ed` | Brand plum `#311432` | Black, white on plum |

On first run it follows the phone's own light/dark setting; after that your choice sticks.

Every colour in `styles.css` goes through a CSS custom property defined in the `:root` and
`:root[data-theme="light"]` blocks at the top — **there is no raw hex anywhere else in the file**.
Add a colour by adding a token to both blocks, not by inlining a value, or the two themes will
drift apart.

`index.html` sets `data-theme` in a small inline script before the stylesheet paints. Without it a
light-mode user gets a black flash on every load.


## The typeface

The app is set in **Inter**, on every device, rather than in each platform's own UI font.

The font is **self-hosted** in `fonts/`, not linked from Google Fonts. Two reasons, both of which
matter more here than the convenience of a `<link>`:

- The landing page promises that nobody can see your training. A Google Fonts link would send a
  request from every device on every launch — not your workout data, but your IP and the fact that
  you opened the app, to a third party. That is a strange thing to do in an app whose entire pitch
  is that there is no server.
- **A basement gym has no signal.** A font on a CDN is a font that doesn't render. These files are
  in the service worker's shell cache, so an installed Cadence looks the same offline as online.

It is the **variable** font — one file covering weights 100–900. That is what lets the several
`font-weight:650` rules mean 650, instead of rounding to 700 as they did against the system stack.

Some specifics worth not undoing by accident:

- `font-display:swap`, so text is readable immediately in the fallback and reflows when Inter
  lands. Never invisible text.
- The `unicode-range` split means **latin-ext (83KB) is only fetched if a page actually uses those
  characters.** Most people only ever download the 47KB latin file.
- Both HTML files `<link rel="preload">` the latin subset. `crossorigin` is required there even
  though the file is same-origin — fonts are always fetched in CORS mode, and without the attribute
  the browser fetches it twice.
- The font files carry **no `?v=`**. The filename is the version, and they are content-stable, so
  re-downloading 130KB on every release would be waste.
- The system stack is still listed behind Inter in `--font`. It is the fallback during the swap and
  if the file ever fails — not a device-dependent choice.

Inter is licensed under the SIL Open Font License; `fonts/OFL.txt` ships alongside it, as that
licence requires.

### What changing the font broke

Inter sets about **11% wider** than the system fonts the layout had been tuned against, which is a
good argument for checking rather than assuming. Everything survived at 375px except one thing, and
it was a latent bug rather than a font problem: the progress line chart always forces a label onto
the final point — it is the number you came to see — *in addition to* labelling every Nth. When the
series length isn't a neat multiple, those two land next to each other. It fit in Segoe UI and
collided in Inter.

Fixed in `lineChart` by keeping both ends and dropping any middle label that can't clear them by
`PLOT_W / 6`. The gap is a fraction of the plot rather than a pixel guess, so it holds whatever
font is rendering.

Two places that used to be monospace are now Inter as well: the paste textarea, and the "lines I
couldn't read" list. Monospace was device-dependent too — SFMono on iOS, Consolas on Windows — so
leaving it would have defeated the point. The landing page's "Your notes" sample is also sans now,
which is arguably more honest: iOS Notes and Google Keep both set plain text in the system sans,
not in a monospace face.

## The data tab

Pick a window — 2 weeks, 4 weeks, 12 weeks, 6 months, all time — and everything below re-reads:

- **Headline** — workouts in the window, against the same-length window before it.
- **Tiles** — workouts per week, current streak, total volume, cardio minutes.
- **How often you trained** — workouts per day on the short windows, per week on the longer ones, per month once "all time" passes ~6 months.
- **What kind of training** — lifting / cardio / both, as one stacked bar.
- **Strength progress** — a line per exercise. Defaults to estimated 1RM (Epley) so a heavy
  triple and a light set of ten stay comparable; switch to **Top set** for the raw heaviest weight.
- **Lifting volume** and **Cardio minutes** — per week; each hides itself if you have no such data.
- **Most-trained exercises** — by sets logged.

Tap or hover any bar, point or segment for exact numbers.

Two deliberate choices worth knowing:

- **The strength chart doesn't start at zero.** Progressing 185 → 205 is invisible on a 0-based
  axis. The axis is padded around the actual range instead, which is right for a progress line
  and would be wrong for the volume bars — those *are* zero-based.
- **The in-progress week is greyed, not hidden.** A half-finished week would otherwise read as a
  collapse in training.

### Chart colours

The four series colours are **validated, not chosen by eye** — lightness band, chroma floor,
protanopia/deuteranopia separation, normal-vision floor, and contrast against the card surface,
in both themes:

| | Lifting | Cardio | Practice | Mixed |
| --- | --- | --- | --- | --- |
| Dark | `#C169C3` | `#E8A020` | `#64B4AE` | `#199e70` |
| Light | `#6B2E6D` | `#A45A06` | `#1B7E76` | `#166534` |

These are also the calendar's dot colours — one meaning, one colour, app-wide. If you change them,
re-run the validator rather than eyeballing. Every attempt so far has failed on the first pass:
dark amber and green once sat outside the lightness band; light amber/green collapsed to ΔE 6.8
under protanopia; and moving lifting to a plum for the brand merged it with the cardio amber under
tritanopia, which took a change to the *amber* to fix — see the brand section.

Adding **practice** as a fourth colour was the hardest of those. The obvious choice — a blue —
merged with the plum under deuteranopia at ΔE 10.7 against a floor of 12, because both lose their
distinguishing channel at once. Rather than guess again, the hue/saturation/lightness space was
searched exhaustively against the other three under all four vision types. The teal that came out
of it is not the binding constraint any more: the worst pair in the set is the pre-existing
lift/cardio one at ΔE 20.9.

Four categorical colours is close to the practical ceiling for this. A fifth would very likely need
a non-colour channel — shape, fill pattern — rather than another hue.

Note that SVG marks need `fill`, not `background` — the `.k-lifting` class that colours an HTML
legend swatch will render an SVG path **black**.

### Two weeks is the floor

The shortest window is 2 weeks, and **no view ever shows less than that** — "All time" for someone
who logged their first workout yesterday still draws a full 14 days rather than a single bar.

Short windows bucket by **day**, not week: two or four weekly bars is a bar chart with nothing in
it, whereas 14 daily bars read like a habit tracker and actually answer "which days did I train?".
Weekly bucketing takes over at 12 weeks, monthly past ~6 months.

Bucket granularity also decides what counts as "in progress". A part-finished week or month is
greyed so it can't be misread as a drop in training; a *day* never is — you either trained or you
didn't.

Count axes force a whole-number step. Without that, a 0–1 workout count picks a 0.5 step and the
axis renders as `0, 1, 1` once the labels round.

## Habit and accountability features

None of these need a server — they all read the history already on the device.

**Last time you did this.** Under every exercise, what you did in your most recent session with it.
This is the reason to open the app mid-set: it turns a logbook into something that tells you what to
lift today. `Repeat` copies those numbers straight into the sets.

**Personal records.** Completing a set that beats your best estimated 1RM for that lift shows a
`PR` badge and a toast. It only fires when there is a previous best to beat — otherwise the first
set you ever log would be a "record" — and only once per exercise per workout, so a working set of
five doesn't celebrate five times.

**Weekly goal.** Set a target in Settings (0 turns it off). A ring on the Workout and Data tabs shows
progress, and turns amber when you're behind far enough that every remaining day has to be a training
day. That "in danger" logic is `workouts remaining >= days remaining`.

**Plate calculator.** Per-side breakdown for a target weight, seeded from the heaviest weight already
entered for that exercise. Bar weight is configurable. If a target can't be built from standard
plates it says how much is left over rather than rounding silently.

**Share your week.** Renders a 1080×1080 PNG on a canvas — workout count, a dot per day coloured the
way the calendar colours it, volume and cardio — and hands it to the native share sheet. Falls back
to a download where `navigator.canShare` doesn't accept files (most desktop browsers). The card reads
the live theme tokens off `:root`, so it matches whichever theme is active.

**Backup nudge.** After five logged workouts, if you've never exported or it's been over 30 days, a
banner offers to export. "Later" snoozes it for a week; exporting clears it. This exists because
local-only storage means a cleared browser is a total loss.

## Logging a workout you already did

Tap any past day in the calendar and use **Log a workout on this day**. Pick a routine or start from
scratch, type in the sets, and it saves under that date. Today's button says **Add a workout today**
and starts a normal live session instead.

Backdated entries reuse the whole workout screen, so routines, the exercise picker, the paste
importer, "last time", and the plate calculator all work the same way. Three things differ, because
they only make sense live:

- **No rest timer.** Nothing is resting.
- **Duration is typed, not measured.** Leave it blank and the calendar just omits it rather than
  claiming the session took zero minutes.
- **The time is set to midday.** A backdated log has no real start time, and midday keeps the
  session inside the intended calendar day in every timezone — a midnight timestamp can slide into
  the day before or after.

Future dates can't be logged; the day panel says so instead of offering the button. Saving a
backdated workout re-sorts the history so it lands in the right place, and jumps the calendar to the
day you filled in.

## Timers and timed exercises

One bar above the tab bar does two jobs:

- **Rest countdown.** Starts automatically when you tick a set off, or on demand with **Start rest**
  on the session card — useful between exercises, not just between sets. `+30s` extends it, `Skip`
  ends it. Manual start works even with the automatic timer set to 0.
- **Stopwatch.** For held exercises. Press ▶ on the set, hold the plank, press ■ — the elapsed
  seconds are written into the set, it's marked done, and the rest timer starts.

If the set already has a number in it, that's treated as a target: the app chimes when you reach it
but **keeps counting**, and records what you actually held, not what you aimed for.

### The timed exercise type

Holds don't fit weight×reps, so there's a third exercise type alongside lifting and cardio, with a
single `seconds` field per set. `Plank`, `Side Plank`, `Dead Hang` and `Wall Sit` ship as timed, and
a custom exercise now asks which of the three kinds it is rather than just "is this cardio?".

Two consequences worth knowing:

- **A timed hold counts as strength work, not as "both".** A bench session with a plank in it is
  still a lifting day on the calendar — otherwise adding core work would silently recolour the day.
- **Timed sets are excluded from volume and strength-progress charts**, since they have no weight.
  They still count toward set totals and "most-trained exercises".

The paste importer reads `Plank 3x45s`, `Side plank 2 x 30 sec` and `Wall sit 60s`. A bare
`Plank 3x60` is read as 60 seconds rather than 60 reps, because the exercise is known to be timed.

## Editing what the parser guessed

Imports are a guess, so both the preview and the saved routine let you fix them.

In the **paste preview**, every exercise name is an editable field — correct `Incline DB Press` to
whatever you call it before anything is saved. In the **routine editor**, each exercise has both an
editable name and a dropdown for how it's recorded (weight & reps / held time / distance & time),
because the parser can type an exercise wrongly and that used to be unfixable without deleting it.

Changing how an exercise is recorded clears its target sets — a weight-and-reps target is
meaningless once it's a timed hold, and keeping it would show nonsense in the routine summary.

Clearing a name field doesn't erase the name; the blank simply isn't saved, so you can select-all
and retype without losing it if you change your mind.

## Exporting

Two formats, both offered to the OS share sheet first (so you can mail them straight from a phone)
and downloaded if sharing isn't available:

| Format | For |
| --- | --- |
| `.json` | The restoreable backup. This is the one to keep, and the one Import reads. |
| `.csv` | Reading, sending — and importing back. One row per set, opens in any spreadsheet. |

The CSV has columns `Date, Time, Workout, Exercise, Type, Set, Weight, Reps, Distance, Minutes,
Seconds` and is written oldest-first with a UTF-8 BOM, so Excel opens it correctly instead of
mangling non-ASCII exercise names.

### Importing a CSV back in

**Settings → Import a file** takes either format, decided by content rather than file extension.
A `.json` backup restores everything. A `.csv` holds workouts but no routines, goals or settings,
so it can't be a blanket "replace everything" — instead it shows what it read and offers two
choices:

- **Add to my log** — merges, skipping anything already there. Duplicates are matched on date, time
  and workout name, so importing the same file twice adds nothing the second time.
- **Replace my workouts** — swaps out the workout history only. Routines, goals and settings survive.

The reader is deliberately forgiving, so a spreadsheet you edited by hand (or one shaped from
another app) still lands:

- Header names are matched loosely — `Session`/`Workout`, `Movement`/`Exercise`, `Load (kg)`/`Weight`,
  `Rep`/`Reps`, `Dist`/`Distance`, `Duration`/`Minutes`, `Hold`/`Seconds`.
- Dates accept `YYYY-MM-DD` and `M/D/YYYY` (US order). A missing time becomes midday, for the same
  timezone reason backdated workouts use midday.
- With no `Type` column the type is inferred: seconds filled in means a hold, distance or minutes
  means cardio, otherwise weight and reps.
- Rows with no exercise name or an unreadable date are counted and reported, not silently dropped.

Export → import is lossless for everything the CSV carries; verified round-trip including quoted
workout names containing commas, multiple set rows per exercise, and all three exercise types in
one session. Session duration isn't in the CSV, so re-imported workouts show no duration.

### The home button

The app's top-right corner links back to the landing page. It points at `index.html?from=app`
rather than plain `index.html`: the landing page sends home-screen launches straight to the app, so
without that marker an installed user would tap Home and be bounced immediately back.

## Build me a plan

Routines → **Build me a plan**. Four questions — goal, days per week, equipment, experience — and
it writes a program into your routines and sets your weekly goal to match. Preview first; nothing
saves until you confirm.

Deliberately **not** an LLM. Someone asking "where do I start" needs a correct answer instantly and
offline, and the answers here are settled training practice rather than novel advice. A chat coach
would also need an API key, which cannot live in a static site — see below.

### How it generates

Days are **movement-pattern slots** (squat, hinge, horizontal push, vertical pull, lunge, calf,
curl, triceps, lateral, core), and your equipment decides which exercise fills each slot. One set of
templates therefore covers a full gym, a pair of dumbbells, or nothing at all, and every exercise it
prescribes is guaranteed to exist in the app's library with a matching type.

Judgment encoded in it, rather than hidden in prose:

- **Full-body days by default.** A body-part split trains each movement once a week; three full-body
  days train each one three times, and missing a day costs less. A split is only used at four days,
  or at three days for someone experienced chasing strength or size.
- **Bodyweight never gets a split.** Without equipment a "Push" day has no lateral raise or
  pushdown, and for a beginner both push slots regress to the same movement — the day collapses to
  one exercise. Bodyweight always gets full-body sessions, three distinct ones maximum.
- **Beginners get a set removed** from every exercise. Early on the limit is recovery and technique,
  not effort.
- **Bodyweight beginners get regressions.** Prescribing `Pull-Up 3x10` to someone who can't do one
  isn't a plan; that slot becomes an Inverted Row, and Pike Push-Ups become Push-Ups.
- **Weights are left blank on purpose**, with the reason explained in the plan: find your working
  weight in session one, and "last time" carries it from then on.

Every one of the 180 goal × days × equipment × experience combinations is checked to produce at
least three exercises per day with valid, library-resolvable exercises.

### On health goals

The **Health markers** goal (A1C, blood pressure) ships with a plain note that this is general
exercise information and not medical advice, and to talk to a doctor before starting when managing
a condition — particularly about exercise timing and hypoglycemia on glucose-lowering medication.
Keep that note if you touch this code.

### Why there's no AI chat

An API key cannot ship in a static site — the app is world-readable, so the key would be scraped
and billed. That leaves a server proxy (real hosting, real money, needs rate limiting because the
URL is public) or asking every user for their own key. The guided builder covers the common
"where do I start" case with neither, and `plan.js` is a clean seam if a chat layer is ever added
on top.

## Tests

Open **`tests.html`** in the browser. No tooling, no install — it loads the real `util.js`,
`library.js`, `parse.js`, `plan.js` and `viz.js` in the same order the app does, runs assertions
against them, and prints pass/fail. Nothing is stubbed, so a red line here means the shipped code
is wrong.

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080
```

then <http://localhost:8080/tests.html>. A headless runner can read `window.__testResults`.

Coverage is the pure logic: the paste parser, the CSV round trip, the plan builder (all 180
goal × days × equipment × experience combinations), unit conversion, and the stats helpers.
**Every case is a bug that actually shipped at some point**, or a rule that would be expensive to
break quietly — the `135 x 5` per-set misread, `5k in 28 min` producing an exercise called "In",
the bodyweight plan collapsing to one exercise a day, the `0, 1, 1` axis. When you fix a bug in
that layer, add the case that would have caught it.

Two things are pinned there deliberately as **known limitations**, so they stay visible rather than
being rediscovered: converting units there-and-back drifts by up to 0.1 (weights are stored to one
decimal), and the name matcher resolves `Copenhagen Plank` to `Plank` — the same rule that usefully
resolves `Barbell Bench Press heavy`. The paste preview shows the resolved name before saving, and
Settings → Exercise names can split it afterwards.

`util.js` and `library.js` exist so this is possible at all: the pure logic used to depend on
globals defined inside `app.js`, which meant it could only be exercised by booting the whole UI.

## Editing what's already logged

Tap a workout in the calendar and press **Edit**. It reopens on the normal logging screen — so the
picker, plates and "last time" all work — and saving **replaces** the original rather than adding a
second copy. Cancelling leaves the saved workout untouched. Unticking every set is treated as
deleting it, and asks accordingly.

## Units and exercise names

**Switching kg/lb converts every stored weight.** It has to: the unit is a real unit, not a label,
so relabelling would turn a recorded `185 lb` into "185 kg" — a 2.2× lie about your whole history.
Sessions, routines, the bar weight, your bodyweight log and any goal weight are all rewritten, after
a confirmation that says how many numbers will change.

**Settings → Exercise names** lists every exercise with how often it appears, and lets you rename
one — onto an existing name to merge them. This matters more than it looks: the exercise *name* is
the join key for "last time", personal-record detection and the strength-progress chart, so a typo
silently forks one exercise into two partial histories. Renaming an exercise inside a routine used
to orphan its logged history the same way; this is the fix. Merging across incompatible types
(a timed hold into a lifting exercise) is refused rather than corrupting the sets.

## Removing an exercise mid-workout

Swipe the exercise card **left** to reveal a red Delete, then tap it. There is no × in the card
header any more: a tap target sitting next to the exercise name is far too easy to catch by accident
with a phone in one hand between sets, and losing the sets you already logged is not a small mistake.

The gesture is deliberately fussy about what counts as a swipe:

- it only engages once horizontal travel exceeds vertical, so scrolling a long workout still scrolls
- it never starts on an input, button or select — dragging across a weight field would otherwise
  fight the keyboard
- the card is `touch-action: pan-y`, so the browser keeps vertical scrolling and hands us the
  horizontal axis
- opening one card closes any other, and tapping elsewhere closes them all
- the periodic elapsed-time re-render is skipped while a card is open, or it would slide shut as you
  reach for Delete

There is no confirmation dialog, because swiping open and then tapping Delete is already the two
deliberate actions the dialog existed to force.

**The Delete button is in the DOM at all times**, just positioned behind the card. That keeps it
reachable by keyboard and screen reader without a swipe — and focusing it slides the card open so
sighted keyboard users can see what they're about to press.

Set rows work the same way — swipe a single set left to delete it. Removing the trailing button
column also gave the number fields noticeably more room. Deleting the last remaining set leaves a
blank one behind rather than an exercise with no sets.

Tabbing to a Delete button slides its row open so a keyboard user can see what they are about to
press. That is done in JS on `focusin`, not with `:focus` in CSS, because that pseudo-class only
matches while the whole document has focus.

## Hearing the rest alert

The original alert was two sine notes at 660/880 Hz at low gain. That sits right where music puts
most of its energy, has no harmonics to stand out, and lasts a third of a second — so with anything
playing in headphones it simply vanished. Three things changed:

- **Around 2 kHz instead of 660 Hz**, roughly where hearing is most sensitive and where most mixes
  are quieter.
- **A square wave**, so there are harmonics to cut through, gently low-passed to take the edge off.
- **Repeated pulses through a limiter**, which lets the output sit near full scale without the
  crackle you get from just turning the gain up past clipping.

Measured by rendering old and new through an `OfflineAudioContext`: **11× the RMS** for *Beep* and
13.6× for *Alarm*, both peaking at 0.82 so neither clips. Three sounds are available with a volume
slider and a **Test** button — play it with your music on and turn it up until you can hear it.

Two caveats worth knowing: on iPhone the alert follows the ringer switch, and iOS ignores
`navigator.vibrate` entirely, so the sound has to carry the job there.

The `AudioContext` is now unlocked on the first tap anywhere. Safari refuses to start one outside a
user gesture, and the rest timer fires without one — so previously the alert could be silent
outright rather than merely quiet.

## Keeping the screen awake

A sleeping phone freezes the page, so the rest alert would fire when you next unlocked rather than
when rest ended. The app now holds a **screen wake lock** while a workout is open, releasing it on
finish or discard, and retaking it when you come back to the tab (the lock is dropped whenever the
tab is hidden). It can be turned off in Settings, since it costs battery.

## Protecting the log

The app now calls `navigator.storage.persist()` on load, asking the browser to mark its storage as
persistent so it isn't cleared to reclaim space. Browsers grant this on their own terms — usually
once the app is installed or has been used a few times — so Settings reports the current state
rather than pretending. It is not a substitute for exporting a backup.

## Undo

Deleting an exercise or a set now leaves a toast with **Undo** for six seconds, restoring it to the
position it came from. Deleting the last set of an exercise backfills a blank one so there is still
something to tap; undoing that removes the blank again rather than leaving a stray empty set.

## Reordering and notes

Exercises have up/down arrows in their header — deliberately non-destructive controls, unlike the
delete that used to live there. A workout can also carry a short **note** ("slept badly, felt weak"),
shown on the session card while you train and on the calendar afterwards, which is the context that
later explains a bad week.

## Installing

Where the browser supports it — Chrome on Android and desktop — the landing page and Settings show a
real **Install** button using `beforeinstallprompt`, so nobody has to be walked through a menu. The
written steps stay because **Safari has no equivalent API**: on iPhone, Share → Add to Home Screen is
genuinely the only route. When the button appears, the manual steps demote to "Or do it by hand".

### Why the button sometimes never appears

**Chrome does not fire `beforeinstallprompt` for an app that is already installed.** So "no button"
is ambiguous on its own — it means either "already done" or "not offered yet" — and showing install
instructions to someone who has already installed it is just noise.

`navigator.getInstalledRelatedApps()` resolves it, which is why the manifest lists **itself** under
`related_applications`. That gives four honest states rather than one guess:

| Situation | What is shown |
| --- | --- |
| Running as the installed app | Nothing — you clearly do not need it |
| Browser offers a prompt | A real **Install** button |
| Detected as already installed | "Already installed", and the steps become "to install on another device" |
| Genuinely unknown | Guidance that says so, rather than assuming you have not installed it |

Two limits worth knowing. `getInstalledRelatedApps()` is Chrome-only, so on iOS the app cannot tell
whether it is installed while you are looking at a tab, and falls back to the honest "unknown" copy.
And the `related_applications` URL points at the deployed manifest, so detection does not work when
serving from localhost — that is expected, not a bug.

### iPhone: Safari only

**On iOS, only Safari can create a real standalone web app.** Chrome, Firefox and Edge on iPhone all
run WebKit underneath but cannot do it — Chrome has an "Add to Home Screen" buried in its menu, but
the result opens back in Chrome rather than running full screen and offline. There is no API to
change this and no button that could ever appear.

So the app detects it and says so, on the landing page and in Settings: it names the browser you are
actually in, explains that only Safari can do it, and offers a **Copy link for Safari** button rather
than leaving you to hunt through a menu. Detection is by user-agent tag — `CriOS`, `FxiOS`, `EdgiOS`,
`OPiOS`, `GSA`, `DuckDuckGo` — since every iOS browser otherwise claims to be Safari. There are tests
for each of those in `tests.js`; user-agent sniffing is exactly the kind of thing that rots quietly.

## The QA pass

A full sweep of the app against a synthetic history — **479 sessions and 400 weigh-ins spanning
about two years** — plus a fresh install, checking every view in both themes: logging, timers,
swipe-to-delete and undo, reordering, notes, PR detection, plates, routines, paste import, the plan
builder, the calendar (including retroactive logging and the refusal to log the future), all five
Data ranges, unit conversion round trips, exercise renaming, the JSON and CSV round trips, contrast,
accessible names, the offline shell and the service worker.

It found three real problems, all fixed. Each is worth recording because none would have shown up on
the small dataset that day-to-day use produces.

### White text on the danger colour was unreadable

`--danger` is `#ff6b6b`, and white on it measured **2.78:1** in dark mode — under half the 4.5:1
minimum. It had gone unnoticed because destructive buttons are the ones you look at least. Fixed by
adding `--danger-ink` (`#2b0708` dark, `#ffffff` light) and `--tip-ink` rather than hard-coding
white, keeping every colour inside the token system.

### Malformed storage blanked the app

If `wrk.v1` held something structurally wrong — `sessions: null`, `sessions: 'oops'`, a session with
no `entries` array — the app threw during its first render and left a **blank screen with no way
back**, which is about the worst failure mode for a local-first app whose only copy of your data is
in that same storage.

`normalizeState()` in `util.js` now repairs the shape on load: wrong types are replaced with
defaults, and unusable records are dropped rather than taking the app down with them. Twelve tests
cover it. The important property is that a partially valid store keeps whatever *is* valid, so a
single bad session cannot cost you the other 478.

### The Data tab took 1.5 seconds on a real history

"All time" rendered in **1494 ms** against two years of data. Four separate causes, all
found by measuring rather than guessing:

| What | Before | After |
| --- | --- | --- |
| `rollingAverage` re-scanning the window per point (O(n²)) | 340 ms | 1.3 ms |
| `sessionsIn` re-parsing every session date, once per chart | 70 ms | 2 ms |
| `exerciseSeries` constructing an `Intl.DateTimeFormat` per point | 173 ms | 7.3 ms |
| `weightChart` drawing 400 overlapping dots into a 296px plot | 165 ms | 7 ms |

`rollingAverage` became a sliding window, so it is worth being explicit that the rewrite was
verified rather than assumed: it was checked against the brute-force version over **21,552 points
across 300 randomized trials**, and the windows are provably identical. The only differences are
floating-point rounding at exact `.x5` boundaries.

The dot thinning is the one that changes what you see: past ~120 weigh-ins the raw dots overlap into
a smear and their touch targets overlap into uselessness, so they are thinned to what can actually
be seen and tapped. **The average line still uses every point**, so the trend is unaffected.

Worst-case render is now 173 ms.

### And one cosmetic fix

Over a multi-year history the axis read **"Jul 1 – Sep 7"** — which looks like ten weeks but was
actually two years and two months. No data was being dropped; the label format simply omitted the
year. Long spans now name it: the bodyweight and progress axes switch to `Jul 2024`, and monthly
bars to `Sep '23`, while short ranges keep the day as before. Tooltips always keep the full date,
since two points can share a month.
