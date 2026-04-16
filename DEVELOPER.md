# BibleCast — Developer Guide

## Overview

BibleCast is a Windows desktop application for church presenters. The operator searches for Bible verses by reference or keyword and projects them full-screen on a second monitor (HDMI output) during preaching. The operator controls everything from a dedicated panel on the primary screen.

---

## Features

| Feature | Description |
|---|---|
| **Verse search** | Search by reference (e.g. "John 3:16") or keyword; results appear instantly from a local SQLite database |
| **Projection window** | A second Electron window on the second monitor displays the verse in full-screen format, updated via Electron IPC |
| **NDI virtual output** | Second borderless window on the primary monitor, capturable by OBS/vMix as a virtual NDI source |
| **Multiple translations** | Switch between Bible translations at runtime; translations stored in SQLite |
| **getbible.net download** | 14 free public-domain translations downloadable in-app (KJV, ASV, WEB, YLT, BBE, and more) |
| **Bible Gateway Scraper** | Popup window that runs a Python background script to scrape 29 translations (ESV, NIV, NASB, NKJV, NLT, AMP, CSB…) from Bible Gateway with real-time per-book progress |
| **Import JSON / XML** | Import any Bible translation from a flat JSON array or Holy Bible XML / OSIS / Zefania XML file |
| **Manual push** | Operator selects a verse and pushes it to the display with one click |
| **Display control** | Show/hide the projection overlay, blank screen between verses |
| **Session management** | Each service is tracked as a named session; all displayed verses are logged per session |
| **History view** | Browse past sessions and all displayed verses |
| **Vosk transcription** | Real-time offline speech recognition (word-by-word) via vosk-browser WASM; ~45 MB model downloaded once |
| **Whisper AI** | High-accuracy offline transcription in 2–3 s chunks via @xenova/transformers; CPU and WebGPU modes |
| **Scripture detection** | Detects spoken references ("John three sixteen") and suggests matching verses automatically |
| **Auto-projection** | Optionally push detected verses to the display without operator input |
| **Voice commands** | "next verse", "previous verse", "clear screen", "repeat" — detected in live transcript |
| **Sermon summary** | Local keyword-extraction summary or GPT-3.5 AI summary (requires OpenAI key) |
| **Display layouts** | Full-screen or lower-third overlay per output (HDMI + NDI independently) |
| **Custom backgrounds** | Solid colour, gradient, or image background; colour presets and gradient presets included |
| **Transition speed** | Configurable CSS fade duration between verses |
| **Multi-monitor** | Projection window auto-placed on the second display; monitor selector in Outputs tab |
| **GPU acceleration** | WebGPU-accelerated Whisper AI via a hidden worker BrowserWindow |
| **Update checker** | Checks GitHub releases API 8 s after launch; shows banner if a newer version exists |
| **Settings** | Configurable font size, theme, background, session defaults, speech engine, detection sensitivity |
| **Graceful shutdown** | All output windows and DB connections cleanly closed on app exit |

---

## Technology Stack

### Desktop shell
- **Electron** — Node.js + Chromium desktop framework (Windows target)
- **Node.js 20 LTS** — main process, database access, IPC handlers

### Frontend (Renderer)
- **HTML / CSS / Vanilla JS** — lightweight operator UI and projection window (no framework required for v1)
- **CSS custom properties** — theming support

### Database
- **better-sqlite3** — synchronous SQLite driver used in the Electron main process
- Database stored at `%APPDATA%\BibleCast\biblecast.db`

### IPC Layer
- **contextBridge + ipcRenderer/ipcMain** — safe bidirectional communication between renderer and main process
- `preload.js` exposes a typed `window.biblecast` API to renderers — no direct Node.js access from UI code

### Build / Distribution
- **electron-builder** — produces NSIS installer for Windows
- **electron-rebuild** — rebuilds native modules (better-sqlite3) for the Electron Node.js ABI

---

## Repository Layout

