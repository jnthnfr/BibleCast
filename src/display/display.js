/* BibleCast Projection Window */

const api = window.biblecast;

let showReference   = true;
let showTranslation = true;
let autoFitEnabled  = true;

async function init() {
  // Load display state (current verse / visibility)
  const state = await api.getDisplayState();

  // Load full settings for text color, transition, show flags
  const settings = await api.getSettings();
  applySettings({
    font_size:         state?.font_size  || settings.font_size  || '56',
    theme:             state?.theme      || settings.theme      || 'dark',
    text_color:        settings.text_color         || '#ffffff',
    transition_speed:  settings.transition_speed   || '0.5',
    show_reference:    settings.show_reference     !== 'false',
    show_translation:  settings.show_translation   !== 'false',
    bg_type:           settings.bg_type            || 'solid',
    bg_color:          settings.bg_color           || '#000000',
    bg_gradient_start: settings.bg_gradient_start  || '#0a1628',
    bg_gradient_end:   settings.bg_gradient_end    || '#1a3a5c',
    bg_image_url:      settings.bg_image_url       || '',
    font_family:       settings.font_family        || 'Georgia, serif',
    custom_font_family:settings.custom_font_family || '',
    auto_fit_text:     settings.auto_fit_text,
    ref_color:         settings.ref_color,
    ref_size_ratio:    settings.ref_size_ratio,
  });
  applyLayout(settings.hdmi_layout || 'full');

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

  if (data.type === 'layout') {
    applyLayout(data.layout);
    return;
  }

  if (data.type === 'settings') {
    applySettings({
      font_size:         data.fontSize,
      theme:             data.theme,
      text_color:        data.textColor,
      transition_speed:  data.transitionSpeed,
      show_reference:    data.showReference,
      show_translation:  data.showTranslation,
      bg_type:           data.bgType,
      bg_color:          data.bgColor,
      bg_gradient_start: data.bgGradientStart,
      bg_gradient_end:   data.bgGradientEnd,
      bg_image_url:      data.bgImageUrl,
      font_family:       data.fontFamily,
      custom_font_family:data.customFontFamily,
      auto_fit_text:     data.autoFitText,
      ref_color:         data.refColor,
      ref_size_ratio:    data.refSizeRatio,
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

  if (autoFitEnabled) autoFitText();
}

function autoFitText() {
  const root         = document.documentElement;
  const container    = document.getElementById('verse-container');
  if (!container) return;

  const isLowerThird = document.body.classList.contains('layout-lower-third');

  // Fullscreen: fill up to 70% of screen height.
  // Lower-third: bar should occupy at most 30% of screen height — it's a
  // banner, not a full-screen slide. The CSS scales verse text to 0.62×
  // --font-size so container.scrollHeight already reflects that correctly.
  const maxH   = window.innerHeight * (isLowerThird ? 0.30 : 0.70);
  const MIN_PX = 20;
  const MAX_PX = isLowerThird ? 200 : 400; // lower cap for lower-third
  let lo = MIN_PX, hi = MAX_PX, best = MIN_PX;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    root.style.setProperty('--font-size', mid + 'px');
    if (container.scrollHeight <= maxH) {
      best = mid;
      lo   = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  root.style.setProperty('--font-size', best + 'px');
}

function setBlank(blank) {
  document.body.classList.toggle('blanked', blank);
}

function applySettings(s) {
  const root = document.documentElement;

  if (s.font_size != null) {
    root.style.setProperty('--font-size', parseInt(s.font_size) + 'px');
  }

  if (s.font_family) {
    if (s.font_family === 'custom') {
      if (s.custom_font_family) root.style.setProperty('--font-family', `"${s.custom_font_family}"`);
    } else {
      root.style.setProperty('--font-family', s.font_family);
    }
  }

  if (s.text_color) {
    root.style.setProperty('--text-color', s.text_color);
  }

  if (s.ref_color) {
    root.style.setProperty('--ref-color', s.ref_color);
  }

  if (s.ref_size_ratio != null) {
    const ratio = parseFloat(s.ref_size_ratio) || 0.45;
    root.style.setProperty('--ref-size-ratio', ratio);
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
  if (s.auto_fit_text   != null) autoFitEnabled  = s.auto_fit_text   !== false && s.auto_fit_text   !== 'false';

  // Background
  if (s.bg_type === 'solid' && s.bg_color) {
    document.body.style.background = s.bg_color;
  } else if (s.bg_type === 'gradient') {
    const start = s.bg_gradient_start || '#0a1628';
    const end   = s.bg_gradient_end   || '#1a3a5c';
    document.body.style.background = `linear-gradient(135deg, ${start}, ${end})`;
  } else if (s.bg_type === 'image' && s.bg_image_url) {
    document.body.style.background = `url('${s.bg_image_url}') center/cover no-repeat`;
  }
}

function applyLayout(layout) {
  document.body.classList.toggle('layout-lower-third', layout === 'lower-third');
  if (autoFitEnabled) autoFitText();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.addEventListener('resize', () => { if (autoFitEnabled) autoFitText(); });
document.addEventListener('DOMContentLoaded', init);
