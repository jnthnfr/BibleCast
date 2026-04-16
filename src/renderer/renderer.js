/* BibleCast — Operator Panel (Revelio Live style) */

const api = window.biblecast;

// ── Global state ──────────────────────────────────────────────────────────────

let selectedVerse      = null;
let isBlank            = false;
let searchTimeout      = null;
let activeSession      = null;

// Transcription
let recognition        = null;
let isListening        = false;
let fullTranscript     = '';
let predictionTimeout  = null;
let lastProjectedAt    = 0;   // timestamp of last auto-projection

// Whether the display window is currently open
let displayWindowOpen = false;

// Tracks whether initial settings have been loaded once (guards HDMI auto-open on re-load)
let settingsLoaded = false;

// Last update check result
let updateInfo = null;

// Whisper AI audio capture state
let whisperAudioCtx    = null;
let whisperProcessor   = null;
let whisperStream      = null;
let whisperBuffer      = [];          // raw Float32 samples at 16 kHz
let whisperFlushTimer  = null;        // interval to flush buffer every N seconds
let whisperReady       = false;       // pipeline loaded flag
let summaryWordCount   = 0;           // word count at last AI summary trigger

// Vosk (vosk-browser WASM) audio capture state
let voskModel          = null;
let voskRec            = null;
let voskAudioCtx       = null;
let voskProcessor      = null;
let voskStream         = null;

// Settings cache (loaded once, kept in sync)
let settings = {
  auto_project:           false,
  confidence:             'medium',
  require_session:        true,
  debounce_ms:            1500,
  proj_debounce:          5,
  autostart_transcription: false,
  theme:                  'dark',
  font_size:              '64',
  show_translation:       true,
  show_reference:         true,
  whisper_provider:       'vosk',
};

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
  bindEvents();
  initSpeechRecognition();
  await loadMicrophones();
  await loadMonitors();

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

  // Check for updates 8 seconds after launch (non-blocking)
  setTimeout(checkForUpdates, 8000);
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
        }
        if (group.id === 'standby-bg-type') {
          const row = document.getElementById('standby-bg-url-row');
          if (row) row.style.display = val === 'image' ? 'flex' : 'none';
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

// ── Speech recognition — provider-aware ───────────────────────────────────────

function initSpeechRecognition() {
  // Web Speech API setup (always initialised as fallback / default)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = 'en-US';

    recognition.onresult = event => {
      // Confirm it's actually working the moment we get any result
      setWhisperBadge('● Active', 'ai');
      let interimText = '';
      let finalDelta  = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalDelta    += t + ' ';
          fullTranscript += t + ' ';
          onNewFinalText(finalDelta.trim());
        } else {
          interimText += t;
        }
      }
      updateTranscriptDisplay(interimText);
    };

    recognition.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('[WebSpeech] Error:', e.error);
      // Persistent errors — reset state and inform the user visibly
      const PERSISTENT = ['not-allowed', 'audio-capture', 'service-not-allowed', 'network'];
      if (PERSISTENT.includes(e.error)) {
        isListening = false;
        const btn = document.getElementById('listen-btn');
        if (btn) {
          btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg> Start Listening`;
          btn.classList.remove('active');
        }
        setWhisperBadge('');
        const el = document.getElementById('transcript-text');
        if (!el) return;
        // Network/service errors: auto-switch to Whisper AI silently
        if (['network', 'service-not-allowed'].includes(e.error)) {
          settings.whisper_provider = 'whisper-local';
          api.saveSetting('whisper_provider', 'whisper-local');
          const sel = document.getElementById('setting-whisper-provider');
          if (sel) sel.value = 'whisper-local';
          el.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Web Speech unavailable (${e.error}) — switched to Whisper AI automatically. Press Start Listening to begin.</span>`;
        } else {
          el.innerHTML = `<span style="color:var(--danger)">⚠ Speech error: <strong>${e.error}</strong> — check mic permissions in Settings.</span>`;
        }
      }
    };

    recognition.onend = () => {
      // Delay restart so onerror (which fires before onend) has time to set isListening=false
      if (isListening && settings.whisper_provider !== 'whisper-local') {
        setTimeout(() => {
          if (isListening) try { recognition.start(); } catch (_) {}
        }, 300);
      }
    };
  }

  // Register for Whisper download/load progress events from main process
  api.onWhisperProgress(progress => {
    const badge = document.getElementById('whisper-status');
    if (!badge) return;
    const tEl = document.getElementById('transcript-text');
    if (progress.status === 'downloading') {
      const pct = progress.progress != null ? Math.round(progress.progress) + '%' : '';
      badge.textContent = `Downloading model ${pct}`;
      badge.className   = 'whisper-status downloading';
      if (tEl && !fullTranscript) tEl.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Downloading Whisper AI model ${pct} — transcription will begin shortly…</span>`;
    } else if (progress.status === 'initiate' || progress.status === 'progress') {
      badge.textContent = 'Loading model…';
      badge.className   = 'whisper-status downloading';
      if (tEl && !fullTranscript) tEl.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Loading Whisper AI model…</span>`;
    } else if (progress.status === 'done') {
      whisperReady = true;
      badge.textContent = 'Whisper ready';
      badge.className   = 'whisper-status ai';
      if (tEl && !fullTranscript) tEl.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Whisper AI ready — speak and text will appear here.</span>`;
      setTimeout(() => { badge.textContent = 'Whisper AI'; }, 3000);
    }
  });
}

function toggleListening() {
  isListening = !isListening;
  const btn = document.getElementById('listen-btn');

  if (isListening) {
    if (settings.whisper_provider === 'whisper-local') {
      startWhisperCapture();
    } else if (settings.whisper_provider === 'vosk') {
      startVoskCapture();
    } else {
      if (!recognition) { isListening = false; return; }
      try {
        recognition.start();
        setWhisperBadge('● Listening', 'recording');
      } catch (e) {
        isListening = false;
        console.error('[WebSpeech] Could not start:', e.message);
        return;
      }
    }
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg> Stop Listening`;
    btn.classList.add('active');
  } else {
    if (settings.whisper_provider === 'whisper-local') {
      stopWhisperCapture();
    } else if (settings.whisper_provider === 'vosk') {
      stopVoskCapture();
    } else {
      recognition?.stop();
    }
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg> Start Listening`;
    btn.classList.remove('active');
    setWhisperBadge('');
  }
}

// ── Whisper AI — local neural network via @xenova/transformers ────────────────

async function startWhisperCapture() {
  try {
    // Request mic with preferred 16 kHz (browser may ignore the constraint)
    whisperStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: { ideal: 16000 }, channelCount: 1, echoCancellation: true },
    });

    // Use AudioContext at 16 kHz for Whisper's expected sample rate
    whisperAudioCtx = new AudioContext({ sampleRate: 16000 });
    const source    = whisperAudioCtx.createMediaStreamSource(whisperStream);

    // ScriptProcessorNode captures raw PCM (deprecated but universally supported in Electron)
    whisperProcessor = whisperAudioCtx.createScriptProcessor(4096, 1, 1);
    whisperProcessor.onaudioprocess = e => {
      if (!isListening) return;
      const data = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) whisperBuffer.push(data[i]);
    };

    source.connect(whisperProcessor);
    whisperProcessor.connect(whisperAudioCtx.destination);

    setWhisperBadge('Recording', 'recording');

    // Flush buffer to Whisper every 3 seconds for near-real-time transcription
    whisperFlushTimer = setInterval(() => flushWhisperBuffer(), 3000);
  } catch (err) {
    console.error('[Whisper] Mic access failed:', err.message);
    isListening = false;
    const btn = document.getElementById('listen-btn');
    if (btn) {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg> Start Listening`;
      btn.classList.remove('active');
    }
    showToast('Microphone access denied');
  }
}