```
BibleCast/
├── main.js                  # Electron main process — window management, IPC handlers, DB access
├── preload.js               # contextBridge — exposes window.biblecast API to renderers
├── src/
│   ├── renderer/            # Operator control panel (primary screen)
│   │   ├── index.html       # Operator UI entry point
│   │   ├── renderer.js      # Operator UI logic
│   │   └── styles.css       # Operator panel styles
│   ├── display/             # Projection window (second monitor) + NDI output
│   │   ├── display.html     # Full-screen verse display entry point
│   │   ├── display.js       # Display window logic (receives IPC pushes)
│   │   └── display.css      # Projection styles (large text, themes, backgrounds)
│   ├── scraper/             # Bible Gateway scraper popup window
│   │   ├── scraper.html     # Translation checklist UI
│   │   ├── scraper.js       # Popup logic — Python detection, progress rendering
│   │   └── scraper.css      # Popup styles
│   ├── whisper/             # Hidden GPU worker window for WebGPU Whisper
│   │   ├── whisper-gpu.html
│   │   └── whisper-gpu.js
│   └── lib/                 # Shared utilities (main process)
│       ├── db.js            # SQLite connection, schema init, query helpers
│       └── bible-parser.js  # Reference parsing ("John 3:16" → { book, chapter, verse })
├── scripts/
│   ├── launch.js            # npm start wrapper (unsets ELECTRON_RUN_AS_NODE)
│   ├── scrape_bible.py      # Python scraper — uses meaningless WebExtractor
│   ├── seed-db.js           # CLI: seed DB from a local JSON file
│   ├── bundle-kjv.js        # Bundles KJV into data/translations/kjv.json
│   └── download-translations.js  # CLI: download public-domain translations
├── data/
│   └── translations/        # Bundled KJV JSON (auto-seeded on first launch)
├── assets/
│   └── icons/               # App icons (.ico, .png)
├── package.json
├── electron-builder.json    # Installer / distribution config (includes scrape_bible.py)
└── DEVELOPER.md
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | 20 LTS or later | |
| **npm** | 10+ | Comes with Node.js |
| **Windows** | 10/11 x64 | Production target; dev also works on Windows |

---

## Getting Started

### 1. Clone the repo

```bash
git clone <repo-url>
cd BibleCast
```

### 2. Install dependencies

```bash
npm install
```

### 3. Rebuild native modules

`better-sqlite3` is a native Node.js addon and must be rebuilt for Electron's Node.js ABI version:

```bash
npm run rebuild
```

This runs `electron-rebuild` automatically. Re-run whenever you upgrade Electron.

### 4. Run in development mode

```bash
npm start
```

This opens the Electron app with DevTools enabled. Changes to renderer files are visible after a window reload (`Ctrl+R`). Changes to `main.js` or `preload.js` require restarting the app.

---

## Production Build

> **Always confirm before running a production build.**

```bash
npm run build
```

This runs `electron-builder` and produces:

**Installer output:**
- NSIS (recommended): `dist/BibleCast Setup 1.0.0.exe`

To build a portable (non-installer) executable:

```bash
npm run build:portable
```

---

## Architecture: How it all fits together

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process (main.js / Node.js)           │
│  • Creates BrowserWindow for operator panel          │
│  • Creates BrowserWindow for projection display      │
│  • Handles all IPC channels (search, push, session)  │
│  • Owns SQLite connection via better-sqlite3          │
│  • Manages multi-monitor placement                   │
└──────────┬───────────────────────────┬───────────────┘
           │ ipcMain / ipcRenderer     │ ipcMain / ipcRenderer
           │ (via contextBridge)       │ (via contextBridge)
┌──────────▼──────────┐   ┌───────────▼────────────────┐
│  Operator Panel      │   │  Projection Window          │
│  (src/renderer/)     │   │  (src/display/)             │
│  • Verse search      │   │  • Full-screen verse text   │
│  • Push to display   │   │  • Receives pushed verse    │
│  • Session controls  │   │  • Blank/show toggle        │
│  • History / Settings│   │  • Theme + font size        │
└──────────────────────┘   └────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────┐
│  SQLite database  (%APPDATA%\BibleCast\biblecast.db)  │
│  Tables: sessions, displayed_verses, translations,    │
│          display_state, settings                      │
└──────────────────────────────────────────────────────┘
```

---

## IPC Channels

All renderer ↔ main communication goes through `preload.js` via `window.biblecast.*`.

