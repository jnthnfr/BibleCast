/* BibleCast: operator panel (renderer)
 *
 * Almost everything that used to live in this file has moved into
 * focused modules under src/renderer/modules. Each module is loaded as
 * a classic <script> before this file in index.html and shares the same
 * script-level lexical scope, so cross-module bindings resolve by name.
 *
 *   modules/state.js              api, selectedVerse, isBlank, isProjecting,
 *                                 searchTimeout, lastProjectedAt,
 *                                 displayWindowOpen, hdmiMirrorOpen,
 *                                 startupWindowsOpened, settings
 *   modules/utils-renderer.js     formatRef, showToast,
 *                                 MAX_TRANSCRIPT_CHARS, appendToTranscript
 *   modules/bible-data.js         BIBLE_BOOKS, SCRIPTURE_REF_RE, STOP_WORDS,
 *                                 BIBLE_CHAPTER_COUNTS
 *   modules/bible-browser.js      initBibleBrowser, bbSelectedBook,
 *                                 bbSelectedChapter
 *   modules/sessions.js           activeSession, loadSessions, createSession,
 *                                 refreshHistory
 *   modules/voice-commands.js     checkVoiceCommands, navigateVerse
 *   modules/summary.js            summaryWordCount, updateSermonSummary,
 *                                 summarizeWithAI
 *   modules/transcription.js      4 STT engines (Web Speech, Chrome bridge,
 *                                 Whisper, Vosk) + recognition, isListening,
 *                                 fullTranscript, predictionTimeout, vosk*,
 *                                 whisper*, chromeBridgeReady, plus the
 *                                 common helpers setWhisperBadge,
 *                                 onNewFinalText, updateTranscriptDisplay
 *   modules/search.js             normalizeSpokenScripture, detectScriptureRef,
 *                                 updateBookAutocomplete, extractKeywords,
 *                                 getConfidenceThreshold, schedulePrediction,
 *                                 runPrediction, showPredictions,
 *                                 onSearchInput, doSearch, selectVerse
 *   modules/projection-preview.js PROJ_W, PROJ_H, getDisplayBg/Font/Ref/Text,
 *                                 renderProjectionPreview, rescaleAllPreviews,
 *                                 updateStudioPreview, updateLivePreview,
 *                                 syncDisplayPreviewLarge
 *   modules/display-output.js     STOP_SVG, PLAY_SVG, updatePushButton,
 *                                 renderFollowingVerses, clearFollowingVerses,
 *                                 pushVerse, stopProjecting, clearHdmiDisplay,
 *                                 toggleBlank, updateLiveBadge,
 *                                 _lastSyncKey, syncDisplayState,
 *                                 updateDisplayBtn, updateStatusBadge
 *   modules/translations.js       availableCache, installedAbbrs,
 *                                 loadTranslations, refreshInstalledList,
 *                                 loadAvailableTranslations,
 *                                 renderAvailableList, renderAvailableInto,
 *                                 downloadTranslation, importTranslationFile,
 *                                 setImportStatus
 *   modules/updater.js            checkForUpdates, initUpdaterEvents
 *
 * What's still here in renderer.js: init (the bootstrap orchestrator),
 * bindEvents (the master DOM event wiring), the navigation / collapsibles /
 * slider / segmented-button / splitter helpers, monitor & microphone
 * enumeration, loadAllSettings / loadSettingsView / saveAllSettings /
 * saveDisplaySettings (settings bucket, pending extraction), and the
 * DOMContentLoaded entry point at the bottom.
 */

// ── Transcription state and engines ───────────────────────────────────────────
// All transcription bindings (recognition, isListening, fullTranscript,
// predictionTimeout, whisper*, vosk*, chromeBridgeReady) and the four
// engines (Web Speech, Chrome bridge, Whisper, Vosk) plus their common
// helpers (setWhisperBadge, onNewFinalText, updateTranscriptDisplay)
// live in modules/transcription.js, loaded earlier in index.html.

// ── Projection preview renderer ────────────────────────────────────────────────
// PROJ_W, PROJ_H, getDisplayBg/Font/Ref/Text helpers,
// renderProjectionPreview, rescaleAllPreviews and the
// studio/live/display-preview wrappers all live in
// modules/projection-preview.js, loaded earlier in index.html.

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  await loadTranslations();
  await loadSessions();
  await syncDisplayState();
  await loadAllSettings();
  initCollapsibles();
  initSliderLabels();
  initSegButtons();
  initTransitionSlider();
  initResizeSplitters();
  initBibleBrowser();
  bindEvents();
  initSpeechRecognition();
  initUpdaterEvents();
  await loadMicrophones();
  await loadMonitors();

  const appVer = await api.getAppVersion().catch(() => null);
  if (appVer) {
    ['about-version', 'about-version-card'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = appVer;
    });
  }

  // Refresh display state every 5 seconds
  setInterval(syncDisplayState, 5000);

  // Load available translations list in background
  loadAvailableTranslations();

  // Apply auto-session if configured
  if (settings.auto_session === 'true' && !activeSession) {
    const name = settings.default_session_name || 'Sunday Morning Service';
    await api.createSession(name);
    await loadSessions();
  }

  // Rescale preview canvases whenever their container size changes
  const rescaleObserver = new ResizeObserver(() => rescaleAllPreviews());
  ['studio-canvas', 'live-canvas', 'display-canvas'].forEach(id => {
    const el = document.getElementById(id);
    if (el) rescaleObserver.observe(el);
  });
}


