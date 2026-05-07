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
 *   modules/settings.js           loadAllSettings, loadSettingsView,
 *                                 saveAllSettings, saveDisplaySettings,
 *                                 liveDisplaySettings, resetDefaults,
 *                                 _displaySaveTimer, plus the DOM-helper
 *                                 pairs setSelectVal/getSelectVal,
 *                                 setCheckbox/getCheckbox,
 *                                 setInputVal/getInputVal,
 *                                 setSlider/getSliderVal,
 *                                 setActiveSegBtn/getActiveSegBtn
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
 * enumeration, and the DOMContentLoaded entry point at the bottom.
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

        // HDMI layout: save + send to display window
        if (group.id === 'hdmi-layout') {
          api.sendDisplayLayout({ target: 'hdmi', layout: val });
        }

        // NDI layout: save + send to NDI window
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

// loadAllSettings, loadSettingsView, saveAllSettings,
// saveDisplaySettings, liveDisplaySettings, resetDefaults,
// _displaySaveTimer, plus the setSelectVal/setCheckbox/setInputVal/
// setSlider/setActiveSegBtn and getSelectVal/getCheckbox/getInputVal/
// getSliderVal/getActiveSegBtn DOM helpers all live in
// modules/settings.js, loaded earlier in index.html.

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

  // Display controls: Studio Preview (primary) + Display Preview view
  document.getElementById('push-btn')?.addEventListener('click', () => isProjecting ? stopProjecting() : pushVerse());
  document.getElementById('next-btn')?.addEventListener('click', () => navigateVerse('next'));
  document.getElementById('prev-btn')?.addEventListener('click', () => navigateVerse('prev'));
  document.getElementById('clear-hdmi-btn')?.addEventListener('click', clearHdmiDisplay);

  document.getElementById('push-btn-dp')?.addEventListener('click', () => isProjecting ? stopProjecting() : pushVerse());
  document.getElementById('next-btn-dp')?.addEventListener('click', () => navigateVerse('next'));
  document.getElementById('prev-btn-dp')?.addEventListener('click', () => navigateVerse('prev'));
  document.getElementById('clear-hdmi-btn-dp')?.addEventListener('click', clearHdmiDisplay);

  // Arrow key verse navigation: skip when focus is inside a text input
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

  // Right sidebar Display pane: all changes apply instantly
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

  // Color presets: data-target selects which input to update
  document.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target || 'setting-bg-color';
      const colorEl  = document.getElementById(targetId);
      if (colorEl) colorEl.value = btn.dataset.color;
      if (targetId === 'setting-bg-color') liveDisplaySettings();
    });
  });

  // Gradient presets: data-target-start/end selects which inputs to update
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
      showToast('Background image selected, save settings to apply');
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
      showToast('Standby image selected, save settings to apply');
    } else {
      showToast('Upload failed: ' + result.error);
    }
  });

  // Standby opacity slider
  document.getElementById('setting-standby-image-opacity')?.addEventListener('input', e => {
    const lbl = document.getElementById('standby-opacity-val');
    if (lbl) lbl.textContent = e.target.value + '%';
  });

  // Right sidebar Outputs pane: toggle display window
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
        // HDMI closed: mirror to NDI
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

  // Display window closed by OS: keep all state in sync
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
    showToast('KJV Bible loaded, ready to use!');
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
    if (words.length < 15) { showToast('Keep speaking, not enough transcript yet'); return; }
    const useAI  = settings.ai_summary === 'true';
    const apiKey = settings.openai_api_key || '';
    if (useAI && apiKey) {
      summaryWordCount = 0; // force re-trigger
      summarizeWithAI(document.getElementById('summary-text')?.textContent || '');
    } else {
      summaryWordCount = 0;
      updateSermonSummary();
      showToast('Summary refreshed (local mode, add OpenAI key for AI summary)');
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
