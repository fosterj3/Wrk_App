# Wrk

A workout tracker that runs in the browser and installs to your phone's home screen.
Log lifting and cardio, save reusable routines, and time your rest between sets.

**Live app:** https://fosterj3.github.io/Wrk_App/

## What it does

- **Log workouts** — add exercises, record weight × reps (lifting) or distance / minutes (cardio), tick sets off as you go.
- **Routines** — save a workout as a template ("Push Day A") and load it instead of retyping it every session.
- **Rest timer** — starts automatically when you tick a set, with a chime and a vibration when it's up. Configurable, or off.
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
