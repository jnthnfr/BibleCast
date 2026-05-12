/* BibleCast: settings load, save, reset, and live-update
 *
 * The largest single module in the operator panel. Owns:
 *
 *   loadAllSettings    Reads every setting from the DB on startup and
 *                      pokes 50+ DOM controls; also auto-opens NDI and
 *                      HDMI-mirror windows on first launch (gated by
 *                      the startupWindowsOpened state flag).
 *   loadSettingsView   Populates the Settings tab when first opened,
 *                      including hardware-info text and the bibles list.
 *   saveAllSettings    Persists the Settings tab values, reloads the
 *                      cache, toasts, and switches back to the control view.
 *   saveDisplaySettings + liveDisplaySettings
 *                      Persists the Display sidebar values; the live
 *                      wrapper debounces by 300 ms so colour-pickers
 *                      and sliders don't hammer the DB.
 *   resetDefaults      Restores settings to a baseline and reloads the
 *                      Settings tab.
 *
 * Plus the small DOM-helper pairs used everywhere:
 *
 *   setSelectVal / getSelectVal       <select>
 *   setCheckbox  / getCheckbox        <input type=checkbox>
 *   setInputVal  / getInputVal        <input type=text|color|...>
 *   setSlider    / getSliderVal       <input type=range> + its label
 *   setActiveSegBtn / getActiveSegBtn .seg-btn group
 *
 * Cross-module references (resolve at call time once classic <script>
 * tags have parsed):
 *
 *   settings, api, startupWindowsOpened, hdmiMirrorOpen   (state)
 *   showToast                                             (utils-renderer)
 *   switchView, loadMicrophones                           (still in renderer.js)
 *   refreshInstalledList, renderAvailableList             (translations)
 */

