/* BibleCast Projection Window */

const api = window.biblecast;

let currentFontSize = 56;
let currentTheme = 'dark';

async function init() {
  const state = await api.getDisplayState();
  if (state) {
    applySettings(state.font_size, state.theme);

    if (state.current_text && state.is_visible) {
      renderVerse(state.current_reference, state.current_text, state.translation);
    }

    setBlank(!state.is_visible && !!state.current_text);
  }

  api.onDisplayUpdate(handleUpdate);
}

function handleUpdate(data) {
  if (data.type === 'blank') {
    setBlank(!data.visible);
    return;
  }

  if (data.type === 'verse') {
    renderVerse(data.reference, data.text, data.translation);
    setBlank(false);
  }

  if (data.type === 'settings') {
    applySettings(data.font_size, data.theme);
  }
}

function renderVerse(reference, text, translation) {
  const container = document.getElementById('verse-container');

  container.innerHTML = `
    <div class="verse-reference">${escapeHtml(reference)}</div>
    <div class="verse-text">${escapeHtml(text)}</div>
    <div class="translation-badge">${escapeHtml(translation || 'KJV')}</div>
  `;
}

function setBlank(blank) {
  document.body.classList.toggle('blanked', blank);
}

function applySettings(fontSize, theme) {
  if (fontSize) {
    currentFontSize = parseInt(fontSize) || 56;
    document.documentElement.style.setProperty('--font-size', currentFontSize + 'px');
  }

  if (theme) {
    currentTheme = theme;
    document.body.className = `theme-${theme}`;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', init);
