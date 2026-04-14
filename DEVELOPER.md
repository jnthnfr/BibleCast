# BibleCast — Developer Guide

## Overview

BibleCast is a Windows desktop application for church presenters. The operator searches for Bible verses by reference or keyword and projects them full-screen on a second monitor (HDMI output) during preaching. The operator controls everything from a dedicated panel on the primary screen.

---

## Features

| Feature | Description |
|---|---|
| **Verse search** | Search by reference (e.g. "John 3:16") or keyword; results appear instantly from a local SQLite database |
| **Projection window** | A second Electron window on the second monitor displays the verse in full-screen format, updated via Electron IPC |
| **Multiple translations** | Switch between Bible translations at runtime; translations stored in SQLite |
| **Manual push** | Operator selects a verse and pushes it to the display with one click |
| **Display control** | Show/hide the projection overlay, blank screen between verses |
| **Presentation mode** | Step through a pre-selected list of verses sequentially |
| **Session management** | Each service is tracked as a named session; all displayed verses are logged per session |
| **History view** | Browse past sessions and all displayed verses |
| **Settings** | Configurable display font size, theme, background colour, overlay style |
| **Graceful shutdown** | Projection window and database connections are cleanly closed on app exit |

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
│   ├── display/             # Projection window (second monitor)
│   │   ├── display.html     # Full-screen verse display entry point
│   │   ├── display.js       # Display window logic (receives IPC pushes)
│   │   └── display.css      # Projection styles (large text, themes)
│   └── lib/                 # Shared utilities (main process)
│       ├── db.js            # SQLite connection, schema init, query helpers
│       ├── bible-parser.js  # Reference parsing ("John 3:16" → { book, chapter, verse })
│       └── session.js       # Session create/read/update helpers
├── data/
│   └── translations/        # Bundled Bible translation JSON files (KJV, NIV, etc.)
├── assets/
│   └── icons/               # App icons (.ico, .png)
├── package.json
├── electron-builder.json    # Installer / distribution config
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
| `display:show` | main → display | Send verse text + metadata to projection window |
| `display:blank` | renderer → main | Blank / unblank the projection window |
| `session:create` | renderer → main | Start a new named session |
| `session:log` | main (internal) | Log a displayed verse to the current session |
| `session:list` | renderer → main | Get all past sessions |
| `settings:get` | renderer → main | Load settings from DB |
| `settings:save` | renderer → main | Save settings to DB |

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
| [main.js](main.js) | Main process — opens windows, registers all ipcMain handlers, manages DB lifecycle |
| [preload.js](preload.js) | contextBridge — exposes `window.biblecast` typed API; no direct Node access in renderers |
| [src/renderer/renderer.js](src/renderer/renderer.js) | Operator panel logic — verse search, push controls, session UI |
| [src/display/display.js](src/display/display.js) | Projection window — receives `display:show` IPC, renders verse full-screen |
| [src/lib/db.js](src/lib/db.js) | SQLite setup, schema migration on first run, all query functions |
| [src/lib/bible-parser.js](src/lib/bible-parser.js) | Parses scripture references from text input |
| [electron-builder.json](electron-builder.json) | Build config — app ID, NSIS installer, icons, file exclusions |

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