async function loadAllSettings() {
  const s  = await api.getSettings();
  if (!s.whisper_provider) {
    s.whisper_provider = 'web-speech';
    api.saveSetting('whisper_provider', 'web-speech');
  }
  settings = { ...settings, ...s };

  // Sync auto-project toggle in top bar
  const apToggle = document.getElementById('auto-project-toggle');
  if (apToggle) apToggle.checked = settings.auto_project === 'true';

  // Sync voice cmds toggle in top bar
  const vcToggle = document.getElementById('voice-cmds-toggle');
  if (vcToggle) vcToggle.checked = settings.voice_cmds === 'true';

  // Sync right sidebar Display pane
  const themeEl = document.getElementById('setting-theme');
  if (themeEl && s.theme) themeEl.value = s.theme;

  const fontEl = document.getElementById('setting-font-size');
  if (fontEl && s.font_size) {
    fontEl.value = s.font_size;
    const fontLbl = document.getElementById('display-font-size-val');
    if (fontLbl) fontLbl.textContent = s.font_size + 'px';
  }

  const colorEl = document.getElementById('setting-text-color');
  if (colorEl && s.text_color) colorEl.value = s.text_color;

  const transEnabledEl = document.getElementById('setting-transition-enabled');
  const transEnabled   = s.transition_enabled !== 'false';
  if (transEnabledEl) transEnabledEl.checked = transEnabled;

  const transEl  = document.getElementById('setting-transition-speed');
  const transLbl = document.getElementById('transition-speed-val');
  const transRow = document.getElementById('transition-speed-row');
  if (transEl && s.transition_speed) {
    transEl.value = s.transition_speed;
    if (transLbl) transLbl.textContent = parseFloat(s.transition_speed).toFixed(1) + 's';
  }
  if (transRow) transRow.style.opacity = transEnabled ? '1' : '0.4';
  if (transEl)  transEl.disabled = !transEnabled;

  const autofitEl = document.getElementById('setting-autofit-text');
  if (autofitEl) autofitEl.checked = s.auto_fit_text !== 'false'; // default true

  const ltAutofitEl = document.getElementById('setting-lt-autofit-text');
  if (ltAutofitEl) ltAutofitEl.checked = s.lt_auto_fit_text !== 'false'; // default true

  // Lower-third bar background
  if (s.lt_bg_type) setActiveSegBtn('lt-bg-type', s.lt_bg_type);
  const ltBgColorEl = document.getElementById('setting-lt-bg-color');
  if (ltBgColorEl && s.lt_bg_color) ltBgColorEl.value = s.lt_bg_color;
  const ltOpacityEl  = document.getElementById('setting-lt-bg-opacity');
  const ltOpacityLbl = document.getElementById('lt-bg-opacity-val');
  if (ltOpacityEl && s.lt_bg_opacity != null) {
    const pct = Math.round(parseFloat(s.lt_bg_opacity) * 100);
    ltOpacityEl.value = pct;
    if (ltOpacityLbl) ltOpacityLbl.textContent = pct + '%';
  }
  const ltGradSEl = document.getElementById('setting-lt-bg-grad-start');
  if (ltGradSEl && s.lt_bg_gradient_start) ltGradSEl.value = s.lt_bg_gradient_start;
  const ltGradEEl = document.getElementById('setting-lt-bg-grad-end');
  if (ltGradEEl && s.lt_bg_gradient_end) ltGradEEl.value = s.lt_bg_gradient_end;

  const ltBgType = s.lt_bg_type || 'solid';
  const ltSolidRow = document.getElementById('lt-bg-solid-row');
  const ltGradRow  = document.getElementById('lt-bg-gradient-row');
  if (ltSolidRow) ltSolidRow.style.display = ltBgType === 'solid'    ? 'block' : 'none';
  if (ltGradRow)  ltGradRow.style.display  = ltBgType === 'gradient' ? 'block' : 'none';

  // Reference text style
  const refColorEl = document.getElementById('setting-ref-color');
  if (refColorEl) refColorEl.value = s.ref_color || '#e8c97a';
  const refSizeEl  = document.getElementById('setting-ref-size');
  const refSizeLbl = document.getElementById('ref-size-val');
  if (refSizeEl) {
    const pct = Math.round((parseFloat(s.ref_size_ratio) || 0.45) * 100);
    refSizeEl.value = pct;
    if (refSizeLbl) refSizeLbl.textContent = pct + '%';
  }

  if (s.bg_type) setActiveSegBtn('rs-bg-type', s.bg_type);

  // Restore bg color pickers
  const bgColorEl = document.getElementById('setting-bg-color');
  if (bgColorEl && s.bg_color) bgColorEl.value = s.bg_color;
  const bgGradS = document.getElementById('setting-bg-grad-start');
  if (bgGradS && s.bg_gradient_start) bgGradS.value = s.bg_gradient_start;
  const bgGradE = document.getElementById('setting-bg-grad-end');
  if (bgGradE && s.bg_gradient_end) bgGradE.value = s.bg_gradient_end;

  const bgUrlEl = document.getElementById('setting-bg-image-url');
  if (bgUrlEl && s.bg_image_url) bgUrlEl.value = s.bg_image_url;

  // Show the correct bg sub-row, fall back to solid if image type has no URL
  const bgType = (s.bg_type === 'image' && !s.bg_image_url) ? 'solid' : (s.bg_type || 'solid');
  if (bgType !== s.bg_type) setActiveSegBtn('rs-bg-type', bgType);
  const solidRow = document.getElementById('bg-solid-row');
  const gradRow  = document.getElementById('bg-gradient-row');
  const imgRow   = document.getElementById('bg-image-row');
  if (solidRow) solidRow.style.display = bgType === 'solid'    ? 'flex'  : 'none';
  if (gradRow)  gradRow.style.display  = bgType === 'gradient' ? 'block' : 'none';
  if (imgRow)   imgRow.style.display   = bgType === 'image'    ? 'block' : 'none';

  // Restore HDMI toggle, default OFF on launch
  const hdmiToggle = document.getElementById('hdmi-toggle');
  if (hdmiToggle) {
    const hdmiEnabled = s.hdmi_enabled === 'true'; // default false, display starts off
    hdmiToggle.checked = hdmiEnabled;
  }

  // Restore NDI toggle and re-open NDI window if it was enabled (only on first
  // load). After startup, never overwrite the toggle from DB: the live checkbox
  // state is authoritative, so saveAllSettings -> loadAllSettings cycles don't
  // clobber it.
  const ndiToggle = document.getElementById('ndi-toggle');
  if (ndiToggle && !startupWindowsOpened) {
    const ndiEnabled = s.ndi_enabled === 'true';
    ndiToggle.checked = ndiEnabled;
    if (ndiEnabled) await api.openNdiDisplay(true);
  }

  // Restore HDMI mirror toggle (Display Settings pane)
  const hdmiMirrorToggle = document.getElementById('hdmi-mirror-toggle');
  if (hdmiMirrorToggle) {
    const mirrorEnabled = s.hdmi_mirror_enabled === 'true';
    hdmiMirrorToggle.checked = mirrorEnabled;
    hdmiMirrorOpen = mirrorEnabled;
    if (!startupWindowsOpened && mirrorEnabled) await api.openHdmiMirror(true);
  }

  // Restore HDMI layout button
  if (s.hdmi_layout) setActiveSegBtn('hdmi-layout', s.hdmi_layout);
  if (s.ndi_layout)  setActiveSegBtn('ndi-layout',  s.ndi_layout);

  // Restore saved panel heights
  if (s.transcript_panel_height) {
    const tp = document.querySelector('.transcript-panel');
    if (tp) tp.style.height = s.transcript_panel_height + 'px';
  }
  if (s.bible_browser_height) {
    const bb = document.getElementById('bible-browser-wrap');
    if (bb) bb.style.height = s.bible_browser_height + 'px';
  }

  startupWindowsOpened = true;
}

