# Changelog

All notable changes to BibleCast are documented here.

---

## [1.4.2] — 2026-04-20

### Fixed
- Shared `escapeHtml` utility extracted to `src/lib/utils-browser.js` — duplicate implementations removed from `renderer.js`, `display.js`, and `scraper.js`
- NDI window position/size values validated before use — prevents crash on corrupt settings
- IPC handlers split from a single 800-line function into 10 focused sub-functions
- Windows Chrome executable paths corrected (double-escaped backslashes)
- Renamed internal `settingsLoaded` flag to `startupWindowsOpened` to better reflect its purpose

---

## [1.4.1] — 2026-04-20

### Fixed
- Projection window now reads `preferred_hdmi_monitor` on every open, not just once at launch
- NDI window position and size persisted to DB and restored on next open
- Web Speech API: confidence filter added for low-quality results; `recognition.lang` re-asserted on each restart; non-recoverable errors handled correctly
- Version number on About page now read dynamically from `app.getVersion()`
- In-memory verse cache added in `db.js` — avoids repeated JSON parsing of large translation data
- `verse:navigate` routed through `getTranslationVerses()` with error handling
- Live transcript capped at 60,000 characters via `appendToTranscript()` helper
- AI summary now sends only the last 2,000 words to OpenAI
- Scraper popup cleanup fires on OS window close via `beforeunload`
- Bible Gateway scraper CSS layout misalignment fixed in Settings page

---

## [1.4.0] — 2026-04-19

### Added
- **Standby screen** — upload a church logo or image to show on the projection display when no verse is active; configurable fit and opacity in Settings → Display
- **Lower-third independent settings** — lower-third bar has its own background (solid / gradient / transparent) and auto-fit toggle, separate from fullscreen settings
- **Background picker** — colour swatches and gradient presets available in both the Display tab and Settings panel
- **History click-to-queue** — clicking any verse in the History panel queues it in Studio Preview

### Changed
- Project / Prev / Next buttons moved to the Studio Preview panel
- Stop Projection now closes all active outputs (HDMI, NDI, HDMI Mirror) and unchecks their toggles

### Fixed
- Background type switching now works correctly after uploading an image
- Solid/gradient colour rows no longer disappear after saving settings

---

## [1.3.0] — 2026-04-17

### Added
- **Auto-updates** — `electron-updater` replaces the old manual update checker; updates download in the background with progress and a one-click "Restart & Install" prompt
- Update checked automatically 10 s after launch (packaged builds only); manual check available in Settings

### Fixed
- Live "LIVE" badge only activates when a verse is actively projected, not when the display is open but blank
- Session name input auto-fills with current date/time on click
- Local background image file paths now load correctly in the projection window (CSP fix)
- Background image setting in Settings tab now syncs with the Display tab
- Translation abbreviations no longer overlap names in the scraper popup; count label updates dynamically; footnote markers (`[a]`, `[b]`) stripped from verse text
- App icon updated to a proper multi-resolution `.ico` file (taskbar, Start Menu, installer)

### Infrastructure
- GitHub Actions CI/CD — builds and publishes releases automatically on version tag push

---

## [1.2.0] — 2026-04

### Added
- **HDMI Mirror window** — second operator-facing window mirroring the projection output
- **Layout-aware auto-fit** — font size scales automatically for both fullscreen and lower-third layouts

### Fixed
- Display sync fixes
- Live preview flash removed
- Font size dropdown replaced with slider
- Reference text styling improvements

---

## [1.1.4] — 2026-04-16

### Added
- **Chrome Web Speech Bridge** — "Web Speech API" option spawns a hidden Chrome instance running `webkitSpeechRecognition` and pipes results back via a local HTTP server on `127.0.0.1`; no new npm dependencies; Chrome killed on Stop and on quit

---

## [1.1.3] — 2026-04-16

### Changed
- Pressing Enter in the manual search box now searches and immediately projects the top result; first result highlighted as selected

---

## [1.1.2] — 2026-04-16

### Changed
- Vosk model (`vosk-model-small-en-us-0.15`, 39 MB) bundled with the app — no internet download required on first use

---

## [1.1.1] — 2026-04-16

### Fixed
- Projection window closed via OS no longer leaves a stale open flag
- Update checker pointed at correct GitHub owner/repo
- HDMI auto-open race condition on first launch resolved
- Vosk packaging hardened in `electron-builder.json`
- Whisper stop no longer discards the last audio chunk
- Python scraper pinned to `meaningless>=0.9`; errors if fewer than 100 verses returned
- Keyword prediction now includes 3-letter theological words (sin, God, law)
- Display sync always updates live canvas from DB
- `bible-parser.js` wired into `verse:search` IPC handler
- Settings save no longer re-opens HDMI/NDI windows
- Readable error dialog shown if `better-sqlite3` fails to load

---

## [1.1.0] — 2026-04-16

### Added
- **Bible Gateway Scraper** — popup with checklist of 29 translations (ESV, NIV, NASB, NKJV, NLT, AMP, CSB, and more); Python 3 scraper using `meaningless`; streams progress to Electron in real time
- **Vosk STT** — offline WASM speech recognition; model bundled with app
- **NDI virtual output** — second output window for OBS/broadcast mixing
- **GPU Whisper** — WebGPU inference in a hidden worker window
- **Custom backgrounds** — solid colour, gradient (with presets), image upload/URL
- **Transition speed** — slider for CSS fade duration
- **Text styling** — colour picker, show/hide translation label and reference
- **Layout modes** — full-screen or lower-third per output window

---

## [1.0.1] — 2026-04

### Added
- Verse search by reference or keyword
- Scripture detection pipeline
- Hardware acceleration info panel

### Fixed
- Various UI fixes

---

## [1.0.0] — 2026-04

### Initial release
- Verse projection to HDMI output
- Sessions and history logging
- Multi-monitor support
- Whisper AI integration (CPU)
- 14 public-domain translations downloadable in-app
- XML import (Holy Bible XML, OSIS, Zefania)
- Bundled KJV auto-seeded on first launch
- AI sermon summary via OpenAI API
- Voice commands (next / previous / clear / repeat)
- Operator panel layout
