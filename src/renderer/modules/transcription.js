/* BibleCast: speech-to-text engines for the operator panel
 *
 * Owns four parallel transcription paths and the common badges /
 * transcript display they all feed into:
 *
 *   Web Speech API   in-process (recognition + onresult)
 *   Chrome bridge    out-of-process (api.startChromeBridge, hidden Chrome)
 *   Whisper local    @xenova/transformers via main process IPC
 *   Vosk             vosk-browser WASM, fully offline
 *
 * Cross-module references (all resolve at call time, after every classic
 * <script> in index.html has finished parsing):
 *
 *   appendToTranscript, escapeHtml, showToast       (utils-renderer / utils-browser)
 *   settings, api                                   (state)
 *   updateSermonSummary                             (summary)
 *   checkVoiceCommands                              (voice-commands)
 *   schedulePrediction                              (still in renderer.js)
 */

// ── Transcription engine state ────────────────────────────────────────────────

let recognition        = null;
let isListening        = false;
let fullTranscript     = '';
let predictionTimeout  = null;

// Whisper AI audio capture state
let whisperAudioCtx    = null;
let whisperProcessor   = null;
let whisperStream      = null;
let whisperBuffer      = [];          // raw Float32 samples at 16 kHz
let whisperFlushTimer  = null;        // interval to flush buffer every N seconds
let whisperReady       = false;       // pipeline loaded flag

// Vosk (vosk-browser WASM) audio capture state
let voskModel          = null;
let voskRec            = null;
let voskAudioCtx       = null;
let voskProcessor      = null;
let voskStream         = null;

