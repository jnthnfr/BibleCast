/* BibleCast: speech-to-text engines for the operator panel
 *
 * Two transcription paths and the common badges / transcript display
 * they both feed into:
 *
 *   Chrome bridge    out-of-process (api.startChromeBridge, hidden Chrome) — DEFAULT
 *   Whisper local    @xenova/transformers via main process IPC
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

// Chrome bridge readiness (listeners registered once per session)
let chromeBridgeReady  = false;

// ── English-only gate ─────────────────────────────────────────────────────────
//
// Field-test finding: when the preacher code-switches into a local language,
// the English-only Whisper checkpoint (and Web Speech with lang=en-US) emits
// either obvious hallucinations ("Thank you.", "Thanks for watching.") or
// random English-flavoured noise that pollutes the transcript and triggers
// false predictions. Until we ship multilingual support, the safer behaviour
// is to drop those chunks and wait for English to resume.
//
// looksLikeEnglish() is a deliberately lenient heuristic: it only returns
// false when at least one clear non-English signal fires. Short, valid
// English ("Amen.", "Glory.", "Praise God.") passes through.
const _EN_HALLUCINATIONS = new Set([
  'thank you.', 'thank you', 'thanks.', 'thanks',
  'thanks for watching.', 'thanks for watching',
  'thank you for watching.', 'thank you for watching',
  'please subscribe.', 'please subscribe', 'subscribe.', 'subscribe',
  'like and subscribe.', 'like and subscribe',
  'you', 'you.', 'okay.', 'okay', 'ok.', 'ok',
  'bye.', 'bye', 'bye-bye.', 'bye bye',
  '[music]', '[applause]', '[laughter]',
]);
const _EN_STOPWORDS = new Set([
  'the','and','of','to','in','a','is','that','for','it','was','on','with',
  'as','at','by','this','his','her','him','she','he','they','we','you','i',
  'are','have','has','be','been','but','not','or','if','from','an','my',
  'your','our','their','will','would','can','do','does','did','said','so',
  'when','what','who','how','why','where','there','here','then','than',
  'one','two','three','god','jesus','lord','christ','spirit','holy','father',
  'son','heaven','earth','word','life','love','faith','grace','sin','soul',
  'shall','let','us','unto','saith','thee','thou','thy','ye','behold','amen',
]);
let _droppedNonEnglishCount = 0;

function looksLikeEnglish(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;

  // 1. Non-Latin scripts (CJK, Arabic, Devanagari, Cyrillic, etc.). Allow
  // basic Latin + Latin-1 + Latin Extended; drop if more than 15% of
  // letters fall outside that band.
  const letters = trimmed.replace(/[^\p{L}]/gu, '');
  if (letters.length) {
    let nonLatin = 0;
    for (const ch of letters) {
      if (ch.codePointAt(0) > 0x024F) nonLatin++;
    }
    if (nonLatin / letters.length > 0.15) return false;
  }

  // 2. Pure-punctuation or music-symbol output, plus the well-known Whisper
  // hallucination set when fed non-English audio. Strip trailing punctuation
  // so "Thanks for watching!" matches "thanks for watching".
  if (/^[\s♪♫.,!?\-…]+$/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  const stripped = lower.replace(/[\s.,!?…\-]+$/, '');
  if (_EN_HALLUCINATIONS.has(lower) || _EN_HALLUCINATIONS.has(stripped)) return false;

  // 3. Repetition spiral: one token dominating a multi-token chunk is the
  // engine locking into garbage on unfamiliar audio.
  const tokens = lower.split(/\s+/).filter(Boolean);
  if (tokens.length >= 4) {
    const counts = {};
    for (const t of tokens) counts[t] = (counts[t] || 0) + 1;
    const top = Math.max(...Object.values(counts));
    if (top / tokens.length > 0.7) return false;
  }

  // 4. English-stopword density. Judge chunks of 4+ alphabetic tokens; short
  // chunks of valid English usually contain at least one common function or
  // theological word from the stopword set. The set is intentionally
  // sermon-flavoured (god, jesus, lord, faith, amen, …) so that short
  // worship phrases like "Father Son Holy Spirit" pass.
  const alphaTokens = tokens.filter(t => /^[a-z']+$/.test(t));
  if (alphaTokens.length >= 4) {
    const hits = alphaTokens.filter(t => _EN_STOPWORDS.has(t)).length;
    if (hits === 0) return false;
  }

  return true;
}

// Brief operator feedback when a chunk is skipped. Uses the existing whisper
// status badge so we don't add yet another DOM element.
function flashSkippedBadge() {
  _droppedNonEnglishCount++;
  setWhisperBadge('Skipped: non-English', 'processing');
  clearTimeout(flashSkippedBadge._t);
  flashSkippedBadge._t = setTimeout(() => {
    if (isListening) setWhisperBadge('● Active', 'ai');
    else setWhisperBadge('');
  }, 1200);
}

// ── Transcription init: Whisper progress listener ─────────────────────────────
// In-process Web Speech (window.SpeechRecognition) was deleted in the
// transcription revamp — it was never invoked from toggleListening, the
// 'web-speech' provider value actually routed to startChromeBridgeCapture.

function initWhisperProgress() {
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
  stopChromeBridgeCapture();
  stopWhisperCapture();
  setWhisperBadge('');
  // Clear the rolling tail buffer so a partial reference left over from
  // the previous session can't false-match against the first chunk of
  // the next session.
  resetRefTailBuffer();
}

// Resolve the configured provider to one of the two live engines. Old
// settings values ('web-speech', 'vosk') from before the revamp map back to
// the Chrome bridge default so existing installs don't break on first launch.
function resolveProvider() {
  const p = settings.whisper_provider;
  if (p === 'whisper-local') return 'whisper-local';
  return 'chrome-bridge';
}

function toggleListening() {
  isListening = !isListening;
  const btn = document.getElementById('listen-btn');

  if (isListening) {
    const provider = resolveProvider();
    if (provider === 'whisper-local') {
      startWhisperCapture();
    } else {
      startChromeBridgeCapture();
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

// ── Chrome bridge: out-of-process Web Speech via a hidden Chrome process ──────
// chromeBridgeReady is declared at the top of the file alongside the other
// engine state.

function startChromeBridgeCapture() {
  if (!chromeBridgeReady) {
    // Data from Chrome: { interim: string, final: string }
    api.onChromeSpeechResult((data) => {
      if (data.final) {
        // English-only gate (see looksLikeEnglish for rationale).
        if (!looksLikeEnglish(data.final)) {
          flashSkippedBadge();
          return;
        }
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

    // Flush every 5 seconds. Longer than the 3s pre-revamp value: gives the
    // model enough acoustic context to disambiguate fast speech and emit
    // complete references in a single inference instead of splitting across
    // chunk boundaries. Cross-chunk reference detection is handled at the
    // text level by the rolling tail buffer in search.js — no audio overlap
    // needed, which would otherwise cause text duplication around chunk seams.
    whisperFlushTimer = setInterval(() => flushWhisperBuffer(), 5000);
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

// Re-entrancy guard: setInterval doesn't await, so if a single transcribe
// call takes longer than the flush interval (common during pipeline load
// or on a slow CPU), multiple flushes pile up in flight. Each holds a
// Float32Array chunk in memory until its IPC settles. With this gate, when
// a flush is already in progress we skip the new tick rather than queuing.
let _whisperFlushing = false;

async function flushWhisperBuffer() {
  if (_whisperFlushing) return;
  if (whisperBuffer.length < 8000) return; // need at least 0.5s of new audio at 16 kHz
  _whisperFlushing = true;

  const chunk   = new Float32Array(whisperBuffer.splice(0, whisperBuffer.length));
  const modelId = settings.whisper_model || 'Xenova/whisper-small.en';

  setWhisperBadge('Processing...', 'processing');
  try {
    const result = await api.transcribeAudio(Array.from(chunk), modelId);
    if (result.ok && result.text.trim()) {
      const text = result.text.trim();
      // English-only gate: .en models hallucinate "Thank you.",
      // "Thanks for watching.", or repetition spirals on non-English audio.
      // Drop those so the transcript stays clean.
      if (!looksLikeEnglish(text)) {
        flashSkippedBadge();
      } else {
        appendToTranscript(text + ' ');
        updateTranscriptDisplay('');
        onNewFinalText(text);
      }
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

// Cache the last rendered HTML so re-render on every interim tick doesn't
// thrash the DOM (and break a hover/focus on a freshly-rendered ref chip).
let _lastTranscriptHtml = '';

// Wire delegated click + dblclick handlers on the live transcript so any
// inline scripture-ref chip is interactive. Plain click queues the verse to
// Studio Preview; shift-click or dblclick projects it. Bound once on init —
// repeated innerHTML rewrites in updateTranscriptDisplay don't detach the
// listener, since it lives on the parent element.
function initTranscriptClickHandlers() {
  const el = document.getElementById('transcript-text');
  if (!el || el.dataset.refClickBound === '1') return;
  el.dataset.refClickBound = '1';

  const handle = async (refStr, project) => {
    const translation = document.getElementById('translation-select')?.value || 'KJV';
    let results = [];
    try {
      results = await api.searchVerses(refStr, translation);
    } catch (err) {
      console.warn('[transcript] verse lookup failed:', err.message);
    }
    if (!results || !results.length) {
      showToast(`No verse found for "${refStr}"`);
      return;
    }
    selectVerse(results[0], null);
    if (project) {
      await pushVerse();
      showToast(`Projecting ${results[0].reference || refStr}`);
    } else {
      showToast(`Queued ${results[0].reference || refStr}`);
    }
  };

  el.addEventListener('click', (e) => {
    const a = e.target.closest('.scripture-ref');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const ref = a.dataset.ref;
    if (!ref) return;
    handle(ref, e.shiftKey === true);
  });

  el.addEventListener('dblclick', (e) => {
    const a = e.target.closest('.scripture-ref');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const ref = a.dataset.ref;
    if (!ref) return;
    handle(ref, true);
  });
}

function updateTranscriptDisplay(interim) {
  const el = document.getElementById('transcript-text');
  if (!el) return;
  // Show last ~600 chars of final transcript + italic interim
  const recent = fullTranscript.slice(-600);
  const html =
    highlightScriptureRefs(recent) +
    (interim ? `<span style="color:#484f58;font-style:italic"> ${highlightScriptureRefs(interim)}</span>` : '');
  if (html !== _lastTranscriptHtml) {
    el.innerHTML = html;
    _lastTranscriptHtml = html;
  }
  el.scrollTop = el.scrollHeight;
}
