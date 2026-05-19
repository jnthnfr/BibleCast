/* BibleCast: shared module-level state for the operator panel
 *
 * Bindings declared here live in the script-level lexical environment
 * shared by every classic <script> in index.html, so renderer.js and
 * any other module can read or assign them by simple name.
 *
 * Transcription engine state (fullTranscript, whisper* fields)
 * lives in modules/transcription.js.
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
  whisper_provider:       'chrome-bridge',
  auto_project_only_on_exact_ref: true,  // strict mode: auto-project only on path-1 reference matches
  lt_template:            'accent-card', // lower-third style: accent-card | broadcast-tab | minimal | classic
  lt_accent_color:        '#e8c97a',     // brand keyline/eyebrow colour for the new templates
};