| Channel | Direction | Description |
|---|---|---|
| `verse:search` | renderer → main | Search verses by reference or keyword |
| `verse:push` | renderer → main | Push a verse to the projection window |
| `verse:navigate` | renderer → main | Step to next/previous verse (voice commands) |
| `display:update` | main → display | Send verse, blank, settings, or layout update |
| `display:blank` | renderer → main | Blank / unblank the projection window |
| `display:open` | renderer → main | Toggle the HDMI projection window |
| `display:open-ndi` | renderer → main | Open / close the NDI virtual output window |
| `display:layout` | renderer → main | Switch full-screen / lower-third per output |
| `display:list-monitors` | renderer → main | List connected displays |
| `display:set-monitor` | renderer → main | Move projection window to a specific display |
| `session:create` | renderer → main | Start a new named session |
| `session:active` | renderer → main | Get the currently active session |
| `session:list` | renderer → main | Get all past sessions |
| `session:verses` | renderer → main | Get verses logged in a session |
| `settings:get` | renderer → main | Load all settings from DB |
| `settings:save` | renderer → main | Save a single setting to DB |
| `translations:list` | renderer → main | List installed translations |
| `translations:available` | renderer → main | List downloadable translations |
| `translations:download` | renderer → main | Download a translation from getbible.net |
| `translations:import-file` | renderer → main | Import a JSON or XML translation file |
| `translations:ready` | main → renderer | Notify UI that translations have been (re)loaded |
| `whisper:transcribe` | renderer → main | Transcribe a Float32 audio chunk via Whisper AI |
| `whisper:reset` | renderer → main | Clear the cached Whisper pipeline |
| `whisper:set-gpu` | renderer → main | Open / close the WebGPU worker window |
| `whisper:progress` | main → renderer | Whisper model download / load progress |
| `scraper:open` | renderer → main | Open / focus the Bible Gateway scraper popup |
| `scraper:check-python` | scraper → main | Detect Python 3 installation + version |
| `scraper:start` | scraper → main | Start scraping a queue of translations |
| `scraper:cancel` | scraper → main | Kill the active Python scrape process |
| `scraper:progress` | main → scraper | Per-book progress + import result events |
| `background:save-image` | renderer → main | Copy a background image to userData |
| `system:hardware-info` | renderer → main | CPU / GPU info for the Settings panel |
| `ai:summarize` | renderer → main | GPT-3.5 sermon summary (OpenAI) |
| `updates:check` | renderer → main | Check GitHub releases for a newer version |
| `updates:open-release` | renderer → main | Open the release download URL in the browser |
| `nav:settings` | main → renderer | Navigate the operator panel to Settings view |

---

## Database Schema

| Table | Key columns |
|---|---|
| `sessions` | id, name, is_active, created_at, updated_at |
| `displayed_verses` | id, session_id→sessions, reference, book, chapter, verse, translation, displayed_at |
| `display_state` | current_reference, is_visible, translation, font_size, theme |
| `translations` | id, name, abbreviation, language, data (JSON blob of all verse content) |
| `settings` | key, value |

---

## Key Files Reference

| File | What it does |
|---|---|
| [main.js](main.js) | Main process — creates all windows, registers every ipcMain handler, manages DB lifecycle |
| [preload.js](preload.js) | contextBridge — exposes `window.biblecast` typed API to all renderer windows |
| [src/renderer/renderer.js](src/renderer/renderer.js) | Operator panel — verse search, push controls, session UI, Vosk/Whisper capture, settings |
| [src/display/display.js](src/display/display.js) | Projection window — receives `display:update` IPC, renders verse full-screen or lower-third |
| [src/scraper/scraper.js](src/scraper/scraper.js) | Bible Gateway scraper popup — Python detection, translation checklist, real-time progress |
| [scripts/scrape_bible.py](scripts/scrape_bible.py) | Python scraper — uses `meaningless.WebExtractor` to scrape Bible Gateway chapter-by-chapter; outputs NDJSON |
| [src/lib/db.js](src/lib/db.js) | SQLite setup, schema migration on first run, all query functions |
| [src/lib/bible-parser.js](src/lib/bible-parser.js) | Parses scripture references from typed or spoken text input |
| [electron-builder.json](electron-builder.json) | Build config — app ID, NSIS installer, icons, extraResources (scrape_bible.py) |

---

## Windows-specific Notes

- The SQLite database is stored at `%APPDATA%\BibleCast\biblecast.db`. Created automatically on first launch.
- `better-sqlite3` must be rebuilt with `npm run rebuild` after installing or upgrading Electron.
- Multi-monitor display placement uses Electron's `screen.getAllDisplays()` — the projection window is placed on the display with the largest `bounds.x` (rightmost/second monitor).
- NSIS installer uses per-machine install mode (requires UAC elevation). Change in `electron-builder.json` → `nsis.perMachine` to adjust.

---

## Common Issues

| Problem | Fix |
|---|---|
| `better-sqlite3` binding error on launch | Run `npm run rebuild` to rebuild the native addon for Electron's ABI |
| Projection window appears on wrong monitor | Check `screen.getAllDisplays()` output; update monitor selection logic in `main.js` |
| `window.biblecast is not defined` | Ensure `preload.js` is referenced in the `BrowserWindow` `webPreferences.preload` option |
| App window is blank / white | Open DevTools (`Ctrl+Shift+I`) and check console for JS errors |
| Database not found | Verify `app.getPath('userData')` resolves correctly; check `%APPDATA%\BibleCast\` |
| NSIS build fails | Ensure `electron-builder` and icons exist in `assets/icons/`; run `npm run rebuild` first |
| Port already in use | BibleCast does not use a port — all IPC is via Electron channels, not HTTP |
