/* BibleCast: small shared helpers used across operator-panel modules
 *
 * formatRef and showToast are called from many places (search, sessions,
 * history, bible-browser, settings save toasts, translation downloads).
 * appendToTranscript caps the live transcript at MAX_TRANSCRIPT_CHARS so
 * a long sermon does not grow the buffer without bound. fullTranscript
 * itself is still declared in renderer.js and resolves at call time
 * via the shared script-level scope.
 */

function formatRef(v) {
  return `${v.book} ${v.chapter}:${v.verse}`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 2500);
}

const MAX_TRANSCRIPT_CHARS = 60000; // ~10k words; prevents unbounded growth in long sessions

function appendToTranscript(text) {
  fullTranscript += text;
  if (fullTranscript.length > MAX_TRANSCRIPT_CHARS) {
    fullTranscript = fullTranscript.slice(-MAX_TRANSCRIPT_CHARS);
  }
}