async function loadSettingsView() {
  const s = await api.getSettings();

  // Transcription & Audio
  setSelectVal('setting-whisper-provider', s.whisper_provider || 'web-speech');
  setSelectVal('setting-whisper-model',    s.whisper_model    || 'Xenova/whisper-base.en');
  setSelectVal('setting-whisper-threads',  s.whisper_threads  || 'auto');
  setCheckbox('setting-whisper-gpu',       s.whisper_gpu === 'true');
  setCheckbox('setting-ai-summary',        s.ai_summary === 'true');

  // Populate hardware info
  api.getHardwareInfo().then(hw => {
    const el = document.getElementById('hardware-info-text');
    if (el) el.textContent = `${hw.cpuCores}-core ${hw.cpuModel.split('@')[0].trim()} · ${hw.gpuName}`;
  }).catch(() => {});
  setInputVal('setting-openai-key',        s.openai_api_key || '');
  setSelectVal('setting-ai-provider',      s.ai_summary_provider || 'openai');
  setInputVal('setting-anthropic-key',     s.anthropic_api_key || '');
  setSelectVal('setting-claude-model',     s.claude_model || 'claude-haiku-4-5');
  // Show/hide model row based on provider
  const modelRow = document.getElementById('whisper-model-row');
  if (modelRow) modelRow.style.display = (s.whisper_provider === 'whisper-local') ? 'flex' : 'none';
  applyAiProviderVisibility(
    s.ai_summary === 'true',
    s.ai_summary_provider === 'claude' ? 'claude' : 'openai',
  );
  setSelectVal('setting-speech-quality',      s.speech_quality);
  setCheckbox('setting-autostart-transcription', s.autostart_transcription === 'true');
  setSlider('setting-debounce',      'setting-debounce-val',      s.debounce_ms || '1500',  v => (v/1000).toFixed(1)+'s');
  // Scripture Detection
  setCheckbox('setting-auto-project',    s.auto_project === 'true');
  setSelectVal('setting-confidence',     s.confidence);
  setCheckbox('setting-require-session', s.require_session !== 'false');
  setCheckbox('setting-strict-auto-project', s.auto_project_only_on_exact_ref !== 'false');
  setSlider('setting-proj-debounce', 'setting-proj-debounce-val', s.proj_debounce || '5',    v => v+'s');
  // Display
  setSelectVal('settings-theme',       s.theme);
  setSlider('settings-font-size', 'settings-font-size-val', s.font_size || '64', v => v + 'px');
  setSelectVal('settings-font-family', s.font_family || 'Georgia, serif');
  setInputVal('setting-custom-font', s.custom_font_family || '');
  const customRow = document.getElementById('custom-font-row');
  if (customRow) customRow.style.display = (s.font_family === 'custom') ? 'flex' : 'none';
  setCheckbox('setting-show-translation', s.show_translation !== 'false');
  setCheckbox('setting-show-reference',   s.show_reference   !== 'false');
  // Projection background, wired to same keys as Display tab
  const bgTypeForStandby = s.bg_type || 'solid';
  setActiveSegBtn('standby-bg-type', bgTypeForStandby);
  const sbSolidRow = document.getElementById('standby-bg-solid-row');
  const sbGradRow  = document.getElementById('standby-bg-gradient-row');
  const sbUrlRow   = document.getElementById('standby-bg-url-row');
  if (sbSolidRow) sbSolidRow.style.display = bgTypeForStandby === 'solid'    ? 'flex'  : 'none';
  if (sbGradRow)  sbGradRow.style.display  = bgTypeForStandby === 'gradient' ? 'block' : 'none';
  if (sbUrlRow)   sbUrlRow.style.display   = bgTypeForStandby === 'image'    ? 'block' : 'none';
  setInputVal('setting-standby-bg-color',      s.bg_color          || '#000000');
  setInputVal('setting-standby-bg-grad-start', s.bg_gradient_start || '#0a1628');
  setInputVal('setting-standby-bg-grad-end',   s.bg_gradient_end   || '#1a3a5c');
  setInputVal('setting-standby-url',           s.bg_image_url      || '');

  // Standby screen
  const standbyType = s.standby_type || 'none';
  setActiveSegBtn('standby-screen-type', standbyType);
  const standbyOpts = document.getElementById('standby-image-options');
  if (standbyOpts) standbyOpts.style.display = standbyType === 'image' ? 'block' : 'none';
  setInputVal('setting-standby-image-url', s.standby_image_url || '');
  setActiveSegBtn('standby-image-fit', s.standby_image_fit || 'contain');
  const standbyOpacityEl  = document.getElementById('setting-standby-image-opacity');
  const standbyOpacityLbl = document.getElementById('standby-opacity-val');
  const standbyOpacityPct = parseInt(s.standby_image_opacity ?? 100);
  if (standbyOpacityEl) standbyOpacityEl.value = standbyOpacityPct;
  if (standbyOpacityLbl) standbyOpacityLbl.textContent = standbyOpacityPct + '%';
  // Session
  setInputVal('setting-default-session-name', s.default_session_name || 'Sunday Morning Service');
  setCheckbox('setting-auto-session',      s.auto_session      === 'true');
  setCheckbox('setting-clear-transcript',  s.clear_transcript  === 'true');
  // Application
  setCheckbox('setting-show-shortcuts',  s.show_shortcuts  === 'true');
  setCheckbox('setting-show-following',  s.show_following  !== 'false');

  // Refresh bibles lists in settings
  const installed = await api.listTranslations();
  refreshInstalledList(installed);
  renderAvailableList();

  // Refresh mic list
  await loadMicrophones();
}