// ── Navigation ────────────────────────────────────────────────────────────────

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  const navEl  = document.querySelector(`.nav-item[data-view="${name}"]`);
  const viewEl = document.getElementById(`view-${name}`);

  if (navEl)  navEl.classList.add('active');
  if (viewEl) viewEl.classList.add('active');

  if (name === 'history')         refreshHistory();
  if (name === 'display-preview') syncDisplayPreviewLarge();
  if (name === 'settings')        loadSettingsView();
}

function switchRsTab(name) {
  document.querySelectorAll('.rs-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.rs-pane').forEach(p => p.classList.remove('active'));

  const tab  = document.querySelector(`.rs-tab[data-rs-tab="${name}"]`);
  const pane = document.getElementById(`rs-${name}`);

  if (tab)  tab.classList.add('active');
  if (pane) pane.classList.add('active');
}

// ── Collapsibles ──────────────────────────────────────────────────────────────

function initCollapsibles() {
  document.querySelectorAll('.coll-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const body  = document.getElementById(btn.dataset.target);
      if (!body) return;
      const open  = body.classList.toggle('open');
      const caret = btn.querySelector('.caret');
      if (caret) caret.textContent = open ? '▾' : '▸';
    });
  });
}

// ── Slider labels ─────────────────────────────────────────────────────────────

function initSliderLabels() {
  const pairs = [
    ['setting-debounce',      'setting-debounce-val',      v => (v / 1000).toFixed(1) + 's'],
    ['setting-proj-debounce', 'setting-proj-debounce-val', v => v + 's'],
    ['setting-font-size',     'font-size-display',         v => v + 'px'],
  ];
  pairs.forEach(([sliderId, labelId, fmt]) => {
    const slider = document.getElementById(sliderId);
    const label  = document.getElementById(labelId);
    if (!slider || !label) return;
    label.textContent = fmt(slider.value);
    slider.addEventListener('input', () => { label.textContent = fmt(slider.value); });
  });
}

// ── Segmented buttons ─────────────────────────────────────────────────────────

function initSegButtons() {
  document.querySelectorAll('.seg-btns').forEach(group => {
    group.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const val = btn.dataset.val;

        // Show/hide background sub-rows
        if (group.id === 'rs-bg-type') {
          const solidRow = document.getElementById('bg-solid-row');
          const gradRow  = document.getElementById('bg-gradient-row');
          const imgRow   = document.getElementById('bg-image-row');
          if (solidRow) solidRow.style.display = val === 'solid'    ? 'flex'  : 'none';
          if (gradRow)  gradRow.style.display  = val === 'gradient' ? 'block' : 'none';
          if (imgRow)   imgRow.style.display   = val === 'image'    ? 'block' : 'none';
          liveDisplaySettings();
        }
        if (group.id === 'standby-bg-type') {
          const solidRow = document.getElementById('standby-bg-solid-row');
          const gradRow  = document.getElementById('standby-bg-gradient-row');
          const urlRow   = document.getElementById('standby-bg-url-row');
          if (solidRow) solidRow.style.display = val === 'solid'    ? 'flex'  : 'none';
          if (gradRow)  gradRow.style.display  = val === 'gradient' ? 'block' : 'none';
          if (urlRow)   urlRow.style.display   = val === 'image'    ? 'block' : 'none';
        }

        if (group.id === 'lt-bg-type') {
          const solidRow = document.getElementById('lt-bg-solid-row');
          const gradRow  = document.getElementById('lt-bg-gradient-row');
          if (solidRow) solidRow.style.display = val === 'solid'    ? 'block' : 'none';
          if (gradRow)  gradRow.style.display  = val === 'gradient' ? 'block' : 'none';
          liveDisplaySettings();
        }

        if (group.id === 'standby-screen-type') {
          const opts = document.getElementById('standby-image-options');
          if (opts) opts.style.display = val === 'image' ? 'block' : 'none';
        }

        if (group.id === 'standby-image-fit') {
          // No UI row to toggle; just save on settings-save
        }

        // HDMI layout — save + send to display window
        if (group.id === 'hdmi-layout') {
          api.sendDisplayLayout({ target: 'hdmi', layout: val });
        }

        // NDI layout — save + send to NDI window
        if (group.id === 'ndi-layout') {
          api.sendDisplayLayout({ target: 'ndi', layout: val });
        }
      });
    });
  });
}

