# Changelog

All notable changes to BibleCast are documented here.

---

## [1.4.4] — 2026-05-07

Stability release covering issues found during a v1.4.3 field test plus a
codebase-wide audit. No new features; the focus is on lifecycle correctness.

### Fixed: false auto-projections from verbatim quoting

- **Strict auto-project mode** (default on). Auto-project now only fires when the speaker actually says an explicit reference (e.g. "John three sixteen"). Verses that match by keyword overlap still appear in the predictions list but no longer project on their own. Toggle in Settings → Scripture Detection → "Only auto-project on explicit references".

### Fixed: app freeze on engine or translation change mid-session

- **Transcription engine swap.** Changing the speech engine while listening previously left the original engine running (mic held, audio graph live, Web Speech `onend` auto-restart conflicting with the new engine). All four engines are now stopped via a single `stopActiveTranscription` helper, and the Settings change handler stops the running engine and asks the operator to click Start again.
- **Translation swap.** Changing the active translation could stall the operator panel for 1-3 seconds the first time the new translation was used, while the main process synchronously parsed the multi-MB JSON blob. The renderer now pre-warms the verse cache via a new `translations:warm` IPC when the dropdown changes, so the freeze lands on the deliberate click instead of the next mid-sermon auto-projection.

### Fixed: Electron lifecycle and resource leaks

- **`webContents.send` to destroyed windows.** All 39 IPC sends in `main.js` now route through a `safeSend(win, channel, payload)` helper that checks `isDestroyed()` and try/catches the underlying call, so a window closed via the OS chrome no longer surfaces unhandled rejections in the renderer.
- **GPU worker exit drain.** When `gpuWorkerWindow` exits (WebGPU init failure, model crash), in-flight `pendingGpuRequests` are now settled immediately with a clear error instead of waiting 30 seconds for the per-call timeout.
- **Display toggle race.** A re-entrancy lock on `display:open` prevents a second click during the ~100-300 ms init window from destroying a half-loaded display.
- **Web Speech `onend` cross-engine auto-restart.** The guard tightened from "not whisper-local" to "is web-speech": the previous wording let Web Speech auto-restart while Vosk was the active provider.
- **Web Speech persistent-error path.** Now drains all engines via `stopActiveTranscription`; previously left the recognition object alive and its `onend` handler kept retrying.
- **Whisper flush re-entrancy.** A single transcribe taking longer than the 3 s flush interval used to queue parallel in-flight calls. Now gated by an `_whisperFlushing` flag.
- **`startWhisperCapture` partial-init.** Partial state from a failed init (mic acquired but AudioContext threw) is now cleaned up via `stopWhisperCapture`.

### Changed: verse cache is now bounded

- **Bounded LRU.** Capacity 4 entries; on miss-when-full the least-recently-used translation is evicted. The cached array is `Object.freeze`'d so callers can't accidentally mutate it.
- **Translation persistence progress.** The Bible Gateway scraper popup now shows a "persisting" status during the synchronous `JSON.stringify` + `INSERT` that finalizes a scraped translation, instead of appearing to freeze for 1-2 seconds at the end.

### Internal

The operator-panel renderer was split from a 2925-line monolith into 14 focused modules under `src/renderer/modules/`:

- `state`, `utils-renderer`, `bible-data`, `bible-browser`, `sessions`, `voice-commands`, `summary`, `transcription`, `search`, `projection-preview`, `display-output`, `settings`, `translations`, `updater`

Modules load as classic `<script>` tags in `index.html`; top-level declarations live in a single shared script-level lexical environment, so cross-module references resolve by name without imports. `renderer.js` is now a 901-line orchestrator carrying `init`, `bindEvents`, the bootstrap helpers, and the `DOMContentLoaded` entry point. The full module map is in `BibleCast/src/renderer/renderer.js` at the top of the file.

This release also includes the 7 audit fixes (B1, B2, B4, B6, B9, B10, B11) shipped earlier on `main`:

- B1 — added missing `vosk:read-model` IPC handler (Vosk picker hung indefinitely without it)
- B2 — `addTranslation` upserts via `ON CONFLICT(abbreviation) DO UPDATE` so the row id is stable across re-imports
- B4 — `escapeHtml` unified across browser and node, null-guarded, apostrophe escaped
- B6 — `throttle` rewritten to standard leading + trailing pattern (was leaking trailing timers)
- B9 — Chrome bridge HTTP listener now closes on `chrome:stop-bridge`
- B10 — `before-quit` handler consolidated (was registered in two places)
- B11 — Whisper GPU results routed by per-call `requestId` to prevent cross-call mis-routing

---

## [1.4.3] — 2026-05-03

### Added
- NDI mirroring across panels
- Resizable layout panels (transcript panel, Bible browser)
- Following-verses toggle in settings

### Fixed
- Bible Gateway scraper layout misalignment in Settings page

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
