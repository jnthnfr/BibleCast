/* BibleCast: sessions + history module
 *
 * Owns the active-session state and the two list panels (sessions list,
 * history of verses logged in the active session). Calls into selectVerse
 * and switchView, which still live in renderer.js and resolve at click
 * time once all classic <script> tags have parsed.
 *
 * `activeSession` is shared with renderer.js (read in init() and in the
 * various transcription paths). Top-level let bindings in classic scripts
 * share the same script-level lexical environment, so the same name in
 * renderer.js refers to this binding.
 */

let activeSession = null;

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

  list.innerHTML = '';
  verses.forEach(v => {
    const el = document.createElement('div');
    el.className = 'history-verse';
    el.title = 'Click to queue in Studio Preview';
    el.innerHTML = `
      <div class="history-ref">
        ${escapeHtml(v.reference)}
        <small>${escapeHtml(v.translation)}</small>
      </div>
      <div class="history-text">${escapeHtml(v.text)}</div>
    `;
    el.addEventListener('click', () => {
      selectVerse({ reference: v.reference, text: v.text, translation: v.translation, book: v.book, chapter: v.chapter, verse: v.verse });
      switchView('control');
    });
    list.appendChild(el);
  });
}