// Show only the relevant API key / model rows for the current AI provider.
// Hides everything when the AI-summary toggle is off.
function applyAiProviderVisibility(aiEnabled, provider) {
  const providerRow = document.getElementById('ai-provider-row');
  const openaiRow   = document.getElementById('openai-key-row');
  const anthRow     = document.getElementById('anthropic-key-row');
  const modelRow    = document.getElementById('claude-model-row');
  const isClaude    = provider === 'claude';
  if (providerRow) providerRow.style.display = aiEnabled                  ? 'flex' : 'none';
  if (openaiRow)   openaiRow.style.display   = aiEnabled && !isClaude     ? 'flex' : 'none';
  if (anthRow)     anthRow.style.display     = aiEnabled &&  isClaude     ? 'flex' : 'none';
  if (modelRow)    modelRow.style.display    = aiEnabled &&  isClaude     ? 'flex' : 'none';
}

async function saveAllSettings() {
  const theme    = document.getElementById('settings-theme')?.value;
  const fontSize = document.getElementById('settings-font-size')?.value;

  const pairs = [
    ['whisper_provider',        getSelectVal('setting-whisper-provider')],
    ['whisper_model',           getSelectVal('setting-whisper-model')],
    ['whisper_threads',         getSelectVal('setting-whisper-threads') || 'auto'],
    ['whisper_gpu',             getCheckbox('setting-whisper-gpu')],
    ['ai_summary',              getCheckbox('setting-ai-summary')],
    ['ai_summary_provider',     getSelectVal('setting-ai-provider') || 'openai'],
    ['openai_api_key',          getInputVal('setting-openai-key')],
    ['anthropic_api_key',       getInputVal('setting-anthropic-key')],
    ['claude_model',            getSelectVal('setting-claude-model') || 'claude-haiku-4-5'],
    ['speech_quality',          getSelectVal('setting-speech-quality')],
    ['autostart_transcription', getCheckbox('setting-autostart-transcription')],
    ['debounce_ms',             getSliderVal('setting-debounce')],
    ['auto_project',            getCheckbox('setting-auto-project')],
    ['confidence',              getSelectVal('setting-confidence')],
    ['require_session',         getCheckbox('setting-require-session')],
    ['auto_project_only_on_exact_ref', getCheckbox('setting-strict-auto-project')],
    ['proj_debounce',           getSliderVal('setting-proj-debounce')],
    ['theme',                   theme || 'dark'],
    ['font_size',               fontSize || '64'],
    ['font_family',             document.getElementById('settings-font-family')?.value || 'Georgia, serif'],
    ['custom_font_family',      document.getElementById('setting-custom-font')?.value],
    ['show_translation',        getCheckbox('setting-show-translation')],
    ['show_reference',          getCheckbox('setting-show-reference')],
    ['bg_type',                 getActiveSegBtn('standby-bg-type')],
    ['bg_color',                getInputVal('setting-standby-bg-color')      || '#000000'],
    ['bg_gradient_start',       getInputVal('setting-standby-bg-grad-start') || '#0a1628'],
    ['bg_gradient_end',         getInputVal('setting-standby-bg-grad-end')   || '#1a3a5c'],
    ['bg_image_url',            getInputVal('setting-standby-url')],
    ['standby_type',            getActiveSegBtn('standby-screen-type')       || 'none'],
    ['standby_image_url',       getInputVal('setting-standby-image-url')     || ''],
    ['standby_image_fit',       getActiveSegBtn('standby-image-fit')         || 'contain'],
    ['standby_image_opacity',   getSliderVal('setting-standby-image-opacity') || '100'],
    ['default_session_name',    getInputVal('setting-default-session-name')],
    ['auto_session',            getCheckbox('setting-auto-session')],
    ['clear_transcript',        getCheckbox('setting-clear-transcript')],
    ['show_shortcuts',          getCheckbox('setting-show-shortcuts')],
    ['show_following',          getCheckbox('setting-show-following')],
  ];

  for (const [k, v] of pairs) {
    if (v !== null && v !== undefined) await api.saveSetting(k, String(v));
  }

  // Reload settings cache
  await loadAllSettings();
  showToast('Settings saved');
  switchView('control');
}

