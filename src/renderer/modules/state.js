/* BibleCast: shared module-level state for the operator panel
 *
 * Bindings declared here live in the script-level lexical environment
 * shared by every classic <script> in index.html, so renderer.js and
 * any other module can read or assign them by simple name.
 *
 * Transcription engine state (recognition, fullTranscript, vosk* and
 * whisper* fields) intentionally stays in renderer.js for now and will
 * move when the transcription module is extracted in a later step.
 */

// IPC bridge into the main process. Exposed by preload.js as
// contextBridge.exposeInMainWorld('biblecast', {...}).
const api = window.biblecast;

// ── Control flags ─────────────────────────────────────────────────────────────

let selectedVerse  = null;  // currently picked verse (object or null)
let isBlank        = false; // display blanked flag
let isProjecting   = false; // display currently showing a verse
let searchTimeout  = null;  // debounce timer for search input
let lastProjectedAt = 0;    // timestamp of last auto-projection

// ── Output window state ───────────────────────────────────────────────────────

let displayWindowOpen   = false; // HDMI display window open flag
let hdmiMirrorOpen      = false; // HDMI mirror window open flag
// Guard so NDI/HDMI windows auto-open only on first settings load,
// not on every settings save thereafter.
let startupWindowsOpened = false;

// ── Settings cache ────────────────────────────────────────────────────────────
// Loaded once at startup and kept in sync with the DB by loadAllSettings
// and saveAllSettings (in renderer.js for now).

let settings = {
  auto_project:           false,
  confidence:             'medium',
  require_session:        true,
  debounce_ms:            1500,
  proj_debounce:          5,
  autostart_transcription: false,
  theme:                  'dark',
  font_size:              '100',
  font_family:            'Georgia, serif',
  custom_font_family:     '',
  show_translation:       true,
  show_reference:         true,
  whisper_provider:       'web-speech',
};