function stopWhisperCapture() {
  clearInterval(whisperFlushTimer);
  whisperFlushTimer = null;
  // Flush remaining audio before stopping
  if (whisperBuffer.length > 8000) flushWhisperBuffer(); // match flushWhisperBuffer's own minimum threshold
  whisperBuffer = [];
  whisperProcessor?.disconnect();
  whisperProcessor = null;
  whisperAudioCtx?.close();
  whisperAudioCtx = null;
  whisperStream?.getTracks().forEach(t => t.stop());
  whisperStream = null;
}

// ── Vosk (vosk-browser WASM) — real-time offline speech recognition ───────────

function loadVoskLib() {
  return new Promise((resolve, reject) => {
    if (window.Vosk) { resolve(window.Vosk); return; }
    const script = document.createElement('script');
    script.src = '../../node_modules/vosk-browser/dist/vosk.js';
    script.onload  = () => resolve(window.Vosk);
    script.onerror = () => reject(new Error('Could not load vosk.js'));
    document.head.appendChild(script);
  });
}

async function startVoskCapture() {
  const el  = document.getElementById('transcript-text');
  const btn = document.getElementById('listen-btn');
  setWhisperBadge('Loading…', 'downloading');
  if (el && !fullTranscript) el.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Loading Vosk speech model (first use downloads ~45 MB, cached after that)…</span>`;

  try {
    const VoskLib = await loadVoskLib();

    if (!voskModel) {
      voskModel = await VoskLib.createModel(
        'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz'
      );
    }

    voskRec = new voskModel.KaldiRecognizer(16000);

    voskRec.on('result', msg => {
      const text = (msg.result?.text || '').trim();
      if (text) {
        fullTranscript += (fullTranscript ? ' ' : '') + text;
        updateTranscriptDisplay('');
        onNewFinalText(text);
      }
    });

    voskRec.on('partialresult', msg => {
      const partial = (msg.result?.partial || '').trim();
      if (partial) updateTranscriptDisplay(partial);
    });

    voskStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
    });

    voskAudioCtx  = new AudioContext();
    const source  = voskAudioCtx.createMediaStreamSource(voskStream);
    voskProcessor = voskAudioCtx.createScriptProcessor(4096, 1, 1);

    voskProcessor.onaudioprocess = event => {
      try { voskRec.acceptWaveform(event.inputBuffer); } catch (_) {}
    };

    source.connect(voskProcessor);
    voskProcessor.connect(voskAudioCtx.destination);

    setWhisperBadge('● Listening', 'recording');
    if (el && !fullTranscript) el.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Vosk ready — speak and text will appear here.</span>`;

  } catch (err) {
    console.error('[Vosk]', err);
    isListening = false;
    if (btn) {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg> Start Listening`;
      btn.classList.remove('active');
    }
    setWhisperBadge('');
    if (el) el.innerHTML = `<span style="color:var(--danger)">Vosk error: ${err.message}</span>`;
  }
}

function stopVoskCapture() {
  if (voskProcessor) { voskProcessor.disconnect(); voskProcessor = null; }
  if (voskAudioCtx)  { voskAudioCtx.close();       voskAudioCtx  = null; }
  if (voskStream)    { voskStream.getTracks().forEach(t => t.stop()); voskStream = null; }
  if (voskRec)       { voskRec.remove();            voskRec       = null; }
  setWhisperBadge('');
}

async function flushWhisperBuffer() {
  if (whisperBuffer.length < 8000) return; // need at least 0.5s of audio at 16 kHz
  const chunk = new Float32Array(whisperBuffer.splice(0, whisperBuffer.length));
  const modelId = settings.whisper_model || 'Xenova/whisper-base.en';

  setWhisperBadge('Processing…', 'processing');
  try {
    const result = await api.transcribeAudio(Array.from(chunk), modelId);
    if (result.ok && result.text.trim()) {
      const text = result.text.trim();
      fullTranscript += text + ' ';
      updateTranscriptDisplay('');
      onNewFinalText(text);
    }
  } catch (e) {
    console.warn('[Whisper] Transcription error:', e.message);
  }
  if (isListening) setWhisperBadge('Recording', 'recording');
}

function setWhisperBadge(text, cls) {
  const badge = document.getElementById('whisper-status');
  if (!badge) return;
  badge.textContent = text;
  badge.className   = text ? `whisper-status ${cls || ''}`.trim() : 'whisper-status';
}

// Called whenever a final block of text is committed from either engine
function onNewFinalText(text) {
  updateSermonSummary();
  checkVoiceCommands(text);
  schedulePrediction(text);
}

function updateTranscriptDisplay(interim) {
  const el = document.getElementById('transcript-text');
  if (!el) return;
  // Show last ~600 chars of final transcript + italic interim
  const recent = fullTranscript.slice(-600);
  el.innerHTML =
    escapeHtml(recent) +
    (interim ? `<span style="color:#484f58;font-style:italic"> ${escapeHtml(interim)}</span>` : '');
  el.scrollTop = el.scrollHeight;
}

// ── Bible prediction from speech ──────────────────────────────────────────────

// All 66 Bible books with common abbreviations (used for autocomplete + voice detection)
const BIBLE_BOOKS = [
  { name: 'Genesis',         abbrevs: ['gen'] },
  { name: 'Exodus',          abbrevs: ['exod','ex'] },
  { name: 'Leviticus',       abbrevs: ['lev'] },
  { name: 'Numbers',         abbrevs: ['num'] },
  { name: 'Deuteronomy',     abbrevs: ['deut','dt'] },
  { name: 'Joshua',          abbrevs: ['josh'] },
  { name: 'Judges',          abbrevs: ['judg','jdg'] },
  { name: 'Ruth',            abbrevs: ['rth'] },
  { name: '1 Samuel',        abbrevs: ['1sam'] },
  { name: '2 Samuel',        abbrevs: ['2sam'] },
  { name: '1 Kings',         abbrevs: ['1kgs'] },
  { name: '2 Kings',         abbrevs: ['2kgs'] },
  { name: '1 Chronicles',    abbrevs: ['1chr'] },
  { name: '2 Chronicles',    abbrevs: ['2chr'] },
  { name: 'Ezra',            abbrevs: ['ezra'] },
  { name: 'Nehemiah',        abbrevs: ['neh'] },
  { name: 'Esther',          abbrevs: ['est'] },
  { name: 'Job',             abbrevs: ['job'] },
  { name: 'Psalms',          abbrevs: ['ps','psa'] },
  { name: 'Proverbs',        abbrevs: ['prov'] },
  { name: 'Ecclesiastes',    abbrevs: ['eccl'] },
  { name: 'Song of Solomon', abbrevs: ['song','sos'] },
  { name: 'Isaiah',          abbrevs: ['isa'] },
  { name: 'Jeremiah',        abbrevs: ['jer'] },
  { name: 'Lamentations',    abbrevs: ['lam'] },
  { name: 'Ezekiel',         abbrevs: ['ezek'] },
  { name: 'Daniel',          abbrevs: ['dan'] },
  { name: 'Hosea',           abbrevs: ['hos'] },
  { name: 'Joel',            abbrevs: ['joel'] },
  { name: 'Amos',            abbrevs: ['amos'] },
  { name: 'Obadiah',         abbrevs: ['obad'] },
  { name: 'Jonah',           abbrevs: ['jon'] },
  { name: 'Micah',           abbrevs: ['mic'] },
  { name: 'Nahum',           abbrevs: ['nah'] },
  { name: 'Habakkuk',        abbrevs: ['hab'] },
  { name: 'Zephaniah',       abbrevs: ['zeph'] },
  { name: 'Haggai',          abbrevs: ['hag'] },
  { name: 'Zechariah',       abbrevs: ['zech'] },
  { name: 'Malachi',         abbrevs: ['mal'] },
  { name: 'Matthew',         abbrevs: ['matt','mt'] },
  { name: 'Mark',            abbrevs: ['mk','mrk'] },
  { name: 'Luke',            abbrevs: ['lk','luk'] },
  { name: 'John',            abbrevs: ['jn','jhn'] },
  { name: 'Acts',            abbrevs: ['acts'] },
  { name: 'Romans',          abbrevs: ['rom'] },
  { name: '1 Corinthians',   abbrevs: ['1cor'] },
  { name: '2 Corinthians',   abbrevs: ['2cor'] },
  { name: 'Galatians',       abbrevs: ['gal'] },
  { name: 'Ephesians',       abbrevs: ['eph'] },
  { name: 'Philippians',     abbrevs: ['phil'] },
  { name: 'Colossians',      abbrevs: ['col'] },
  { name: '1 Thessalonians', abbrevs: ['1thess'] },
  { name: '2 Thessalonians', abbrevs: ['2thess'] },
  { name: '1 Timothy',       abbrevs: ['1tim'] },
  { name: '2 Timothy',       abbrevs: ['2tim'] },
  { name: 'Titus',           abbrevs: ['titus'] },
  { name: 'Philemon',        abbrevs: ['phlm'] },
  { name: 'Hebrews',         abbrevs: ['heb'] },
  { name: 'James',           abbrevs: ['jas','jam'] },
  { name: '1 Peter',         abbrevs: ['1pet'] },
  { name: '2 Peter',         abbrevs: ['2pet'] },
  { name: '1 John',          abbrevs: ['1jn'] },
  { name: '2 John',          abbrevs: ['2jn'] },
  { name: '3 John',          abbrevs: ['3jn'] },
  { name: 'Jude',            abbrevs: ['jude'] },
  { name: 'Revelation',      abbrevs: ['rev'] },
];

// Detect a spoken/typed scripture reference — colon optional, space works too
// e.g. "John 3:16", "John 3 16", "First Corinthians 13 4"
const SCRIPTURE_REF_RE = /\b(?:(?:first|second|third|1st|2nd|3rd|1|2|3)\s+)?(?:genesis|gen|exodus|exod?|leviticus|lev|numbers|num|deuteronomy|deut|joshua|josh|judges|judg|ruth|(?:first|second|1st?|2nd?)\s*samuel|samuel|sam|(?:first|second|1st?|2nd?)\s*kings|kings|(?:first|second|1st?|2nd?)\s*chronicles|chronicles|chron|ezra|nehemiah|neh|esther|est|job|psalms?|ps|proverbs?|prov|ecclesiastes|eccl|song(?:\s*of\s*solomon)?|isaiah|isa|jeremiah|jer|lamentations|lam|ezekiel|ezek|daniel|dan|hosea|hos|joel|amos|obadiah|jonah|micah|mic|nahum|nah|habakkuk|hab|zephaniah|zeph|haggai|hag|zechariah|zech|malachi|mal|matthew|matt|mark|luke|john|acts|romans|rom|(?:first|second|1st?|2nd?)\s*corinthians|corinthians|cor|galatians|gal|ephesians|eph|philippians|phil|colossians|col|(?:first|second|1st?|2nd?)\s*thessalonians|thessalonians|thess|(?:first|second|1st?|2nd?)\s*timothy|timothy|tim|titus|philemon|phlm|hebrews|heb|james|jas|(?:first|second|1st?|2nd?)\s*peter|peter|pet|(?:first|second|third|1st?|2nd?|3rd?)\s*john|jude|revelation|rev)\s+(\d+)(?:[: ](\d+))?/i;

function detectScriptureRef(text) {
  const m = text.match(SCRIPTURE_REF_RE);
  return m ? m[0].trim() : null;
}

// ── Search autocomplete ───────────────────────────────────────────────────────

function updateBookAutocomplete() {
  const input    = document.getElementById('search-input');
  const dropdown = document.getElementById('search-autocomplete');
  if (!input || !dropdown) return;

  const val = input.value.trim().toLowerCase();

  // Only show book suggestions when no digits typed yet
  if (!val || /\d/.test(val)) { dropdown.style.display = 'none'; return; }

  const matches = BIBLE_BOOKS.filter(b =>
    b.name.toLowerCase().startsWith(val) ||
    b.abbrevs.some(a => a.startsWith(val))
  ).slice(0, 8);

  // Hide if no matches or the exact book is already typed
  if (!matches.length || (matches.length === 1 && matches[0].name.toLowerCase() === val)) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.innerHTML = matches.map(b =>
    `<div class="autocomplete-item" data-name="${escapeHtml(b.name)}">${escapeHtml(b.name)}</div>`
  ).join('');
  dropdown.style.display = 'block';

  dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault(); // keep input focused
      input.value = item.dataset.name + ' ';
      dropdown.style.display = 'none';
      input.focus();
      doSearch();
    });
  });
}

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','is','are',
  'was','were','be','been','being','have','has','had','do','does','did','will','would',
  'shall','should','may','might','must','can','could','that','this','these','those',
  'i','you','he','she','it','we','they','what','which','who','when','where','why',
  'how','all','each','every','both','few','more','most','other','some','such','no',
  'nor','not','only','own','same','so','than','too','very','just','as','said','going',
  'come','know','our','your','his','her','their','there','here','about','from',
]);

function extractKeywords(text) {
  return text.toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w)); // include 3-letter theological words: sin, God, law, ark, joy
}

function getConfidenceThreshold() {
  const conf = settings.confidence || 'medium';
  if (conf === 'low')  return 1;
  if (conf === 'high') return 4;
  return 2; // medium
}

function schedulePrediction(text) {
  clearTimeout(predictionTimeout);
  const delay = parseInt(settings.debounce_ms || 1500, 10);
  predictionTimeout = setTimeout(() => runPrediction(text), delay);
}

async function runPrediction(text) {
  const translation = document.getElementById('translation-select')?.value || 'KJV';
  let results = [];

  // Try direct reference match first (e.g. "John 3:16" spoken aloud)
  const ref = detectScriptureRef(text);
  if (ref) {
    results = await api.searchVerses(ref, translation);
  }

  // Fall back to keyword search if no reference found or no results
  if (!results.length) {
    const keywords = extractKeywords(text);
    if (keywords.length < getConfidenceThreshold()) return;
    results = await api.searchVerses(keywords.slice(0, 4).join(' '), translation);
  }

  showPredictions(results.slice(0, 5));

  // Auto-project if enabled
  if (settings.auto_project === true || settings.auto_project === 'true') {
    const requireSession = settings.require_session !== 'false';
    if (requireSession && !activeSession) return;

    const now      = Date.now();
    const cooldown = parseInt(settings.proj_debounce || 5, 10) * 1000;
    if (now - lastProjectedAt < cooldown) return;

    if (results.length) {
      selectVerse(results[0], null);
      await pushVerse();
      lastProjectedAt = Date.now();
    }
  }
}

function showPredictions(verses) {
  const lbl  = document.getElementById('predictions-lbl');
  const list = document.getElementById('predictions-list');
  if (!lbl || !list) return;

  if (!verses.length) {
    lbl.style.display  = 'none';
    list.innerHTML     = '';
    return;
  }

  lbl.style.display = 'block';
  list.innerHTML = verses.map((v, i) => `
    <div class="prediction-item" data-idx="${i}">
      <div class="prediction-ref">${escapeHtml(v.reference || formatRef(v))}</div>
      <div class="prediction-text">${escapeHtml(v.text)}</div>
    </div>
  `).join('');

  list.querySelectorAll('.prediction-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      list.querySelectorAll('.prediction-item').forEach(p => p.classList.remove('selected'));
      el.classList.add('selected');
      selectVerse(verses[i], el);
    });
  });
}

// ── Voice commands ────────────────────────────────────────────────────────────

function checkVoiceCommands(text) {
  if (!document.getElementById('voice-cmds-toggle')?.checked) return;
  const lower = text.toLowerCase().trim();

  if (/\b(next|next verse)\b/.test(lower)) {
    navigateVerse('next');
  } else if (/\b(previous|previous verse|go back)\b/.test(lower)) {
    navigateVerse('prev');
  } else if (/\b(clear|clear screen|clear the screen|hide|hide screen|hide the screen)\b/.test(lower)) {
    if (!isBlank) toggleBlank();
  } else if (/\b(show|show verse|project|project verse)\b/.test(lower)) {
    if (isBlank) toggleBlank();
    else if (selectedVerse) pushVerse();
  } else if (/\b(repeat|repeat that|repeat verse)\b/.test(lower)) {
    if (selectedVerse) pushVerse();
  }
}

async function navigateVerse(direction) {
  const result = await api.navigateVerse(direction === 'next' ? 'next' : 'prev');
  if (result.ok && result.verse) {
    selectVerse(result.verse, null);
    await pushVerse();
  }
}

// ── Sermon Summary ────────────────────────────────────────────────────────────

function updateSermonSummary() {
  const el    = document.getElementById('summary-text');
  if (!el) return;
  const words = fullTranscript.trim().split(/\s+/).filter(Boolean);

  if (words.length < 15) {
    el.textContent = 'Summary builds as the sermon progresses…';
    return;
  }

  // Keyword-based summary is always shown immediately
  const keywords = extractKeywords(fullTranscript);
  const freq     = {};
  keywords.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const topWords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  const localSummary = `${words.length} words · Themes: ${topWords.join(', ')}`;

  // If AI summary is enabled and enough new words have accumulated, trigger it
  const useAI  = settings.ai_summary === 'true';
  const apiKey = settings.openai_api_key || '';
  const newWords = words.length - summaryWordCount;

  if (useAI && apiKey && newWords >= 200) {
    summaryWordCount = words.length;
    summarizeWithAI(localSummary);
  } else if (!useAI || !apiKey) {
    // Update badge to show "Local" mode
    const badge = document.getElementById('summary-provider-badge');
    if (badge) { badge.textContent = 'Local'; badge.className = 'whisper-status'; }
    el.textContent = localSummary;
  }
}

async function summarizeWithAI(fallbackText) {
  const el     = document.getElementById('summary-text');
  const badge  = document.getElementById('summary-provider-badge');
  const apiKey = settings.openai_api_key || '';

  if (badge) { badge.textContent = 'AI'; badge.className = 'whisper-status ai'; }
  if (el) el.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Generating AI summary…</span>`;

  try {
    const result = await api.summarizeSermon(fullTranscript, apiKey);
    if (result.ok && el) {
      el.textContent = result.summary;
    } else {
      if (el) el.textContent = fallbackText;
      if (result.error !== 'insufficient_data') console.warn('[AI Summary]', result.error);
    }
  } catch (e) {
    if (el) el.textContent = fallbackText;
  }
}

// ── Translations ──────────────────────────────────────────────────────────────

async function loadTranslations() {
  const translations = await api.listTranslations();
  const select       = document.getElementById('translation-select');
  if (!select) return;

  select.innerHTML = '';

  if (!translations.length) {
    const opt       = document.createElement('option');
    opt.value       = '';
    opt.textContent = 'No translations — see Search sidebar';
    select.appendChild(opt);
    refreshInstalledList([]);
    return;
  }

  translations.forEach(t => {
    const opt       = document.createElement('option');
    opt.value       = t.abbreviation;
    opt.textContent = `${t.abbreviation} — ${t.name}`;
    select.appendChild(opt);
  });

  refreshInstalledList(translations);
}

function refreshInstalledList(translations) {
  // Right sidebar Search pane
  const el = document.getElementById('translations-list');
  if (el) {
    if (!translations.length) {
      el.textContent = 'None installed yet.';
    } else {
      el.innerHTML = translations.map(t =>
        `<span class="translation-badge-item">${escapeHtml(t.abbreviation)}</span>`
      ).join('');
    }
  }

  // Settings view
  const sel = document.getElementById('settings-translations-list');
  if (sel) {
    if (!translations.length) {
      sel.textContent = 'None installed yet.';
    } else {
      sel.innerHTML = translations.map(t =>
        `<div class="dl-row">
          <div class="dl-info">
            <div class="dl-name">${escapeHtml(t.name)}</div>
            <div class="dl-abbr">${escapeHtml(t.abbreviation)} · ${escapeHtml(t.language)}</div>
          </div>
          <span style="color:var(--success);font-size:0.78rem">✓ Installed</span>
        </div>`
      ).join('');
    }
  }
}

// Available translations (download list)
let availableCache = [];
let installedAbbrs = new Set();

async function loadAvailableTranslations() {
  availableCache = await api.listAvailableTranslations();
  const installed  = await api.listTranslations();
  installedAbbrs   = new Set(installed.map(t => t.abbreviation.toLowerCase()));
  renderAvailableList();
}

function renderAvailableList() {
  renderAvailableInto('settings-available-list');
}

function renderAvailableInto(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!availableCache.length) { el.textContent = 'None available.'; return; }

  // Group by language
  const byLang = {};
  for (const t of availableCache) {
    if (!byLang[t.language]) byLang[t.language] = [];
    byLang[t.language].push(t);
  }

  let html = '';
  for (const [lang, list] of Object.entries(byLang)) {
    html += `<div style="margin-bottom:10px">`;
    html += `<div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px">${escapeHtml(lang)}</div>`;
    for (const t of list) {
      const installed = installedAbbrs.has(t.abbr.toLowerCase());
      html += `<div class="dl-row" data-abbr="${t.abbr}">
        <div class="dl-info">
          <div class="dl-name">${escapeHtml(t.name)}</div>
          <div class="dl-abbr">${escapeHtml(t.abbr.toUpperCase())}</div>
        </div>
        <button
          class="btn btn-secondary btn-sm dl-btn"
          data-abbr="${t.abbr}"
          style="min-width:78px;font-size:0.72rem"
          ${installed ? 'disabled' : ''}
        >${installed ? '✓ Installed' : '↓ Download'}</button>
      </div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;

  el.querySelectorAll('.dl-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => downloadTranslation(btn.dataset.abbr, btn));
  });
}

async function downloadTranslation(abbr, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  setImportStatus(`Downloading ${abbr.toUpperCase()}…`, 'var(--text-muted)');

  const result = await api.downloadTranslation(abbr);

  if (result.ok) {
    setImportStatus(
      `Downloaded "${result.name}" — ${result.count.toLocaleString()} verses.`,
      'var(--success)'
    );
    installedAbbrs.add(abbr.toLowerCase());
    if (btn) btn.textContent = '✓ Installed';
    await loadTranslations();
    renderAvailableList();
  } else {
    setImportStatus(`Download failed: ${result.error}`, 'var(--danger)');
    if (btn) { btn.disabled = false; btn.textContent = '↓ Download'; }
  }
}

async function importTranslationFile(statusId) {
  setImportStatus('Opening file picker…', 'var(--text-muted)', statusId);
  const result = await api.importTranslationFile();
  if (result.canceled) { setImportStatus('', '', statusId); return; }
  if (result.ok) {
    setImportStatus(`Imported "${result.name}" — ${result.count.toLocaleString()} verses.`, 'var(--success)', statusId);
    await loadTranslations();
    await loadAvailableTranslations();
  } else {
    setImportStatus('Import failed: ' + result.error, 'var(--danger)', statusId);
  }
}

function setImportStatus(msg, color, id = 'import-status') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent  = msg;
  el.style.color  = color;
}

// ── Search ────────────────────────────────────────────────────────────────────

function onSearchInput() {
  clearTimeout(searchTimeout);
  updateBookAutocomplete();
  searchTimeout = setTimeout(doSearch, 300);
}

async function doSearch() {
  const query       = document.getElementById('search-input')?.value.trim();
  const translation = document.getElementById('translation-select')?.value;
  const list        = document.getElementById('results-list');
  if (!list) return;

  if (!query) {
    list.innerHTML = '<div class="no-results">Search for a verse above</div>';
    selectedVerse  = null;
    updatePushButton();
    return;
  }

  if (!translation) {
    list.innerHTML = '<div class="no-results">Load a Bible translation first</div>';
    return;
  }

  const results = await api.searchVerses(query, translation);

  if (!results.length) {
    list.innerHTML = '<div class="no-results">No verses found</div>';
    selectedVerse  = null;
    updatePushButton();
    return;
  }

  list.innerHTML = '';
  results.forEach((v) => {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-ref">${escapeHtml(v.reference || formatRef(v))}</div>
      <div class="result-text">${escapeHtml(v.text)}</div>
    `;
    item.addEventListener('click', () => {
      document.querySelectorAll('.result-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      selectVerse(v, item);
    });
    list.appendChild(item);
  });
}

function selectVerse(verse, _el) {
  if (!verse.reference) verse.reference = formatRef(verse);
  selectedVerse = verse;
  updatePushButton();
  updateStudioPreview(verse);
}

function updateStudioPreview(verse) {
  const el = document.getElementById('studio-canvas');
  if (!el) return;
  if (!verse) {
    el.innerHTML = '<div class="preview-placeholder">Search for a verse to queue</div>';
    return;
  }
  el.innerHTML = `
    <div style="padding:12px 16px;text-align:center;width:100%">
      <div class="studio-ref">${escapeHtml(verse.reference || formatRef(verse))}</div>
      <div class="studio-text">"${escapeHtml(verse.text)}"</div>
    </div>
  `;
}

function updatePushButton() {
  const btn = document.getElementById('push-btn');
  if (btn) btn.disabled = !selectedVerse;
}

function formatRef(v) {
  return `${v.book} ${v.chapter}:${v.verse}`;
}

// ── Display controls ──────────────────────────────────────────────────────────

async function pushVerse() {
  if (!selectedVerse) return;
  isBlank = false;

  // Auto-open display window if it isn't already open
  if (!displayWindowOpen) {
    const r = await api.openDisplay();
    displayWindowOpen = !!r.open;
    updateDisplayBtn();
  }

  const verse = { ...selectedVerse };
  if (!verse.translation) {
    verse.translation = document.getElementById('translation-select')?.value || 'KJV';
  }

  await api.pushVerse(verse);
  updateBlankBtn(false);
  updateLivePreview(verse, false);
  updateLiveBadge(true);
  syncDisplayPreviewLarge(verse);
  await refreshHistory();
}

async function toggleBlank() {
  isBlank = !isBlank;
  await api.blankDisplay(isBlank);
  updateBlankBtn(isBlank);
  updateLiveBadge(!isBlank && !!selectedVerse);

  const canvas = document.getElementById('live-canvas');
  if (canvas) canvas.classList.toggle('blanked', isBlank);

  if (isBlank) {
    const dc = document.getElementById('display-canvas');
    if (dc) dc.innerHTML = '<div class="preview-empty">Display blanked</div>';
  }
}

function updateBlankBtn(blanked) {
  // Reflect blank state in the clear button text
  const btn = document.getElementById('clear-btn');
  if (btn) {
    btn.textContent = blanked ? 'Unblank' : 'Clear';
  }
}

function updateLiveBadge(live) {
  const badge = document.getElementById('live-badge');
  if (!badge) return;
  badge.textContent = live ? 'LIVE' : 'STANDBY';
  badge.className   = 'live-badge' + (live ? ' live' : '');
}

function updateLivePreview(verse, blanked) {
  const canvas = document.getElementById('live-canvas');
  if (!canvas) return;

  if (blanked || !verse) {
    canvas.innerHTML = '<div class="preview-empty">No verse on display</div>';
    updateStatusBadge(false);
    return;
  }

  canvas.innerHTML = `
    <div style="padding:12px;text-align:center;width:100%">
      <div class="preview-reference">${escapeHtml(verse.reference || formatRef(verse))}</div>
      <div class="preview-text">"${escapeHtml(verse.text)}"</div>
    </div>
  `;
  updateStatusBadge(true);
}

function syncDisplayPreviewLarge(verse) {
  const canvas = document.getElementById('display-canvas');
  if (!canvas) return;

  const v = verse || selectedVerse;
  if (!v) {
    canvas.innerHTML = '<div class="preview-empty">No verse on display</div>';
    return;
  }

  canvas.innerHTML = `
    <div style="padding:28px 48px;text-align:center;width:100%">
      <div class="preview-reference" style="font-size:1.4rem;margin-bottom:16px">${escapeHtml(v.reference || formatRef(v))}</div>
      <div class="preview-text" style="font-size:1.6rem">"${escapeHtml(v.text)}"</div>
    </div>
  `;
}

async function syncDisplayState() {
  const state = await api.getDisplayState();
  if (!state) return;

  const visible = state.is_visible === 1;
  isBlank       = !visible;

  updateBlankBtn(isBlank);
  updateStatusBadge(visible && !!state.current_text);
  updateLiveBadge(visible && !!state.current_text);

  // Update the output status in Outputs pane
  const statusEl = document.getElementById('output-status-text');
  if (statusEl) {
    statusEl.textContent = visible && state.current_text
      ? `Projecting: ${state.current_reference || ''}`
      : 'Standby';
  }

  if (state.current_text) {
    const canvas = document.getElementById('live-canvas');
    // Always update live canvas from DB state (removes stale DOM guard that blocked external changes)
    if (canvas) {
      canvas.innerHTML = `
        <div style="padding:12px;text-align:center;width:100%">
          <div class="preview-reference">${escapeHtml(state.current_reference || '')}</div>
          <div class="preview-text">"${escapeHtml(state.current_text)}"</div>
        </div>
      `;
      canvas.classList.toggle('blanked', !visible);
    }
  }
}

function updateDisplayBtn() {
  const btn = document.getElementById('open-display-btn');
  if (!btn) return;
  if (displayWindowOpen) {
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Close Display`;
  } else {
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Open Display`;
  }
}

function updateStatusBadge(live) {
  const dot  = document.getElementById('display-status-dot');
  const text = document.getElementById('display-status-text');
  if (dot)  dot.className    = 'status-dot' + (live ? ' live' : '');
  if (text) text.textContent = live ? 'Live' : 'Display off';

  // Outputs pane badge + status text
  const outBadge = document.getElementById('live-badge-out');
  if (outBadge) {
    outBadge.textContent = live ? 'LIVE' : 'STANDBY';
    outBadge.className   = 'live-badge' + (live ? ' live' : '');
  }
  const outStatus = document.getElementById('output-verse-status');
  if (outStatus) {
    outStatus.textContent = live && selectedVerse
      ? `${selectedVerse.reference || ''}`
      : 'No verse on display';
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────────

async function loadSessions() {
  activeSession = await api.getActiveSession();

  const nameEl = document.getElementById('session-name');
  if (nameEl) {
    nameEl.textContent = activeSession ? activeSession.name : 'No session active';
  }

  const sessions = await api.listSessions();
  const list     = document.getElementById('session-list');
  if (!list) return;

  list.innerHTML = '';

  if (!sessions.length) {
    list.innerHTML = '<li style="color:var(--text-muted);font-size:0.8rem;padding:8px 4px">No sessions yet.</li>';
    return;
  }

  sessions.forEach(s => {
    const li = document.createElement('li');
    li.className = 'session-item' + (s.is_active ? ' active-session' : '');
    li.innerHTML = `
      <div class="session-name">${escapeHtml(s.name)} ${s.is_active ? '<span style="color:var(--success);font-size:0.7rem">● active</span>' : ''}</div>
      <div class="session-meta">${s.created_at}</div>
    `;
    li.addEventListener('click', () => refreshHistory(s.id));
    list.appendChild(li);
  });
}

async function createSession() {
  const input = document.getElementById('session-name-input');
  const name  = input?.value.trim();
  if (!name) return;

  await api.createSession(name);
  if (input) input.value = '';
  await loadSessions();

  // Auto-start transcription if setting enabled
  if (settings.autostart_transcription === 'true' && !isListening) {
    toggleListening();
  }
}

// ── History ───────────────────────────────────────────────────────────────────

async function refreshHistory(sessionId) {
  const sess = sessionId
    ? { id: sessionId }
    : await api.getActiveSession();

  const list = document.getElementById('history-list');
  if (!list) return;

  if (!sess) {
    list.innerHTML = '<div class="no-results">No active session</div>';
    return;
  }

  const verses = await api.getSessionVerses(sess.id);

  if (!verses.length) {
    list.innerHTML = '<div class="no-results">No verses logged in this session</div>';
    return;
  }

  list.innerHTML = verses.map(v => `
    <div class="history-verse">
      <div class="history-ref">
        ${escapeHtml(v.reference)}
        <small>${escapeHtml(v.translation)}</small>
      </div>
      <div class="history-text">${escapeHtml(v.text)}</div>
    </div>
  `).join('');
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadAllSettings() {
  const s  = await api.getSettings();
  // Migrate: Web Speech API doesn't work in Electron — move to Vosk
  if (!s.whisper_provider || s.whisper_provider === 'webspeech') {
    s.whisper_provider = 'vosk';
    api.saveSetting('whisper_provider', 'vosk');
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
  if (fontEl && s.font_size) fontEl.value = s.font_size;

  const colorEl = document.getElementById('setting-text-color');
  if (colorEl && s.text_color) colorEl.value = s.text_color;

  const transEl = document.getElementById('setting-transition-speed');
  const transLbl = document.getElementById('transition-speed-val');
  if (transEl && s.transition_speed) {
    transEl.value = s.transition_speed;
    if (transLbl) transLbl.textContent = parseFloat(s.transition_speed).toFixed(1) + 's';
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

  // Show the correct bg sub-row
  const bgType = s.bg_type || 'solid';
  const solidRow = document.getElementById('bg-solid-row');
  const gradRow  = document.getElementById('bg-gradient-row');
  const imgRow   = document.getElementById('bg-image-row');
  if (solidRow) solidRow.style.display = bgType === 'solid'    ? 'flex'  : 'none';
  if (gradRow)  gradRow.style.display  = bgType === 'gradient' ? 'block' : 'none';
  if (imgRow)   imgRow.style.display   = bgType === 'image'    ? 'block' : 'none';

  // Restore HDMI toggle & auto-open display if it was enabled
  // Only auto-open once on initial load — not on every settings save/reload
  const hdmiToggle = document.getElementById('hdmi-toggle');
  if (hdmiToggle) {
    const hdmiEnabled = s.hdmi_enabled !== 'false'; // default true
    hdmiToggle.checked = hdmiEnabled;
    if (!settingsLoaded && hdmiEnabled && !displayWindowOpen) {
      // Delay slightly so KJV auto-seed (800ms) completes before display window opens
      setTimeout(async () => {
        if (!displayWindowOpen) {
          const r = await api.openDisplay();
          displayWindowOpen = !!r.open;
          updateDisplayBtn();
        }
      }, 1200);
    }
  }

  // Restore NDI toggle & re-open NDI window if it was enabled (only on first load)
  const ndiToggle = document.getElementById('ndi-toggle');
  if (ndiToggle) {
    const ndiEnabled = s.ndi_enabled === 'true';
    ndiToggle.checked = ndiEnabled;
    if (!settingsLoaded && ndiEnabled) await api.openNdiDisplay(true);
  }

  // Restore HDMI layout button
  if (s.hdmi_layout) setActiveSegBtn('hdmi-layout', s.hdmi_layout);
  if (s.ndi_layout)  setActiveSegBtn('ndi-layout',  s.ndi_layout);

  settingsLoaded = true;
}

async function loadSettingsView() {
  const s = await api.getSettings();

  // Transcription & Audio
  setSelectVal('setting-whisper-provider', s.whisper_provider || 'vosk');
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
  setSelectVal('settings-font-size',   s.font_size);
  setCheckbox('setting-show-translation', s.show_translation !== 'false');
  setCheckbox('setting-show-reference',   s.show_reference   !== 'false');
  if (s.standby_bg_type) setActiveSegBtn('standby-bg-type', s.standby_bg_type);
  setInputVal('setting-standby-url', s.standby_url);
  // Session
  setInputVal('setting-default-session-name', s.default_session_name || 'Sunday Morning Service');
  setCheckbox('setting-auto-session',      s.auto_session      === 'true');
  setCheckbox('setting-clear-transcript',  s.clear_transcript  === 'true');
  // Application
  setCheckbox('setting-show-shortcuts', s.show_shortcuts === 'true');

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
    ['show_translation',        getCheckbox('setting-show-translation')],
    ['show_reference',          getCheckbox('setting-show-reference')],
    ['standby_bg_type',         getActiveSegBtn('standby-bg-type')],
    ['standby_url',             getInputVal('setting-standby-url')],
    ['default_session_name',    getInputVal('setting-default-session-name')],
    ['auto_session',            getCheckbox('setting-auto-session')],
    ['clear_transcript',        getCheckbox('setting-clear-transcript')],
    ['show_shortcuts',          getCheckbox('setting-show-shortcuts')],
  ];

  for (const [k, v] of pairs) {
    if (v !== null && v !== undefined) await api.saveSetting(k, String(v));
  }

  // Reload settings cache
  await loadAllSettings();
  showToast('Settings saved');
}

async function saveDisplaySettings() {
  const theme      = document.getElementById('setting-theme')?.value;
  const fontSize   = document.getElementById('setting-font-size')?.value;
  const textColor  = document.getElementById('setting-text-color')?.value;
  const transition = document.getElementById('setting-transition-speed')?.value;
  const bgType     = document.querySelector('#rs-bg-type .seg-btn.active')?.dataset.val || 'solid';
  const bgColor    = document.getElementById('setting-bg-color')?.value       || '#000000';
  const bgGradS    = document.getElementById('setting-bg-grad-start')?.value  || '#0a1628';
  const bgGradE    = document.getElementById('setting-bg-grad-end')?.value    || '#1a3a5c';
  const bgImageUrl = document.getElementById('setting-bg-image-url')?.value   || '';

  if (theme)      await api.saveSetting('theme', theme);
  if (fontSize)   await api.saveSetting('font_size', fontSize);
  if (textColor)  await api.saveSetting('text_color', textColor);
  if (transition !== undefined) await api.saveSetting('transition_speed', transition);
  await api.saveSetting('bg_type',           bgType);
  await api.saveSetting('bg_color',          bgColor);
  await api.saveSetting('bg_gradient_start', bgGradS);
  await api.saveSetting('bg_gradient_end',   bgGradE);
  if (bgImageUrl) await api.saveSetting('bg_image_url', bgImageUrl);

  await loadAllSettings();
  showToast('Display settings saved');
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

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 2500);
}

// ── Event binding ─────────────────────────────────────────────────────────────

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
    if (e.key === 'Escape') {
      document.getElementById('search-autocomplete').style.display = 'none';
    } else if (e.key === 'Enter') {
      document.getElementById('search-autocomplete').style.display = 'none';
      doSearch();
    }
  });
  document.getElementById('search-input')?.addEventListener('blur', () => {
    setTimeout(() => {
      const d = document.getElementById('search-autocomplete');
      if (d) d.style.display = 'none';
    }, 150);
  });
  document.getElementById('translation-select')?.addEventListener('change', doSearch);
  document.getElementById('find-btn')?.addEventListener('click', doSearch);

  // Display controls
  document.getElementById('push-btn')?.addEventListener('click', pushVerse);
  document.getElementById('clear-btn')?.addEventListener('click', () => {
    if (isBlank) toggleBlank(); // unblank
    else toggleBlank();         // blank
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
  document.getElementById('session-name-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') createSession();
  });

  // Right sidebar Display pane
  document.getElementById('save-settings-btn')?.addEventListener('click', saveDisplaySettings);
  document.getElementById('reset-color-btn')?.addEventListener('click', () => {
    const colorEl = document.getElementById('setting-text-color');
    if (colorEl) colorEl.value = '#ffffff';
  });

  // Background color presets
  document.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const colorEl = document.getElementById('setting-bg-color');
      if (colorEl) colorEl.value = btn.dataset.color;
    });
  });

  // Gradient presets
  document.querySelectorAll('.grad-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const startEl = document.getElementById('setting-bg-grad-start');
      const endEl   = document.getElementById('setting-bg-grad-end');
      if (startEl) startEl.value = btn.dataset.start;
      if (endEl)   endEl.value   = btn.dataset.end;
    });
  });

  // Background image file upload
  document.getElementById('bg-upload-btn')?.addEventListener('click', () => {
    document.getElementById('bg-file-input')?.click();
  });
  document.getElementById('bg-file-input')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await api.saveBackgroundImage(file.path);
    if (result.ok) {
      const urlEl = document.getElementById('setting-bg-image-url');
      if (urlEl) urlEl.value = result.filePath;
      showToast('Image uploaded');
    } else {
      showToast('Upload failed: ' + result.error);
    }
  });

  // Right sidebar Outputs pane — toggle display window
  document.getElementById('open-display-btn')?.addEventListener('click', async () => {
    const result = await api.openDisplay();
    displayWindowOpen = !!result.open;
    updateDisplayBtn();
  });
  document.getElementById('hdmi-toggle')?.addEventListener('change', async e => {
    const want = e.target.checked;
    // Sync display window open/closed state with the HDMI toggle
    if (want !== displayWindowOpen) {
      const r = await api.openDisplay();
      displayWindowOpen = !!r.open;
      updateDisplayBtn();
    }
    api.saveSetting('hdmi_enabled', want.toString());
  });
  document.getElementById('ndi-toggle')?.addEventListener('change', async e => {
    const want = e.target.checked;
    await api.openNdiDisplay(want);
    api.saveSetting('ndi_enabled', want.toString());
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
      isBlank = !data.visible;
      updateBlankBtn(isBlank);
      updateLiveBadge(data.visible && !!selectedVerse);
      updateStatusBadge(data.visible && !!selectedVerse);
      const canvas = document.getElementById('live-canvas');
      if (canvas) canvas.classList.toggle('blanked', !data.visible);
    }
  });

  // Display window closed by OS — keep displayWindowOpen flag in sync
  api.onDisplayClosed(() => {
    displayWindowOpen = false;
    updateDisplayBtn();
    updateStatusBadge(false);
    updateLiveBadge(false);
    const hdmiToggle = document.getElementById('hdmi-toggle');
    if (hdmiToggle) hdmiToggle.checked = false;
    api.saveSetting('hdmi_enabled', 'false');
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

async function checkForUpdates() {
  const statusEl = document.getElementById('update-status-text');
  if (statusEl) statusEl.textContent = 'Checking…';
  try {
    const result = await api.checkForUpdates();
    updateInfo = result;
    if (!result.ok) {
      if (statusEl) statusEl.textContent = 'Check failed';
      return;
    }
    if (statusEl) {
      statusEl.textContent = result.updateAvailable
        ? `v${result.latestVersion} available`
        : `Up to date (v${result.currentVersion})`;
    }
    if (result.updateAvailable) showUpdateBanner(result);
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Check failed';
  }
}

function showUpdateBanner(info) {
  const banner = document.getElementById('update-banner');
  const text   = document.getElementById('update-banner-text');
  if (!banner) return;
  text.textContent = `BibleCast v${info.latestVersion} is available — you have v${info.currentVersion}`;
  banner.style.display = 'flex';
  document.getElementById('update-download-btn').onclick = () => api.openRelease(info.downloadUrl);
  document.getElementById('update-dismiss-btn').onclick  = () => { banner.style.display = 'none'; };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Start ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