async function saveDisplaySettings() {
  const theme      = document.getElementById('setting-theme')?.value;
  const fontSize   = document.getElementById('setting-font-size')?.value;
  const fontFamily = document.getElementById('settings-font-family')?.value;
  const customFont = document.getElementById('setting-custom-font')?.value;
  const textColor        = document.getElementById('setting-text-color')?.value;
  const transEnabled     = document.getElementById('setting-transition-enabled')?.checked !== false;
  const transition       = document.getElementById('setting-transition-speed')?.value;
  const bgType     = document.querySelector('#rs-bg-type .seg-btn.active')?.dataset.val || 'solid';
  const bgColor    = document.getElementById('setting-bg-color')?.value       || '#000000';
  const bgGradS    = document.getElementById('setting-bg-grad-start')?.value  || '#0a1628';
  const bgGradE    = document.getElementById('setting-bg-grad-end')?.value    || '#1a3a5c';
  const bgImageUrl = document.getElementById('setting-bg-image-url')?.value   || '';
  const autoFit    = document.getElementById('setting-autofit-text')?.checked !== false;
  const refColor   = document.getElementById('setting-ref-color')?.value;
  const refSizePct = parseInt(document.getElementById('setting-ref-size')?.value) || 45;

  const ltAutoFit     = document.getElementById('setting-lt-autofit-text')?.checked !== false;
  const ltBgType      = document.querySelector('#lt-bg-type .seg-btn.active')?.dataset.val || 'solid';
  const ltBgColor     = document.getElementById('setting-lt-bg-color')?.value     || '#000000';
  const ltBgOpacity   = (parseInt(document.getElementById('setting-lt-bg-opacity')?.value ?? 82) / 100).toFixed(2);
  const ltBgGradS     = document.getElementById('setting-lt-bg-grad-start')?.value || '#000000';
  const ltBgGradE     = document.getElementById('setting-lt-bg-grad-end')?.value   || '#1a1a1a';

  await Promise.all([
    theme      && api.saveSetting('theme',            theme),
    fontSize   && api.saveSetting('font_size',        fontSize),
    fontFamily && api.saveSetting('font_family',      fontFamily),
    customFont !== undefined && api.saveSetting('custom_font_family', customFont),
    textColor  && api.saveSetting('text_color',       textColor),
    api.saveSetting('transition_enabled', transEnabled.toString()),
    transition !== undefined && api.saveSetting('transition_speed', transition),
    api.saveSetting('bg_type',            bgType),
    api.saveSetting('bg_color',           bgColor),
    api.saveSetting('bg_gradient_start',  bgGradS),
    api.saveSetting('bg_gradient_end',    bgGradE),
    api.saveSetting('bg_image_url',       bgImageUrl),
    api.saveSetting('auto_fit_text',      autoFit.toString()),
    refColor   && api.saveSetting('ref_color',        refColor),
    api.saveSetting('ref_size_ratio',     (refSizePct / 100).toFixed(2)),
    api.saveSetting('lt_auto_fit_text',   ltAutoFit.toString()),
    api.saveSetting('lt_bg_type',         ltBgType),
    api.saveSetting('lt_bg_color',        ltBgColor),
    api.saveSetting('lt_bg_opacity',      ltBgOpacity),
    api.saveSetting('lt_bg_gradient_start', ltBgGradS),
    api.saveSetting('lt_bg_gradient_end',   ltBgGradE),
  ].filter(Boolean));

}