// ── Transition speed slider ───────────────────────────────────────────────────

function initTransitionSlider() {
  const slider = document.getElementById('setting-transition-speed');
  const label  = document.getElementById('transition-speed-val');
  if (!slider || !label) return;
  label.textContent = parseFloat(slider.value).toFixed(1) + 's';
  slider.addEventListener('input', () => {
    label.textContent = parseFloat(slider.value).toFixed(1) + 's';
  });
}

// ── OBS-style resizable splitters ────────────────────────────────────────────

function initResizeSplitters() {
  // Drag the splitter between STUDIO and LIVE OUTPUT
  const mainSplit  = document.getElementById('main-splitter');
  const studioPanel = document.querySelector('.studio-panel');
  const outputPanel = document.querySelector('.output-panel');

  if (mainSplit && studioPanel && outputPanel) {
    let dragging = false, startX = 0, startStudio = 0, startOutput = 0;

    mainSplit.addEventListener('mousedown', e => {
      dragging    = true;
      startX      = e.clientX;
      startStudio = studioPanel.getBoundingClientRect().width;
      startOutput = outputPanel.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const delta = e.clientX - startX;
      const newStudio = Math.max(260, startStudio + delta);
      const newOutput = Math.max(220, startOutput - delta);
      studioPanel.style.flex = 'none';
      studioPanel.style.width = newStudio + 'px';
      outputPanel.style.flex = 'none';
      outputPanel.style.width = newOutput + 'px';
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // Drag the splitter between preview row and transcript panel (vertical resize)
  const transcriptSplit = document.getElementById('transcript-splitter');
  const transcriptPanel = document.querySelector('.transcript-panel');
  if (transcriptSplit && transcriptPanel) {
    let draggingT = false, startYT = 0, startHT = 0;
    transcriptSplit.addEventListener('mousedown', e => {
      draggingT = true;
      startYT   = e.clientY;
      startHT   = transcriptPanel.getBoundingClientRect().height;
      document.body.style.cursor    = 'ns-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', e => {
      if (!draggingT) return;
      const newH = Math.max(80, Math.min(600, startHT - (e.clientY - startYT)));
      transcriptPanel.style.height = newH + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!draggingT) return;
      draggingT = false;
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      api.saveSetting('transcript_panel_height', String(transcriptPanel.getBoundingClientRect().height));
    });
  }

  // Drag the splitter below bible browser (vertical resize)
  const bbSplit = document.getElementById('bible-browser-splitter');
  const bbWrap  = document.getElementById('bible-browser-wrap');
  if (bbSplit && bbWrap) {
    let draggingB = false, startYB = 0, startHB = 0;
    bbSplit.addEventListener('mousedown', e => {
      draggingB = true;
      startYB   = e.clientY;
      startHB   = bbWrap.getBoundingClientRect().height;
      document.body.style.cursor    = 'ns-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', e => {
      if (!draggingB) return;
      const newH = Math.max(60, Math.min(500, startHB + (e.clientY - startYB)));
      bbWrap.style.height = newH + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!draggingB) return;
      draggingB = false;
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      api.saveSetting('bible_browser_height', String(bbWrap.getBoundingClientRect().height));
    });
  }

  // Drag the splitter between main content and right sidebar
  const sideSplit    = document.getElementById('sidebar-splitter');
  const rightSidebar = document.querySelector('.right-sidebar');

  if (sideSplit && rightSidebar) {
    let dragging2 = false, startX2 = 0, startW2 = 0;

    sideSplit.addEventListener('mousedown', e => {
      dragging2 = true;
      startX2   = e.clientX;
      startW2   = rightSidebar.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', e => {
      if (!dragging2) return;
      const delta = startX2 - e.clientX;
      const newW  = Math.max(220, Math.min(480, startW2 + delta));
      rightSidebar.style.width = newW + 'px';
      rightSidebar.style.minWidth = newW + 'px';
    });

    document.addEventListener('mouseup', () => {
      dragging2 = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }
}

// ── Monitors ──────────────────────────────────────────────────────────────────

async function loadMonitors() {
  const monitors = await api.listMonitors();
  const sel = document.getElementById('monitor-select');
  if (!sel || !monitors.length) return;
  sel.innerHTML = '';
  monitors.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
    if (!m.primary) sel.value = m.id; // prefer secondary
  });
  sel.addEventListener('change', () => {
    api.setMonitor(parseInt(sel.value, 10));
  });
}

// ── Microphone enumeration ────────────────────────────────────────────────────

async function loadMicrophones() {
  try {
    // Request permission first so labels are populated
    await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics    = devices.filter(d => d.kind === 'audioinput');

    ['mic-select', 'settings-mic-select'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const current = sel.value;
      sel.innerHTML = '';
      mics.forEach((m, i) => {
        const opt       = document.createElement('option');
        opt.value       = m.deviceId;
        opt.textContent = m.label || `Microphone ${i + 1}`;
        sel.appendChild(opt);
      });
      if (current) sel.value = current;
    });
  } catch (e) {
    console.warn('Microphone enumeration failed:', e.message);
  }
}

// ── Bible prediction from speech + autocomplete + keyword prediction ─────────
// normalizeSpokenScripture, detectScriptureRef, updateBookAutocomplete,
// extractKeywords, getConfidenceThreshold, schedulePrediction,
// runPrediction, and showPredictions live in modules/search.js,
// loaded earlier in index.html.

// ── Voice commands ────────────────────────────────────────────────────────────
// checkVoiceCommands and navigateVerse live in modules/voice-commands.js,
// loaded earlier in index.html.

// ── Sermon Summary ────────────────────────────────────────────────────────────
// updateSermonSummary, summarizeWithAI, and the summaryWordCount binding
// live in modules/summary.js, loaded earlier in index.html.

// ── Translations ──────────────────────────────────────────────────────────────
// Translation list, downloads, imports, and the availableCache /
// installedAbbrs bindings live in modules/translations.js, loaded
// earlier in index.html.

// ── Search ────────────────────────────────────────────────────────────────────
// onSearchInput, doSearch, and selectVerse live in modules/search.js,
// loaded earlier in index.html.


// STOP_SVG, PLAY_SVG and updatePushButton live in
// modules/display-output.js.

// formatRef has moved to modules/utils-renderer.js.

// ── Following verses strip ────────────────────────────────────────────────────

// renderFollowingVerses and clearFollowingVerses live in
// modules/display-output.js.

// ── Display controls ──────────────────────────────────────────────────────────

// pushVerse, stopProjecting, clearHdmiDisplay, toggleBlank,
// updateLiveBadge, syncDisplayState (with _lastSyncKey),
// updateDisplayBtn and updateStatusBadge live in
// modules/display-output.js, loaded earlier in index.html.

// ── Sessions + History ────────────────────────────────────────────────────────
// loadSessions, createSession, refreshHistory and the activeSession binding
// live in modules/sessions.js, loaded earlier in index.html.

// ── Settings ──────────────────────────────────────────────────────────────────

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

  // Show the correct bg sub-row — fall back to solid if image type has no URL
  const bgType = (s.bg_type === 'image' && !s.bg_image_url) ? 'solid' : (s.bg_type || 'solid');
  if (bgType !== s.bg_type) setActiveSegBtn('rs-bg-type', bgType);
  const solidRow = document.getElementById('bg-solid-row');
  const gradRow  = document.getElementById('bg-gradient-row');
  const imgRow   = document.getElementById('bg-image-row');
  if (solidRow) solidRow.style.display = bgType === 'solid'    ? 'flex'  : 'none';
  if (gradRow)  gradRow.style.display  = bgType === 'gradient' ? 'block' : 'none';
  if (imgRow)   imgRow.style.display   = bgType === 'image'    ? 'block' : 'none';

  // Restore HDMI toggle — default OFF on launch
  const hdmiToggle = document.getElementById('hdmi-toggle');
  if (hdmiToggle) {
    const hdmiEnabled = s.hdmi_enabled === 'true'; // default false — display starts off
    hdmiToggle.checked = hdmiEnabled;
  }

  // Restore NDI toggle & re-open NDI window if it was enabled (only on first load).
  // After startup, never overwrite the toggle from DB — the live checkbox state is
  // authoritative so that saveAllSettings → loadAllSettings cycles don't clobber it.
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
  // Show/hide model row based on provider
  const modelRow = document.getElementById('whisper-model-row');
  if (modelRow) modelRow.style.display = (s.whisper_provider === 'whisper-local') ? 'flex' : 'none';
  const keyRow = document.getElementById('openai-key-row');
  if (keyRow) keyRow.style.display = (s.ai_summary === 'true') ? 'flex' : 'none';
  setSelectVal('setting-speech-quality',      s.speech_quality);
  setCheckbox('setting-autostart-transcription', s.autostart_transcription === 'true');
  setSlider('setting-debounce',      'setting-debounce-val',      s.debounce_ms || '1500',  v => (v/1000).toFixed(1)+'s');
  // Scripture Detection
  setCheckbox('setting-auto-project',    s.auto_project === 'true');
  setSelectVal('setting-confidence',     s.confidence);
  setCheckbox('setting-require-session', s.require_session !== 'false');
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
  // Projection background — wired to same keys as Display tab
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

async function saveAllSettings() {
  const theme    = document.getElementById('settings-theme')?.value;
  const fontSize = document.getElementById('settings-font-size')?.value;

  const pairs = [
    ['whisper_provider',        getSelectVal('setting-whisper-provider')],
    ['whisper_model',           getSelectVal('setting-whisper-model')],
    ['whisper_threads',         getSelectVal('setting-whisper-threads') || 'auto'],
    ['whisper_gpu',             getCheckbox('setting-whisper-gpu')],
    ['ai_summary',              getCheckbox('setting-ai-summary')],
    ['openai_api_key',          getInputVal('setting-openai-key')],
    ['speech_quality',          getSelectVal('setting-speech-quality')],
    ['autostart_transcription', getCheckbox('setting-autostart-transcription')],
    ['debounce_ms',             getSliderVal('setting-debounce')],
    ['auto_project',            getCheckbox('setting-auto-project')],
    ['confidence',              getSelectVal('setting-confidence')],
    ['require_session',         getCheckbox('setting-require-session')],
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
    require_session: 'true', debounce_ms: '1500', proj_debounce: '5',
    autostart_transcription: 'false', speech_quality: 'balanced',
    default_session_name: 'Sunday Morning Service', auto_session: 'false',
    clear_transcript: 'false', show_shortcuts: 'false', voice_cmds: 'false',
  };
  for (const [k, v] of Object.entries(defaults)) await api.saveSetting(k, v);
  await loadSettingsView();
  showToast('Settings reset to defaults');
}

// Settings helpers
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

// showToast has moved to modules/utils-renderer.js.

// ── Event binding ─────────────────────────────────────────────────────────────

// ── Bible browser ─────────────────────────────────────────────────────────────
// initBibleBrowser, bbSelectedBook and bbSelectedChapter live in
// modules/bible-browser.js, loaded earlier in index.html.

function bindEvents() {
  // Sidebar nav
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });

  // Right sidebar tabs
  document.querySelectorAll('.rs-tab[data-rs-tab]').forEach(tab => {
    tab.addEventListener('click', () => switchRsTab(tab.dataset.rsTab));
  });

  // Search
  document.getElementById('search-input')?.addEventListener('input', onSearchInput);
  document.getElementById('search-input')?.addEventListener('keydown', e => {
    const input = document.getElementById('search-input');
    const hasSuggestion = input && input.selectionStart < input.selectionEnd;
    if (e.key === 'Tab' || e.key === 'ArrowRight') {
      if (hasSuggestion) {
        e.preventDefault();
        const end = input.value.length;
        input.value = input.value + ' ';
        input.setSelectionRange(input.value.length, input.value.length);
      }
    } else if (e.key === 'Escape') {
      if (hasSuggestion) {
        input.value = input.value.substring(0, input.selectionStart);
      }
    } else if (e.key === 'Enter') {
      if (hasSuggestion) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
      doSearch(true);
    }
  });
  document.getElementById('translation-select')?.addEventListener('change', doSearch);
  document.getElementById('find-btn')?.addEventListener('click', doSearch);

  // Display controls — Studio Preview (primary) + Display Preview view
  document.getElementById('push-btn')?.addEventListener('click', () => isProjecting ? stopProjecting() : pushVerse());
  document.getElementById('next-btn')?.addEventListener('click', () => navigateVerse('next'));
  document.getElementById('prev-btn')?.addEventListener('click', () => navigateVerse('prev'));
  document.getElementById('clear-hdmi-btn')?.addEventListener('click', clearHdmiDisplay);

  document.getElementById('push-btn-dp')?.addEventListener('click', () => isProjecting ? stopProjecting() : pushVerse());
  document.getElementById('next-btn-dp')?.addEventListener('click', () => navigateVerse('next'));
  document.getElementById('prev-btn-dp')?.addEventListener('click', () => navigateVerse('prev'));
  document.getElementById('clear-hdmi-btn-dp')?.addEventListener('click', clearHdmiDisplay);

  // Arrow key verse navigation — skip when focus is inside a text input
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowRight') navigateVerse('next');
    if (e.key === 'ArrowLeft')  navigateVerse('prev');
  });

  // Top bar toggles
  document.getElementById('listen-btn')?.addEventListener('click', toggleListening);
  document.getElementById('refresh-mics-btn')?.addEventListener('click', loadMicrophones);
  document.getElementById('auto-project-toggle')?.addEventListener('change', e => {
    settings.auto_project = e.target.checked;
    api.saveSetting('auto_project', e.target.checked.toString());
  });
  document.getElementById('voice-cmds-toggle')?.addEventListener('change', e => {
    settings.voice_cmds = e.target.checked;
    api.saveSetting('voice_cmds', e.target.checked.toString());
  });

  // Session
  document.getElementById('new-session-btn')?.addEventListener('click', createSession);
  document.getElementById('session-name-input')?.addEventListener('focus', function() {
    if (!this.value) {
      const now = new Date();
      const datePart = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const timePart = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      this.value = `${datePart} – ${timePart}`;
      this.select();
    }
  });
  document.getElementById('session-name-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') createSession();
  });

  // Right sidebar Display pane — all changes apply instantly
  document.getElementById('setting-theme')?.addEventListener('change', liveDisplaySettings);
  document.getElementById('settings-font-family')?.addEventListener('change', e => {
    const customRow = document.getElementById('custom-font-row');
    if (customRow) customRow.style.display = e.target.value === 'custom' ? 'flex' : 'none';
    liveDisplaySettings();
  });
  document.getElementById('setting-custom-font')?.addEventListener('change', liveDisplaySettings);
  document.getElementById('settings-font-size')?.addEventListener('input', e => {
    const lbl = document.getElementById('settings-font-size-val');
    if (lbl) lbl.textContent = e.target.value + 'px';
    liveDisplaySettings();
  });
  document.getElementById('setting-text-color')?.addEventListener('input', liveDisplaySettings);
  document.getElementById('reset-color-btn')?.addEventListener('click', () => {
    const colorEl = document.getElementById('setting-text-color');
    if (colorEl) colorEl.value = '#ffffff';
    liveDisplaySettings();
  });
  document.getElementById('setting-transition-enabled')?.addEventListener('change', e => {
    const enabled  = e.target.checked;
    const row      = document.getElementById('transition-speed-row');
    const slider   = document.getElementById('setting-transition-speed');
    if (row)    row.style.opacity  = enabled ? '1' : '0.4';
    if (slider) slider.disabled    = !enabled;
    liveDisplaySettings();
  });
  document.getElementById('setting-transition-speed')?.addEventListener('input', liveDisplaySettings);
  document.getElementById('setting-autofit-text')?.addEventListener('change', liveDisplaySettings);
  document.getElementById('setting-bg-color')?.addEventListener('input', liveDisplaySettings);
  document.getElementById('setting-bg-grad-start')?.addEventListener('input', liveDisplaySettings);
  document.getElementById('setting-bg-grad-end')?.addEventListener('input', liveDisplaySettings);
  document.getElementById('setting-bg-image-url')?.addEventListener('change', liveDisplaySettings);
  document.getElementById('setting-ref-color')?.addEventListener('input', liveDisplaySettings);
  document.getElementById('reset-ref-color-btn')?.addEventListener('click', () => {
    const el = document.getElementById('setting-ref-color');
    if (el) el.value = '#e8c97a';
    liveDisplaySettings();
  });
  document.getElementById('setting-font-size')?.addEventListener('input', e => {
    const lbl = document.getElementById('display-font-size-val');
    if (lbl) lbl.textContent = e.target.value + 'px';
    liveDisplaySettings();
  });
  document.getElementById('setting-ref-size')?.addEventListener('input', e => {
    const lbl = document.getElementById('ref-size-val');
    if (lbl) lbl.textContent = e.target.value + '%';
    liveDisplaySettings();
  });

  // Lower-third settings
  document.getElementById('setting-lt-autofit-text')?.addEventListener('change', liveDisplaySettings);
  document.getElementById('setting-lt-bg-color')?.addEventListener('input', liveDisplaySettings);
  document.getElementById('setting-lt-bg-opacity')?.addEventListener('input', e => {
    const lbl = document.getElementById('lt-bg-opacity-val');
    if (lbl) lbl.textContent = e.target.value + '%';
    liveDisplaySettings();
  });
  document.getElementById('setting-lt-bg-grad-start')?.addEventListener('input', liveDisplaySettings);
  document.getElementById('setting-lt-bg-grad-end')?.addEventListener('input', liveDisplaySettings);

  // Color presets — data-target selects which input to update
  document.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target || 'setting-bg-color';
      const colorEl  = document.getElementById(targetId);
      if (colorEl) colorEl.value = btn.dataset.color;
      if (targetId === 'setting-bg-color') liveDisplaySettings();
    });
  });

  // Gradient presets — data-target-start/end selects which inputs to update
  document.querySelectorAll('.grad-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const startId = btn.dataset.targetStart || 'setting-bg-grad-start';
      const endId   = btn.dataset.targetEnd   || 'setting-bg-grad-end';
      const startEl = document.getElementById(startId);
      const endEl   = document.getElementById(endId);
      if (startEl) startEl.value = btn.dataset.start;
      if (endEl)   endEl.value   = btn.dataset.end;
      if (startId === 'setting-bg-grad-start') liveDisplaySettings();
    });
  });

  // Background image file upload
  document.getElementById('bg-upload-btn')?.addEventListener('click', () => {
    document.getElementById('bg-file-input')?.click();
  });
  document.getElementById('bg-file-input')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await api.saveBackgroundImage(file);
    if (result.ok) {
      // Set URL in input
      const urlEl = document.getElementById('setting-bg-image-url');
      if (urlEl) urlEl.value = result.filePath;
      // Switch bg type to image and show the image row
      document.querySelectorAll('#rs-bg-type .seg-btn').forEach(b => b.classList.remove('active'));
      const imgBtn = document.querySelector('#rs-bg-type .seg-btn[data-val="image"]');
      if (imgBtn) imgBtn.classList.add('active');
      document.getElementById('bg-solid-row').style.display    = 'none';
      document.getElementById('bg-gradient-row').style.display = 'none';
      document.getElementById('bg-image-row').style.display    = 'block';
      // Save and broadcast to display immediately (bypass debounce)
      await saveDisplaySettings();
      showToast('Background image applied');
    } else {
      showToast('Upload failed: ' + result.error);
    }
  });

  // Settings panel background image upload
  document.getElementById('standby-bg-upload-btn')?.addEventListener('click', () => {
    document.getElementById('standby-bg-file-input')?.click();
  });
  document.getElementById('standby-bg-file-input')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await api.saveBackgroundImage(file);
    if (result.ok) {
      const urlEl = document.getElementById('setting-standby-url');
      if (urlEl) urlEl.value = result.filePath;
      document.querySelectorAll('#standby-bg-type .seg-btn').forEach(b => b.classList.remove('active'));
      const imgBtn = document.querySelector('#standby-bg-type .seg-btn[data-val="image"]');
      if (imgBtn) imgBtn.classList.add('active');
      document.getElementById('standby-bg-solid-row').style.display    = 'none';
      document.getElementById('standby-bg-gradient-row').style.display = 'none';
      document.getElementById('standby-bg-url-row').style.display      = 'block';
      showToast('Background image selected — save settings to apply');
    } else {
      showToast('Upload failed: ' + result.error);
    }
  });

  // Standby logo/image upload
  document.getElementById('standby-image-upload-btn')?.addEventListener('click', () => {
    document.getElementById('standby-image-file-input')?.click();
  });
  document.getElementById('standby-image-file-input')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await api.saveBackgroundImage(file);
    if (result.ok) {
      const urlEl = document.getElementById('setting-standby-image-url');
      if (urlEl) urlEl.value = result.filePath;
      setActiveSegBtn('standby-screen-type', 'image');
      const opts = document.getElementById('standby-image-options');
      if (opts) opts.style.display = 'block';
      showToast('Standby image selected — save settings to apply');
    } else {
      showToast('Upload failed: ' + result.error);
    }
  });

  // Standby opacity slider
  document.getElementById('setting-standby-image-opacity')?.addEventListener('input', e => {
    const lbl = document.getElementById('standby-opacity-val');
    if (lbl) lbl.textContent = e.target.value + '%';
  });

  // Right sidebar Outputs pane — toggle display window
  // Opening also projects the current verse (same as clicking Project)
  document.getElementById('open-display-btn')?.addEventListener('click', async () => {
    const result = await api.openDisplay();
    displayWindowOpen = !!result.open;
    updateDisplayBtn();
    if (displayWindowOpen && selectedVerse) {
      await pushVerse();
    }
  });
  document.getElementById('hdmi-toggle')?.addEventListener('change', async e => {
    const want = e.target.checked;
    if (want !== displayWindowOpen) {
      const r = await api.openDisplay();
      displayWindowOpen = !!r.open;
      updateDisplayBtn();
      if (displayWindowOpen && selectedVerse) {
        await pushVerse(); // pushVerse also opens NDI if toggle is on
      } else if (!displayWindowOpen) {
        // HDMI closed — mirror to NDI
        const ndiToggle = document.getElementById('ndi-toggle');
        if (ndiToggle?.checked) await api.openNdiDisplay(false);
      }
    }
  });
  document.getElementById('ndi-toggle')?.addEventListener('change', async e => {
    const want = e.target.checked;
    await api.openNdiDisplay(want);
    api.saveSetting('ndi_enabled', want.toString());
  });

  // HDMI Mirror toggle (Display Settings pane)
  document.getElementById('hdmi-mirror-toggle')?.addEventListener('change', async e => {
    const want = e.target.checked;
    await api.openHdmiMirror(want);
    hdmiMirrorOpen = want;
    api.saveSetting('hdmi_mirror_enabled', want.toString());
  });

  // Handle mirror window closed externally (e.g. Alt+F4)
  api.onHdmiMirrorClosed(() => {
    hdmiMirrorOpen = false;
    const t = document.getElementById('hdmi-mirror-toggle');
    if (t) t.checked = false;
    api.saveSetting('hdmi_mirror_enabled', 'false');
  });

  // Bibles pane import button
  document.getElementById('import-translation-btn')?.addEventListener('click', () => importTranslationFile('import-status'));

  // Settings view
  document.getElementById('save-all-settings-btn')?.addEventListener('click', saveAllSettings);
  document.getElementById('reset-defaults-btn')?.addEventListener('click', resetDefaults);
  document.getElementById('settings-import-btn')?.addEventListener('click', () => importTranslationFile('settings-import-status'));

  // Sync auto-project toggle with top-bar checkbox
  document.getElementById('setting-auto-project')?.addEventListener('change', e => {
    const tb = document.getElementById('auto-project-toggle');
    if (tb) tb.checked = e.target.checked;
    settings.auto_project = e.target.checked;
  });

  // Display update events from main process
  api.onDisplayUpdate(data => {
    if (data.type === 'verse') {
      const v = { reference: data.reference, text: data.text, translation: data.translation };
      updateLivePreview(v, false);
      updateLiveBadge(true);
      updateStatusBadge(true);
      syncDisplayPreviewLarge(v);
    } else if (data.type === 'blank') {
      isBlank      = !data.visible;
      isProjecting = data.visible && !!selectedVerse;
      updatePushButton(isProjecting);
      updateLiveBadge(data.visible && !!selectedVerse);
      updateStatusBadge(data.visible && !!selectedVerse);
      const canvas = document.getElementById('live-canvas');
      if (canvas) canvas.classList.toggle('blanked', !data.visible);
    }
  });

  // Display window closed by OS — keep all state in sync
  api.onDisplayClosed(() => {
    displayWindowOpen = false;
    updateDisplayBtn(); // also unchecks hdmi-toggle and saves hdmi_enabled=false
    updateStatusBadge(false);
    updateLiveBadge(false);
    // Mirror HDMI close to NDI
    const ndiToggle = document.getElementById('ndi-toggle');
    if (ndiToggle?.checked) api.openNdiDisplay(false);
  });

  // Navigate to settings (from main process)
  api.onNavSettings(() => {
    switchView('settings');
  });

  // KJV auto-seeded
  api.onTranslationsReady(() => {
    loadTranslations();
    showToast('KJV Bible loaded — ready to use!');
  });

  // Bible Gateway scraper popup
  document.getElementById('open-scraper-btn')?.addEventListener('click', () => api.openScraperWindow());

  // Check for updates button (Settings → Application)
  document.getElementById('check-updates-btn')?.addEventListener('click', checkForUpdates);

  // Clear transcript button
  document.getElementById('clear-transcript-btn')?.addEventListener('click', () => {
    fullTranscript = '';
    summaryWordCount = 0;
    updateTranscriptDisplay('');
    const sumEl = document.getElementById('summary-text');
    if (sumEl) sumEl.textContent = 'Summary builds as the sermon progresses…';
  });

  // Refresh/regenerate AI summary button
  document.getElementById('refresh-summary-btn')?.addEventListener('click', () => {
    const words = fullTranscript.trim().split(/\s+/).filter(Boolean);
    if (words.length < 15) { showToast('Keep speaking — not enough transcript yet'); return; }
    const useAI  = settings.ai_summary === 'true';
    const apiKey = settings.openai_api_key || '';
    if (useAI && apiKey) {
      summaryWordCount = 0; // force re-trigger
      summarizeWithAI(document.getElementById('summary-text')?.textContent || '');
    } else {
      summaryWordCount = 0;
      updateSermonSummary();
      showToast('Summary refreshed (local mode — add OpenAI key for AI summary)');
    }
  });

  // Whisper provider change: show/hide model row + reset cached pipeline
  document.getElementById('setting-whisper-provider')?.addEventListener('change', e => {
    const modelRow = document.getElementById('whisper-model-row');
    if (modelRow) modelRow.style.display = e.target.value === 'whisper-local' ? 'flex' : 'none';
    // Reset the cached pipeline so it reloads with the right model next time
    api.resetWhisper?.();
    whisperReady = false;
  });

  // AI summary toggle: show/hide API key row
  document.getElementById('setting-ai-summary')?.addEventListener('change', e => {
    const keyRow = document.getElementById('openai-key-row');
    if (keyRow) keyRow.style.display = e.target.checked ? 'flex' : 'none';
  });

  // Whisper model change: reset cached pipeline so new model loads on next use
  document.getElementById('setting-whisper-model')?.addEventListener('change', () => {
    api.resetWhisper?.();
    whisperReady = false;
  });

  // CPU thread change: reset pipeline so it reloads with the new thread count
  document.getElementById('setting-whisper-threads')?.addEventListener('change', () => {
    api.resetWhisper?.();
    whisperReady = false;
  });

  // GPU toggle: open/close the GPU worker window and reset pipeline
  document.getElementById('setting-whisper-gpu')?.addEventListener('change', async e => {
    await api.setWhisperGpu(e.target.checked);
    api.resetWhisper?.();
    whisperReady = false;
  });
}

// ── Update system ─────────────────────────────────────────────────────────────

// MAX_TRANSCRIPT_CHARS and appendToTranscript have moved to
// modules/utils-renderer.js. fullTranscript moved with the rest of
// the transcription state into modules/transcription.js.

// ── Start ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
