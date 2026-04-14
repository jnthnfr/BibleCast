/* BibleCast Operator Panel */

const api = window.biblecast;

let selectedVerse = null;
let isBlank = false;
let searchTimeout = null;
let activeSession = null;

// --- Init ---

async function init() {
  await loadTranslations();
  await loadSessions();
  await syncDisplayState();
  await loadSettings();
  bindEvents();
  setInterval(syncDisplayState, 5000);
}

// --- Translations ---

async function loadTranslations() {
  const translations = await api.listTranslations();
  const select = document.getElementById('translation-select');
  select.innerHTML = '';

  if (!translations.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No translations';
    select.appendChild(opt);
    return;
  }

  translations.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.abbreviation;
    opt.textContent = t.abbreviation;
    select.appendChild(opt);
  });
}

// --- Search ---

function onSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(doSearch, 300);
}

async function doSearch() {
  const query = document.getElementById('search-input').value.trim();
  const translation = document.getElementById('translation-select').value;
  const list = document.getElementById('results-list');

  if (!query) {
    list.innerHTML = '<div class="no-results">Search for a verse above</div>';
    selectedVerse = null;
    updatePushButton();
    return;
  }

  if (!translation) {
    list.innerHTML = '<div class="no-results">Load a Bible translation first (Settings)</div>';
    return;
  }

  const results = await api.searchVerses(query, translation);

  if (!results.length) {
    list.innerHTML = '<div class="no-results">No verses found</div>';
    selectedVerse = null;
    updatePushButton();
    return;
  }

  list.innerHTML = '';
  results.forEach((v, i) => {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-ref">${escapeHtml(v.reference || formatRef(v))}</div>
      <div class="result-text">${escapeHtml(v.text)}</div>
    `;
    item.addEventListener('click', () => selectVerse(v, item));
    list.appendChild(item);
  });
}

function formatRef(v) {
  return `${v.book} ${v.chapter}:${v.verse}`;
}

function selectVerse(verse, el) {
  document.querySelectorAll('.result-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');

  if (!verse.reference) verse.reference = formatRef(verse);
  selectedVerse = verse;
  updatePushButton();
  updatePreview(verse, false);
}

function updatePushButton() {
  document.getElementById('push-btn').disabled = !selectedVerse;
}

// --- Display controls ---

async function pushVerse() {
  if (!selectedVerse) return;
  isBlank = false;
  await api.pushVerse(selectedVerse);
  updateBlankButton();
  updatePreview(selectedVerse, false);
  await refreshHistory();
}

async function toggleBlank() {
  isBlank = !isBlank;
  await api.blankDisplay(isBlank);
  updateBlankButton();

  const preview = document.getElementById('verse-preview');
  preview.classList.toggle('blanked', isBlank);

  updateStatusBadge(!isBlank && !!selectedVerse);
}

function updateBlankButton() {
  const btn = document.getElementById('blank-btn');
  btn.textContent = isBlank ? 'Unblank Display' : 'Blank Display';
  btn.className = isBlank ? 'btn btn-danger' : 'btn btn-secondary';
}

function updatePreview(verse, blanked) {
  const preview = document.getElementById('verse-preview');
  if (blanked || !verse) {
    preview.innerHTML = '<div class="preview-empty">No verse on display</div>';
    updateStatusBadge(false);
    return;
  }

  preview.innerHTML = `
    <div class="preview-reference">${escapeHtml(verse.reference || formatRef(verse))}</div>
    <div class="preview-text">"${escapeHtml(verse.text)}"</div>
  `;
  updateStatusBadge(true);
}

async function syncDisplayState() {
  const state = await api.getDisplayState();
  if (!state) return;

  const visible = state.is_visible === 1;
  isBlank = !visible;
  updateBlankButton();
  updateStatusBadge(visible && !!state.current_text);

  if (state.current_text) {
    const preview = document.getElementById('verse-preview');
    if (!preview.querySelector('.preview-reference')) {
      preview.innerHTML = `
        <div class="preview-reference">${escapeHtml(state.current_reference || '')}</div>
        <div class="preview-text">"${escapeHtml(state.current_text)}"</div>
      `;
    }
    preview.classList.toggle('blanked', !visible);
  }
}

function updateStatusBadge(live) {
  document.getElementById('display-status-dot').className = 'status-dot' + (live ? ' live' : '');
  document.getElementById('display-status-text').textContent = live ? 'Live' : 'Display off';
}

// --- Sessions ---

async function loadSessions() {
  activeSession = await api.getActiveSession();
  document.getElementById('session-name').textContent =
    activeSession ? activeSession.name : 'None';

  const sessions = await api.listSessions();
  const list = document.getElementById('session-list');
  list.innerHTML = '';

  if (!sessions.length) {
    list.innerHTML = '<li style="color:var(--text-muted);font-size:0.85rem;padding:8px">No sessions yet. Start one above.</li>';
    return;
  }

  sessions.forEach(s => {
    const li = document.createElement('li');
    li.className = 'session-item' + (s.is_active ? ' active-session' : '');
    li.innerHTML = `
      <div class="session-name">${escapeHtml(s.name)} ${s.is_active ? '&#9679;' : ''}</div>
      <div class="session-meta">${s.created_at}</div>
    `;
    li.addEventListener('click', () => viewSession(s));
    list.appendChild(li);
  });
}

async function createSession() {
  const input = document.getElementById('session-name-input');
  const name = input.value.trim();
  if (!name) return;

  await api.createSession(name);
  input.value = '';
  await loadSessions();
}

async function viewSession(session) {
  switchTab('history');
  await refreshHistory(session.id);
}

// --- History ---

async function refreshHistory(sessionId) {
  const sess = sessionId
    ? { id: sessionId }
    : await api.getActiveSession();

  const list = document.getElementById('history-list');

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
      <div class="history-ref">${escapeHtml(v.reference)} &nbsp;<small>${escapeHtml(v.translation)}</small></div>
      <div class="history-text">${escapeHtml(v.text)}</div>
    </div>
  `).join('');
}

// --- Settings ---

async function loadSettings() {
  const settings = await api.getSettings();
  if (settings['font_size']) {
    document.getElementById('setting-font-size').value = settings['font_size'];
  }
  if (settings['theme']) {
    document.getElementById('setting-theme').value = settings['theme'];
  }
}

async function saveSettings() {
  const fontSize = document.getElementById('setting-font-size').value;
  const theme = document.getElementById('setting-theme').value;
  await api.saveSetting('font_size', fontSize);
  await api.saveSetting('theme', theme);
  alert('Settings saved');
}

// --- Tabs ---

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
}

// --- Event binding ---

function bindEvents() {
  document.getElementById('search-input').addEventListener('input', onSearchInput);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  document.getElementById('translation-select').addEventListener('change', doSearch);
  document.getElementById('push-btn').addEventListener('click', pushVerse);
  document.getElementById('blank-btn').addEventListener('click', toggleBlank);
  document.getElementById('new-session-btn').addEventListener('click', createSession);
  document.getElementById('session-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') createSession();
  });
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
      if (tab.dataset.tab === 'history') refreshHistory();
      if (tab.dataset.tab === 'session') loadSessions();
    });
  });
}

// --- Utilities ---

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Start
document.addEventListener('DOMContentLoaded', init);