// ── Speech recognition: provider-aware ────────────────────────────────────────

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
        const res = event.results[i];
        const t   = (res[0].transcript || '').trim();
        if (!t) continue;
        if (res.isFinal) {
          const conf = res[0].confidence;
          if (conf > 0 && conf < 0.15) continue;
          finalDelta += t + ' ';
          appendToTranscript(t + ' ');
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
      // Persistent errors: stop the engine cleanly and inform the user.
      const PERSISTENT = ['not-allowed', 'audio-capture', 'service-not-allowed', 'network'];
      if (PERSISTENT.includes(e.error)) {
        isListening = false;
        // Drain every engine, not just recognition.stop(). The auto-switch
        // below changes the cached provider; without a full stop, the
        // recognition object's onend handler keeps trying to restart.
        stopActiveTranscription();
        const btn = document.getElementById('listen-btn');
        if (btn) {
          btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg> Start Listening`;
          btn.classList.remove('active');
        }
        const el = document.getElementById('transcript-text');
        if (!el) return;
        // Network/service errors: auto-switch to Whisper AI silently
        if (['network', 'service-not-allowed'].includes(e.error)) {
          settings.whisper_provider = 'whisper-local';
          api.saveSetting('whisper_provider', 'whisper-local');
          const sel = document.getElementById('setting-whisper-provider');
          if (sel) sel.value = 'whisper-local';
          el.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Web Speech unavailable (${e.error}), switched to Whisper AI automatically. Press Start Listening to begin.</span>`;
        } else {
          el.innerHTML = `<span style="color:var(--danger)">⚠ Speech error: <strong>${e.error}</strong>, check mic permissions in Settings.</span>`;
        }
      }
    };

    recognition.onend = () => {
      // Delay restart so onerror (which fires before onend) has time to
      // set isListening=false. The provider check is intentionally
      // strict-equality to 'web-speech': if the operator switched mid-
      // session to Vosk or Whisper, this handler is still attached but
      // must not auto-restart Web Speech alongside the new engine.
      if (isListening && settings.whisper_provider === 'web-speech') {
        setTimeout(() => {
          if (isListening && settings.whisper_provider === 'web-speech') {
            try { recognition.lang = 'en-US'; recognition.start(); } catch (_) {}
          }
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
      if (tEl && !fullTranscript) tEl.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Downloading Whisper AI model ${pct}, transcription will begin shortly...</span>`;
    } else if (progress.status === 'initiate' || progress.status === 'progress') {
      badge.textContent = 'Loading model...';
      badge.className   = 'whisper-status downloading';
      if (tEl && !fullTranscript) tEl.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Loading Whisper AI model...</span>`;
    } else if (progress.status === 'done') {
      whisperReady = true;
      badge.textContent = 'Whisper ready';
      badge.className   = 'whisper-status ai';
      if (tEl && !fullTranscript) tEl.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Whisper AI ready, speak and text will appear here.</span>`;
      setTimeout(() => { badge.textContent = 'Whisper AI'; }, 3000);
    }
  });
}

// Stop every transcription engine, regardless of which one is currently
// running. Each engine-specific stop guards its own state, so calling
// it for an engine that was never started is a no-op. Used by the
// off-branch of toggleListening, by the network-error auto-switch, and
// by the renderer's setting-whisper-provider change handler so a
// mid-session provider swap can't leak the previous engine's mic and
// audio graph.
function stopActiveTranscription() {
  if (recognition) {
    try { recognition.stop(); } catch (_) {}
  }
  stopChromeBridgeCapture();
  stopWhisperCapture();
  stopVoskCapture();
  setWhisperBadge('');
}

function toggleListening() {
  isListening = !isListening;
  const btn = document.getElementById('listen-btn');

  if (isListening) {
    if (settings.whisper_provider === 'whisper-local') {
      startWhisperCapture();
    } else if (settings.whisper_provider === 'vosk') {
      startVoskCapture();
    } else if (settings.whisper_provider === 'web-speech') {
      startChromeBridgeCapture();
    } else {
      isListening = false;
      return;
    }
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg> Stop Listening`;
    btn.classList.add('active');
  } else {
    // Stop every engine, not just the one matching the current provider:
    // the provider may have changed mid-session, in which case the original
    // engine is still running and selecting its stop function by name would
    // miss it.
    stopActiveTranscription();
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg> Start Listening`;
    btn.classList.remove('active');
  }
}

// ── Out-of-process Web Speech bridge ──────────────────────────────────────────
let chromeBridgeReady = false;

function startChromeBridgeCapture() {
  if (!chromeBridgeReady) {
    // Data from Chrome: { interim: string, final: string }
    api.onChromeSpeechResult((data) => {
      if (data.final) {
        appendToTranscript((fullTranscript ? ' ' : '') + data.final);
        updateTranscriptDisplay('');
        onNewFinalText(data.final);
      } else if (data.interim) {
        updateTranscriptDisplay(data.interim);
      }
    });

    api.onChromeSpeechError((msg) => {
      console.warn('[ChromeBridge] Speech error:', msg);
      if (msg && (msg.includes('aborted') || msg.includes('no-speech'))) return;
      const el = document.getElementById('transcript-text');
      if (el) el.innerHTML = `<span style="color:var(--danger)">Web Speech error: ${escapeHtml(msg)}</span>`;
    });

    chromeBridgeReady = true;
  }

  api.startChromeBridge().then(res => {
    if (!res.ok) {
      isListening = false;
      const el  = document.getElementById('transcript-text');
      const btn = document.getElementById('listen-btn');
      if (el) el.innerHTML = `<span style="color:var(--danger)">⚠ Web Speech Bridge Error: <strong>${escapeHtml(res.error || 'Chrome not found')}</strong></span>`;
      if (btn) {
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg> Start Listening`;
        btn.classList.remove('active');
      }
      setWhisperBadge('');
    } else {
      setWhisperBadge('● Listening (Chrome)', 'recording');
      const el = document.getElementById('transcript-text');
      if (el && !fullTranscript) el.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Chrome Web Speech active, speak and text will appear here.</span>`;
    }
  });
}

function stopChromeBridgeCapture() {
  api.stopChromeBridge();
}

// ── Whisper AI: local neural network via @xenova/transformers ─────────────────

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
    // Clean up any partial state from a failed init: getUserMedia may have
    // succeeded before AudioContext or ScriptProcessor threw. stopWhisperCapture
    // guards each field individually so it's safe to call from any partial state.
    stopWhisperCapture();
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

// ── Vosk (vosk-browser WASM): real-time offline speech recognition ────────────

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
  setWhisperBadge('Loading...', 'downloading');
  if (el && !fullTranscript) el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px;color:var(--text-muted)">
      <div class="vosk-spinner"></div>
      <span style="font-style:italic">Loading Vosk speech model...</span>
      <span style="font-size:0.75rem">Extracting into memory, usually takes 5-15 s</span>
    </div>`;

  const setStatus = (msg) => {
    if (el) el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px;color:var(--text-muted)">
        <div class="vosk-spinner"></div>
        <span style="font-style:italic">Loading Vosk speech model...</span>
        <span style="font-size:0.75rem">${msg}</span>
      </div>`;
  };

  try {
    setStatus('Loading library...');
    const VoskLib = await loadVoskLib();
    console.log('[Vosk] lib loaded, createModel:', typeof VoskLib?.createModel);

    if (!voskModel) {
      setStatus('Reading model from disk...');
      const modelBuffer = await api.readVoskModel();
      console.log('[Vosk] model buffer size:', modelBuffer?.byteLength ?? modelBuffer?.length);

      setStatus('Creating blob URL...');
      const modelBlob = new Blob([modelBuffer], { type: 'application/gzip' });
      const modelUrl  = URL.createObjectURL(modelBlob);
      console.log('[Vosk] blob URL:', modelUrl);

      setStatus('Extracting model into memory (5-15 s)...');
      voskModel = await VoskLib.createModel(modelUrl);
      URL.revokeObjectURL(modelUrl);
      console.log('[Vosk] model ready');
    }

    voskRec = new voskModel.KaldiRecognizer(16000);

    voskRec.on('result', msg => {
      const text = (msg.result?.text || '').trim();
      if (text) {
        appendToTranscript((fullTranscript ? ' ' : '') + text);
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
    if (el && !fullTranscript) el.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Vosk ready, speak and text will appear here.</span>`;

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

// Re-entrancy guard: setInterval doesn't await, so if a single transcribe
// call takes longer than the 3 s flush interval (common during pipeline load
// or on a slow CPU), multiple flushes pile up in flight. Each holds a
// Float32Array chunk in memory until its IPC settles. With this gate, when
// a flush is already in progress we skip the new tick rather than queuing.
let _whisperFlushing = false;

async function flushWhisperBuffer() {
  if (_whisperFlushing) return;
  if (whisperBuffer.length < 8000) return; // need at least 0.5s of audio at 16 kHz
  _whisperFlushing = true;

  const chunk = new Float32Array(whisperBuffer.splice(0, whisperBuffer.length));
  const modelId = settings.whisper_model || 'Xenova/whisper-base.en';

  setWhisperBadge('Processing...', 'processing');
  try {
    const result = await api.transcribeAudio(Array.from(chunk), modelId);
    if (result.ok && result.text.trim()) {
      const text = result.text.trim();
      appendToTranscript(text + ' ');
      updateTranscriptDisplay('');
      onNewFinalText(text);
    }
  } catch (e) {
    console.warn('[Whisper] Transcription error:', e.message);
  } finally {
    _whisperFlushing = false;
  }
  if (isListening) setWhisperBadge('Recording', 'recording');
}

// ── Common helpers ────────────────────────────────────────────────────────────

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
