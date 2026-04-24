/* BibleCast Projection Window */

const api = window.biblecast;

const isNdiWindow = new URLSearchParams(window.location.search).get('ndi') === '1';

// NDI window: inject a thin drag bar so the frameless window can be moved
if (isNdiWindow) {
  const bar = document.createElement('div');
  bar.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'height:18px',
    'z-index:9999', '-webkit-app-region:drag',
    'background:rgba(0,0,0,0.45)', 'cursor:move',
  ].join(';');
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bar));
}

let showReference    = true;
let showTranslation  = true;
let autoFitEnabled   = true;
let autoFitLtEnabled = true;

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
    lt_auto_fit_text:  settings.lt_auto_fit_text,
    lt_bg_type:        settings.lt_bg_type,
    lt_bg_color:       settings.lt_bg_color,
    lt_bg_opacity:     settings.lt_bg_opacity,
    lt_bg_gradient_start: settings.lt_bg_gradient_start,
    lt_bg_gradient_end:   settings.lt_bg_gradient_end,
    standby_type:         settings.standby_type         || 'none',
    standby_image_url:    settings.standby_image_url    || '',
    standby_image_fit:    settings.standby_image_fit    || 'contain',
    standby_image_opacity:settings.standby_image_opacity|| '100',
  });
  applyLayout(settings.hdmi_layout || 'full');

  if (state?.current_text && state.is_visible) {
    renderVerse(state.current_reference, state.current_text, state.translation);
  } else if (state?.current_text) {
    document.body.classList.add('has-verse');
  }

  setBlank(!!state && !state.is_visible && !!state.current_text);

  api.onDisplayUpdate(handleUpdate);
}

function handleUpdate(data) {
  if (data.type === 'clear') {
    // Return to standby: remove has-verse so the standby screen fades back in.
    // Does not close the window or show the black blank-screen overlay.
    document.body.classList.remove('has-verse', 'blanked');
    const container = document.getElementById('verse-container');
    if (container) container.innerHTML = '';
    return;
  }

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
      lt_auto_fit_text:  data.ltAutoFitText,
      lt_bg_type:        data.ltBgType,
      lt_bg_color:       data.ltBgColor,
      lt_bg_opacity:     data.ltBgOpacity,
      lt_bg_gradient_start: data.ltBgGradientStart,
      lt_bg_gradient_end:   data.ltBgGradientEnd,
      standby_type:         data.standbyType,
      standby_image_url:    data.standbyImageUrl,
      standby_image_fit:    data.standbyImageFit,
      standby_image_opacity:data.standbyImageOpacity,
    });
  }
}

function renderVerse(reference, text, translation) {
  document.body.classList.add('has-verse');
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

  const isLt = document.body.classList.contains('layout-lower-third');
  if (isLt ? autoFitLtEnabled : autoFitEnabled) autoFitText();
}

