/* BibleCast Projection Window */

const api = window.biblecast;

let showReference   = true;
let showTranslation = true;

async function init() {
  // Load display state (current verse / visibility)
  const state = await api.getDisplayState();

  // Load full settings for text color, transition, show flags
  const settings = await api.getSettings();
  applySettings({
    font_size:        state?.font_size  || settings.font_size  || '56',
    theme:            state?.theme      || settings.theme      || 'dark',
    text_color:       settings.text_color       || '#ffffff',
    transition_speed: settings.transition_speed || '0.5',
    show_reference:   settings.show_reference   !== 'false',
    show_translation: settings.show_translation !== 'false',
  });

  if (state?.current_text && state.is_visible) {
    renderVerse(state.current_reference, state.current_text, state.translation);
  }

  setBlank(!!state && !state.is_visible && !!state.current_text);

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
    return;
  }

  if (data.type === 'settings') {
    applySettings({
      font_size:        data.fontSize,
      theme:            data.theme,
      text_color:       data.textColor,
      transition_speed: data.transitionSpeed,
      show_reference:   data.showReference,
      show_translation: data.showTranslation,
    });
  }
}

function renderVerse(reference, text, translation) {
  const container = document.getElementById('verse-container');
  const refHtml   = showReference
    ? `<div class="verse-reference">${escapeHtml(reference)}</div>`
    : '';
  const badgeHtml = showTranslation
    ? `<div class="translation-badge">${escapeHtml(translation || 'KJV')}</div>`
    : '';

  container.innerHTML = `
    ${refHtml}
    <div class="verse-text">${escapeHtml(text)}</div>
    ${badgeHtml}
  `;
}

function setBlank(blank) {
  document.body.classList.toggle('blanked', blank);
}

function applySettings(s) {
  const root = document.documentElement;

  if (s.font_size != null) {
    root.style.setProperty('--font-size', parseInt(s.font_size) + 'px');
  }

  if (s.text_color) {
    root.style.setProperty('--text-color', s.text_color);
  }

  if (s.transition_speed != null) {
    const sec = parseFloat(s.transition_speed) || 0.5;
    root.style.setProperty('--transition', sec + 's');
  }

  if (s.theme) {
    document.body.className = 'theme-' + s.theme + (document.body.classList.contains('blanked') ? ' blanked' : '');
  }

  if (s.show_reference  != null) showReference   = s.show_reference  !== false && s.show_reference  !== 'false';
  if (s.show_translation != null) showTranslation = s.show_translation !== false && s.show_translation !== 'false';
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
