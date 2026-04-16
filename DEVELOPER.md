# BibleCast — Developer Guide

> For full change history see [CHANGELOG.md](CHANGELOG.md)

---

## Stack

| Layer | Technology |
|---|---|
| Desktop | Electron 32 |
| UI | HTML / CSS / Vanilla JS |
| Database | SQLite via better-sqlite3 |
| Speech (real-time) | Vosk via vosk-browser WASM |
| Speech (accurate) | Whisper AI via @xenova/transformers |
| Bible scraper | Python 3 + meaningless |
| Build | electron-builder (NSIS) |

---

## Project Structure

```
BibleCast/
├── main.js                  # Main process — windows, IPC, DB
├── preload.js               # contextBridge — window.biblecast API
├── src/
│   ├── renderer/            # Operator panel
│   ├── display/             # Projection window + NDI output
│   ├── scraper/             # Bible Gateway scraper popup
│   └── whisper/             # GPU worker window
├── src/lib/
│   ├── db.js                # SQLite schema + queries
│   └── bible-parser.js      # Scripture reference parser
├── scripts/
│   ├── launch.js            # npm start wrapper
│   ├── scrape_bible.py      # Python Bible Gateway scraper
│   ├── bundle-kjv.js        # Bundles KJV into data/
│   └── download-translations.js
├── data/translations/       # Bundled KJV (auto-seeded on first launch)
├── assets/icons/
└── electron-builder.json
```

---

## Dev Setup

```bash
npm install
npm run rebuild   # recompile better-sqlite3 for Electron ABI
npm start         # launch with DevTools
```

Re-run `npm run rebuild` after any Electron version upgrade.

---

## Key Scripts

| Command | Description |
|---|---|
| `npm start` | Launch in dev mode |
| `npm run rebuild` | Rebuild native modules |
| `npm run build` | Build NSIS installer |
| `npm run bundle:kjv` | Bundle KJV into data/translations/ |
| `npm run download` | Download all public-domain translations |

---

## IPC Channels

All communication goes through `preload.js` via `window.biblecast.*`.

| Channel | Description |
|---|---|
| `verse:search` | Search by reference or keyword |
| `verse:push` | Push verse to display windows |
| `verse:navigate` | Next / previous verse |
| `display:update` | Verse, blank, settings, or layout update → display |
| `display:blank` | Blank / unblank output |
| `display:open` | Toggle HDMI window |
| `display:open-ndi` | Toggle NDI window |
| `display:layout` | Full-screen / lower-third |
| `display:list-monitors` | List connected displays |
| `display:set-monitor` | Move projection to a display |
| `session:create/active/list/verses` | Session CRUD |
| `settings:get/save` | Settings read/write |
| `translations:list/available/download/import-file` | Translation management |
| `translations:ready` | Notify UI to reload translation list |
| `whisper:transcribe/reset/set-gpu/progress` | Whisper AI pipeline |
| `scraper:open/check-python/start/cancel/progress` | Bible Gateway scraper |
| `background:save-image` | Copy bg image to userData |
| `system:hardware-info` | CPU/GPU info |
| `ai:summarize` | GPT-3.5 sermon summary |
| `updates:check/open-release` | Update checker |
| `nav:settings` | Navigate operator panel to Settings |

---

## Database

Location: `%APPDATA%\BibleCast\biblecast.db`

| Table | Key columns |
|---|---|
| `sessions` | id, name, is_active, created_at |
| `displayed_verses` | session_id, reference, book, chapter, verse, translation, displayed_at |
| `translations` | name, abbreviation, language, data (JSON blob) |
| `display_state` | current_reference, current_text, is_visible, translation |
| `settings` | key, value |

---

## Common Issues

| Problem | Fix |
|---|---|
| `better-sqlite3` binding error | Run `npm run rebuild` |
| Projection on wrong monitor | Change monitor in Outputs tab |
| `window.biblecast` undefined | Check `preload.js` is set in `webPreferences` |
| Scraper returns 0 verses | Ensure Python 3 is on PATH; check `meaningless` installed |
| NSIS build fails | Run `npm run rebuild` first; check icons exist in `assets/icons/` |
