# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Launch app (production mode)
npm run dev            # Launch app (development mode — opens DevTools on operator window)
npm run rebuild        # Rebuild native modules (required after Electron version changes or on new machines)
npm run build          # Package for distribution (Windows installer via electron-builder)
npm run build:portable # Package as a portable .exe (no install)
npm run bundle:kjv     # Pre-bundle KJV JSON into data/translations/ for offline use
```

There are no tests. There is no linter configured.

After any native dependency change, run `npm run rebuild` before starting the app, or `better-sqlite3` will fail to load.

## Architecture

BibleCast is an Electron desktop app for projecting Bible verses in church settings. It has four window types plus a GPU worker:

| Window | File | Purpose |
|--------|------|---------|
| `operatorWindow` | `src/renderer/index.html` + `renderer.js` | Main control panel (always open) |
| `displayWindow` | `src/display/display.html` + `display.js` | HDMI projector output (fullscreen, secondary monitor) |
| `ndiWindow` | same display files, `?ndi=1` query param | Virtual NDI output (borderless, capturable by OBS) |
| `hdmiMirrorWindow` | same display files | Mirror window (no query param) |
| `gpuWorkerWindow` | `src/whisper/whisper-gpu.html` | Hidden Whisper GPU transcription worker |

All windows use the same `preload.js`, which exposes the entire `window.biblecast` API via `contextBridge`. There is no `nodeIntegration` in renderer processes.

### IPC Pattern

All communication follows: `renderer → preload (contextBridge) → ipcMain.handle → main.js → IPC back to windows`.

The main process sends `display:update` events to all open output windows. Output windows call `api.onDisplayUpdate(handleUpdate)` to receive them. The message `type` field determines what to do: `'verse'`, `'blank'`, `'settings'`, `'layout'`.

Settings changes that affect display (font, colors, background, standby, etc.) are broadcast immediately to all open output windows from `registerSettingsHandlers` in `main.js`.

### Key Files

- **`main.js`** — All IPC handler registration, window creation, and app lifecycle. Handlers are grouped into `register*Handlers()` functions called once from `registerIpcHandlers()`.
- **`preload.js`** — The complete surface area of `window.biblecast`. Every IPC channel must be listed here.
- **`src/renderer/renderer.js`** — ~2600-line single-file operator UI. Global state at the top (selected verse, projection state, settings cache, transcription state). Key functions: `pushVerse()`, `stopProjecting()`, `renderProjectionPreview()`, `loadAllSettings()`, `syncDisplayState()`.
- **`src/display/display.js`** — Projection window logic. `applySettings()` drives all visual changes via CSS custom properties. `renderVerse()` adds `.has-verse` to body. `setBlank()` adds `.blanked`. The NDI window is identified at module load by checking `?ndi=1` in the query string.
- **`src/lib/db.js`** — SQLite via `better-sqlite3`. Single-row `display_state` table (id=1) holds live projection state. `settings` table is a flat key/value store. DB lives in Electron `userData` path.

### Display State & Projection Lifecycle

1. `pushVerse()` in renderer → `api.pushVerse()` → main updates `display_state` table, broadcasts `display:update {type:'verse'}` to all output windows.
2. Output windows call `renderVerse()` which sets `body.has-verse` — this is what hides the standby screen via CSS.
3. `api.blankDisplay(true)` → main broadcasts `{type:'blank', visible:false}` → output windows call `setBlank(true)` adding `body.blanked`.
4. The `blank-screen` div (z-index 100) covers everything when `.blanked`. The standby screen (z-index 5) is hidden by `.has-verse` class reducing its opacity to 0.

### Output Windows Lifecycle

- **HDMI display**: opened/closed by the Project button (`pushVerse` / `stopProjecting`) and the hdmi-toggle. Fullscreen on a secondary monitor.
- **NDI window**: opened/closed by the ndi-toggle and by `pushVerse` / `stopProjecting`. Uses `hide()`/`show()` instead of `destroy()`/`create()` so the OS window handle (HWND) stays stable and OBS window capture doesn't lose the source.
- The NDI window's position/size are persisted to the `settings` table (`ndi_win_x/y/w/h`) on move/resize.

### Settings Flow

`loadAllSettings()` in renderer fetches all settings and applies them. Settings that affect display rendering (a specific allowlist in `registerSettingsHandlers`) are forwarded live to all output windows. The operator window maintains a `settings` cache object that the preview renderer reads directly.

### Transcription / Auto-Project

Three transcription paths all funnel interim/final text into the same handler:
1. **Web Speech API** — browser's built-in, runs in-process
2. **Chrome Web Speech Bridge** — spawns system Chrome with a local HTTP server, relays results back
3. **Whisper (CPU/GPU)** — `@xenova/transformers` in main process (CPU) or `gpuWorkerWindow` (GPU via ONNX WebGPU)
4. **Vosk** — WASM model loaded in renderer

Auto-project detects scripture references in transcribed text via `parseReference()` (`src/lib/bible-parser.js`) and triggers `doSearch(true)`.

### Bible Data

Translations are stored as JSON blobs in the `translations` SQLite table. KJV can be bundled offline via `npm run bundle:kjv`. Additional translations are downloaded from `api.getbible.net/v2/` or scraped from Bible Gateway via a Python script (`scripts/scrape_bible.py`).
