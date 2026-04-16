# BibleCast — Development Changelog

This file is a historical record of all changes made to the app.
Update this file after every development session or task.

---

## Session: 2026-04-16

### Bible Gateway Scraper
- Added `src/scraper/` — new popup window with a checklist of 29 translations (ESV, NIV, NASB, NKJV, NLT, AMP, CSB, and more)
- Added `scripts/scrape_bible.py` — Python 3 scraper using `meaningless.WebExtractor`
  - Detects and auto-installs `meaningless` pip package if missing
  - Scrapes chapter-by-chapter using known chapter counts for all 66 books
  - Parses Unicode superscript verse numbers from plain strings (verse 1 has no prefix — handled explicitly)
  - Outputs newline-delimited JSON to stdout for real-time Electron progress streaming
- `main.js` — added `createScraperWindow()` and 4 new IPC handlers:
  - `scraper:open` — opens/focuses the popup
  - `scraper:check-python` — detects Python 3 on PATH, returns version + executable path
  - `scraper:start` — spawns Python per translation, streams progress, imports to SQLite on completion
  - `scraper:cancel` — kills the active Python process
- `preload.js` — exposed 5 new scraper APIs to renderers
- `src/renderer/index.html` — added "Bible Gateway Scraper" sub-section in Settings → Bibles
- `src/renderer/renderer.js` — wired up the "Open Bible Gateway Scraper…" button
- `electron-builder.json` — added `scrape_bible.py` as `extraResources` so it bundles in packaged builds

**Bug fixed during session:** Initial script used non-existent `BibleGatewayExtractor` class and `show_verse_numbers` kwarg — corrected to `WebExtractor` with only `show_passage_numbers=True`

### Git Identity
- Removed hardcoded local git override (`BibleCast Dev / dev@biblecast.local`)
- Set global git config to `Jonathan Freiku / 45103626+jnthnfr@users.noreply.github.com`
- Rewrote all 17 commit messages with `git filter-branch` to remove `Co-Authored-By: Claude` trailers
- Force-pushed cleaned history to `jnthnfr/BibleCast`

### Documentation
- `README.md` — full rewrite: complete feature list, both translation sources, updated project structure, prerequisites, tech stack
- `DEVELOPER.md` — updated features table (24 features), full repo layout, expanded IPC channel reference (36 channels)
- `CHANGELOG.md` — created this file

---

## Session: Prior (v1.0.1 and earlier)

> Detailed implementation notes moved here from README / DEVELOPER.md for reference.

### Vosk Real-Time Speech Recognition
- Replaced Web Speech API (broken in Electron) with Vosk via `vosk-browser` WASM
- Added `startVoskCapture()` / `stopVoskCapture()` in `renderer.js`
- Model loaded dynamically from CDN on first use (~45 MB, cached after)
- Partial results shown in transcript as user speaks; final results trigger verse prediction
- Fixed CSP (`main.js`) to allow `blob:` Workers and model download from `ccoreilly.github.io`
- Vosk set as default speech engine; Web Speech API retained as fallback option

### Whisper AI (CPU + GPU)
- Integrated `@xenova/transformers` for local neural network transcription
- Added GPU worker window (`src/whisper/`) — hidden `BrowserWindow` running WebGPU inference
- CPU thread count configurable; auto mode uses half available cores
- Model size selectable: tiny / base / small
- Progress events streamed to operator panel during model download/load

### Scripture Detection & Auto-Projection
- `SCRIPTURE_REF_RE` regex detects spoken/typed references (e.g. "John three sixteen")
- Keyword extraction with stop-word filtering and confidence thresholds (low/medium/high)
- `runPrediction()` tries reference match first, falls back to keyword search
- Auto-projection with configurable cooldown (proj_debounce setting)
- Prediction results shown in "PREDICTED VERSES" panel in right sidebar

### Voice Commands
- Detected in live transcript: next/previous verse, clear/hide screen, show/project verse, repeat
- Toggle in top bar; only active when a session is running

### AI Sermon Summary
- Local mode: keyword frequency extraction, updates as transcript grows
- AI mode: GPT-3.5 via OpenAI API (key stored in settings), triggers every 200 new words
- Refresh button to regenerate on demand

### NDI Virtual Output
- Second `BrowserWindow` (`createNdiWindow()`) renders the same display as the HDMI window
- Borderless, always-on-top, sized at 40% of primary monitor width in 16:9 ratio
- Independently controllable layout (full / lower-third)
- Toggle in Outputs tab

### Display Improvements
- Custom backgrounds: solid colour, gradient (with presets), image upload/URL
- Transition speed slider (0–5 s CSS fade)
- Text colour picker with reset
- Show/hide translation label and verse reference toggles
- Layout mode per output: full-screen or lower-third

### Bible Translation System
- 14 public-domain translations downloadable from getbible.net API
- XML import: supports Holy Bible XML (BIBLEBOOK/VERS), OSIS, and Zefania formats
- Bundled KJV auto-seeded on first launch from `data/translations/kjv.json`
- Translation dropdown refreshes automatically after any import/download

### Sessions & History
- Named sessions with active/inactive state
- All projected verses logged with timestamp and translation
- History view: click a session to see all verses displayed in that service
- Auto-session option: create session automatically on launch

### UI — Operator Panel
- OBS-style layout: STUDIO preview + LIVE OUTPUT side by side
- Resizable splitters between panels
- Right sidebar with Search / Display / Outputs tabs
- Collapsible sections, segmented buttons, slider labels
- Top bar: microphone selector, Start Listening button, Auto-Project and Voice Commands toggles
- Toast notifications for save/import confirmations
- Update banner shown when a new GitHub release is found

### Application
- Update checker polls GitHub releases API 8 s after launch
- Hardware info display (CPU cores + GPU name) in Settings → AI Performance
- Monitor selector in Outputs tab
- Settings persist to SQLite `settings` table; propagate to display windows in real time

---

## Version History

| Version | Date | Notes |
|---|---|---|
| 1.0.1 | 2026-04 | Bible search, scripture detection, hardware acceleration, UI fixes |
| 1.0.0 | 2026-04 | Initial release — verse projection, sessions, multi-monitor, Whisper AI |