function autoFitText() {
  const root      = document.documentElement;
  const container = document.getElementById('verse-container');
  if (!container) return;

  // Freeze transitions for the entire fit pass. A font-size transition from a
  // previous verse still animating would make getBoundingClientRect() return
  // mid-animation sizes, causing Phase 2 to step all the way to MIN_PX.
  // We restore the saved value after the fitted frame is committed.
  const savedTransition = root.style.getPropertyValue('--transition') || '0.5s';
  root.style.setProperty('--transition', '0s');

  const isLowerThird = document.body.classList.contains('layout-lower-third');
  const vh  = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  // ── Phase 1: binary search using scrollHeight (fast, O log n) ──────────────
  const safeMargin = isLowerThird ? 0 : Math.max(24, Math.round(vh * 0.035) + (dpr > 1 ? Math.round(dpr * 4) : 0));
  const maxH = isLowerThird ? Math.round(vh * 0.28) : vh - safeMargin * 2;

  const MIN_PX = 16;
  const MAX_PX = isLowerThird ? 200 : 400;
  let lo = MIN_PX, hi = MAX_PX, best = MIN_PX;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    root.style.setProperty('--font-size', mid + 'px');
    if (container.scrollHeight <= maxH) { best = mid; lo = mid + 1; }
    else                                 { hi = mid - 1; }
  }
  root.style.setProperty('--font-size', best + 'px');

  // ── Phase 2: bounding-rect verification (synchronous, transitions frozen) ──
  // Reads actual rendered positions of reference (top) and translation (bottom).
  // Steps down 1 px until both are confirmed inside the viewport.
  // Math.floor/ceil guards against sub-pixel bleed on fractional DPR (e.g. 1.25×).
  if (!isLowerThird) {
    const refEl   = container.querySelector('.verse-reference');
    const transEl = container.querySelector('.translation-badge');

    for (let size = best; size >= MIN_PX; size--) {
      root.style.setProperty('--font-size', size + 'px');
      const top    = Math.floor((refEl   || container).getBoundingClientRect().top);
      const bottom = Math.ceil ((transEl || container).getBoundingClientRect().bottom);
      if (top >= 0 && bottom <= vh) break;
    }
  }

  // Restore transitions after the fitted frame is committed so subsequent
  // settings changes (e.g. font-size slider) still animate smoothly.
  requestAnimationFrame(() => root.style.setProperty('--transition', savedTransition));
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
    // Toggle only the theme class — preserves has-verse, has-standby-image,
    // layout-lower-third, blanked, etc. that other code manages independently.
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-blue');
    document.body.classList.add('theme-' + s.theme);
  }

  if (s.show_reference   != null) showReference    = s.show_reference   !== false && s.show_reference   !== 'false';
  if (s.show_translation != null) showTranslation  = s.show_translation !== false && s.show_translation !== 'false';
  if (s.auto_fit_text    != null) autoFitEnabled   = s.auto_fit_text    !== false && s.auto_fit_text    !== 'false';
  if (s.lt_auto_fit_text != null) autoFitLtEnabled = s.lt_auto_fit_text !== false && s.lt_auto_fit_text !== 'false';

  // Fullscreen background
  if (s.bg_type === 'solid' && s.bg_color) {
    document.body.style.background = s.bg_color;
  } else if (s.bg_type === 'gradient') {
    const start = s.bg_gradient_start || '#0a1628';
    const end   = s.bg_gradient_end   || '#1a3a5c';
    document.body.style.background = `linear-gradient(135deg, ${start}, ${end})`;
  } else if (s.bg_type === 'image' && s.bg_image_url) {
    document.body.style.background = `url('${s.bg_image_url}') center/cover no-repeat`;
  }

  // Standby screen — HDMI only; NDI output is a live feed and should never show it
  if (s.standby_type != null && !isNdiWindow) {
    const standbyImg = document.getElementById('standby-img');
    if (s.standby_type === 'image' && s.standby_image_url) {
      if (standbyImg) {
        standbyImg.src     = s.standby_image_url;
        standbyImg.style.objectFit = s.standby_image_fit || 'contain';
        standbyImg.style.opacity   = (Math.max(0, Math.min(100, parseInt(s.standby_image_opacity ?? 100))) / 100).toFixed(2);
      }
      document.body.classList.add('has-standby-image');
    } else {
      if (standbyImg) standbyImg.src = '';
      document.body.classList.remove('has-standby-image');
    }
  }

  // Lower-third bar background (independent)
  if (s.lt_bg_type != null) {
    const opacity = parseFloat(s.lt_bg_opacity ?? 0.82);
    if (s.lt_bg_type === 'transparent') {
      root.style.setProperty('--lt-container-bg', 'transparent');
    } else if (s.lt_bg_type === 'gradient') {
      const gs = s.lt_bg_gradient_start || '#000000';
      const ge = s.lt_bg_gradient_end   || '#1a1a1a';
      root.style.setProperty('--lt-container-bg', `linear-gradient(135deg, ${gs}, ${ge})`);
    } else if (s.lt_bg_color) {
      // Parse hex and build rgba so opacity is honoured
      const hex = s.lt_bg_color.replace('#', '');
      const r = parseInt(hex.substring(0,2), 16);
      const g = parseInt(hex.substring(2,4), 16);
      const b = parseInt(hex.substring(4,6), 16);
      root.style.setProperty('--lt-container-bg', `rgba(${r},${g},${b},${opacity})`);
    }
  }
}

function applyLayout(layout) {
  document.body.classList.toggle('layout-lower-third', layout === 'lower-third');
  const isLt = layout === 'lower-third';
  if (isLt ? autoFitLtEnabled : autoFitEnabled) autoFitText();
}

window.addEventListener('resize', () => {
  const isLt = document.body.classList.contains('layout-lower-third');
  if (isLt ? autoFitLtEnabled : autoFitEnabled) autoFitText();
});
window.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
document.addEventListener('DOMContentLoaded', init);