let _displaySaveTimer = null;
function liveDisplaySettings() {
  clearTimeout(_displaySaveTimer);
  _displaySaveTimer = setTimeout(saveDisplaySettings, 300);
}

async function resetDefaults() {
  if (!confirm('Reset all settings to defaults?')) return;
  const defaults = {
    theme: 'dark', font_size: '64', show_translation: 'true', show_reference: 'true',
    standby_bg_type: 'solid', auto_project: 'false', confidence: 'medium',
    require_session: 'true', auto_project_only_on_exact_ref: 'true',
    debounce_ms: '1500', proj_debounce: '5',
    autostart_transcription: 'false', speech_quality: 'balanced',
    default_session_name: 'Sunday Morning Service', auto_session: 'false',
    clear_transcript: 'false', show_shortcuts: 'false', voice_cmds: 'false',
  };
  for (const [k, v] of Object.entries(defaults)) await api.saveSetting(k, v);
  await loadSettingsView();
  showToast('Settings reset to defaults');
}

// ── DOM control helpers (used by load/save above) ─────────────────────────────

function setSelectVal(id, val)   { const el = document.getElementById(id); if (el && val) el.value = val; }
function setCheckbox(id, bool)   { const el = document.getElementById(id); if (el) el.checked = !!bool; }
function setInputVal(id, val)    { const el = document.getElementById(id); if (el && val != null) el.value = val; }
function setSlider(sliderId, labelId, val, fmt) {
  const s = document.getElementById(sliderId);
  const l = document.getElementById(labelId);
  if (s && val) { s.value = val; if (l) l.textContent = fmt(val); }
}
function setActiveSegBtn(groupId, val) {
  document.querySelectorAll(`#${groupId} .seg-btn`).forEach(b => {
    b.classList.toggle('active', b.dataset.val === val);
  });
}
function getSelectVal(id)   { return document.getElementById(id)?.value ?? null; }
function getCheckbox(id)    { return document.getElementById(id)?.checked?.toString() ?? 'false'; }
function getInputVal(id)    { return document.getElementById(id)?.value ?? ''; }
function getSliderVal(id)   { return document.getElementById(id)?.value ?? null; }
function getActiveSegBtn(groupId) {
  return document.querySelector(`#${groupId} .seg-btn.active`)?.dataset.val || 'solid';
}
