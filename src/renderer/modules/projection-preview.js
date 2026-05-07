/* BibleCast: projection preview renderer for the operator panel
 *
 * Renders a verse into a preview canvas as a pixel-identical scaled
 * mirror of the actual projection display. The virtual canvas is always
 * 1920x1080; a CSS scale() transform shrinks it to fit each preview
 * container, so what you see is exactly what will appear on the
 * projector at any font size.
 *
 * Three thin wrappers expose the renderer at three call sites:
 *
 *   updateStudioPreview       studio-canvas  (search/select feedback)
 *   updateLivePreview         live-canvas    (live broadcast preview)
 *   syncDisplayPreviewLarge   display-canvas (Outputs tab full-size view)
 *
 * Cross-module references (resolve at call time once classic <script>
 * tags have parsed):
 *
 *   escapeHtml                  (utils-browser)
 *   formatRef                   (utils-renderer)
 *   settings, selectedVerse,
 *     isBlank                   (state)
 *   updateStatusBadge           (still in renderer.js, display-output)
 */

const PROJ_W = 1920;
const PROJ_H = 1080;

function getDisplayBg() {
  const s = settings;
  const bgType = s.bg_type || 'solid';
  if (bgType === 'gradient') {
    const a = s.bg_gradient_start || '#0a1628';
    const b = s.bg_gradient_end   || '#1a3a5c';
    return `linear-gradient(135deg, ${a}, ${b})`;
  }
  if (bgType === 'image' && s.bg_image_url) {
    return `url('${s.bg_image_url}') center/cover no-repeat`;
  }
  if (s.theme === 'light') return '#ffffff';
  if (s.theme === 'blue')  return '#0a1628';
  return s.bg_color || '#000000';
}

function getDisplayFontFamily() {
  const ff = settings.font_family || 'Georgia, serif';
  if (ff === 'custom') {
    const custom = settings.custom_font_family || 'Georgia';
    return `"${custom}", serif`;
  }
  return ff;
}

function getDisplayRefColor() {
  if (settings.ref_color) return settings.ref_color;
  if (settings.theme === 'light') return '#8b1a1a';
  return '#e8c97a';
}

function getDisplayTextColor() {
  if (settings.theme === 'light') return '#111111';
  return settings.text_color || '#ffffff';
}

/**
 * Render a verse into a preview canvas as a pixel-identical scaled projection.
 * Font size is auto-fitted: finds the LARGEST size that fits within 15% margins
 * on all sides (content area = 70% wide x 70% tall of 1920x1080).
 *
 * @param {Element} canvas   the .preview-canvas DOM element
 * @param {object|null} verse   { reference, text, translation } or null for idle
 * @param {boolean} blanked   show black screen
 */
function renderProjectionPreview(canvas, verse, blanked) {
  if (!canvas) return;

  const bg         = getDisplayBg();
  const textColor  = getDisplayTextColor();
  const refColor   = getDisplayRefColor();
  const fontFamily = getDisplayFontFamily();
  const transTime  = (parseFloat(settings.transition_speed) || 0.5) + 's';
  const showRef    = settings.show_reference  !== false && settings.show_reference  !== 'false';
  const showTrans  = settings.show_translation !== false && settings.show_translation !== 'false';
  const isLowerThird = (settings.hdmi_layout === 'lower-third');

  const autoFit = settings.auto_fit_text !== 'false';
  let fontPx = parseInt(settings.font_size) || 64;
  let innerHtml;

  if (blanked || !verse) {
    innerHtml = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:rgba(255,255,255,0.08);font-size:16px;font-family:${fontFamily};letter-spacing:4px">${blanked ? 'DISPLAY BLANKED' : 'NO VERSE ON DISPLAY'}</div>`;
  } else {
    if (autoFit) {
      const _refRatio = parseFloat(settings.ref_size_ratio) || 0.45;

      if (isLowerThird) {
        // ── Lower-third: bar capped at 30% of PROJ_H ──────────────────────────
        // CSS scales: verse=0.62x, ref=0.28x, trans=0.22x of --font-size.
        // Horizontal padding is ~11.5% each side, so usable width = 77% of PROJ_W.
        const contentW = Math.round(PROJ_W * 0.77);
        const maxH     = PROJ_H * 0.30;
        const padding  = 24 + 48; // top + bottom padding in px (at native res)

        const outer = document.createElement('div');
        Object.assign(outer.style, {
          position: 'fixed', visibility: 'hidden', pointerEvents: 'none',
          top: '-9999px', left: '-9999px',
          width: contentW + 'px',
          boxSizing: 'border-box',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          padding: padding + 'px 0',
        });
        document.body.appendChild(outer);

        let lo = 20, hi = 200, best = lo;
        while (lo <= hi) {
          const mid  = Math.floor((lo + hi) / 2);
          const vp   = Math.round(mid * 0.62);  // verse text scale in lower-third
          const rp   = Math.round(mid * 0.28);  // reference scale
          const tp   = Math.round(mid * 0.22);  // translation scale
          outer.innerHTML = `
            ${showRef ? `<div style="font-family:${fontFamily};font-size:${rp}px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">${escapeHtml(verse.reference || formatRef(verse))}</div>` : ''}
            <div style="font-family:${fontFamily};font-size:${vp}px;line-height:1.5;font-style:italic;word-break:break-word;overflow-wrap:break-word">&ldquo;${escapeHtml(verse.text)}&rdquo;</div>
            ${showTrans ? `<div style="font-family:${fontFamily};font-size:${tp}px;margin-top:10px">${escapeHtml(verse.translation || 'KJV')}</div>` : ''}
          `;
          if (outer.scrollHeight <= maxH) { best = mid; lo = mid + 1; }
          else                            { hi   = mid - 1; }
        }
        document.body.removeChild(outer);
        fontPx = best;

      } else {
        // ── Fullscreen: fill up to 70% of PROJ_H ──────────────────────────────
        const contentW = Math.round(PROJ_W * 0.70);
        const maxH     = PROJ_H * 0.70;

        const outer = document.createElement('div');
        Object.assign(outer.style, {
          position: 'fixed', visibility: 'hidden', pointerEvents: 'none',
          top: '-9999px', left: '-9999px',
          width: contentW + 'px',
          boxSizing: 'border-box',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
        });
        document.body.appendChild(outer);

        let lo = 20, hi = 400, best = lo;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const rp  = Math.round(mid * _refRatio);
          const tp  = Math.round(mid * 0.28);
          outer.innerHTML = `
            ${showRef ? `<div style="font-family:${fontFamily};font-size:${rp}px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:28px">${escapeHtml(verse.reference || formatRef(verse))}</div>` : ''}
            <div style="font-family:${fontFamily};font-size:${mid}px;line-height:1.5;font-style:italic;word-break:break-word;overflow-wrap:break-word">&ldquo;${escapeHtml(verse.text)}&rdquo;</div>
            ${showTrans ? `<div style="font-family:${fontFamily};font-size:${tp}px;margin-top:24px">${escapeHtml(verse.translation || 'KJV')}</div>` : ''}
          `;
          if (outer.scrollHeight <= maxH) { best = mid; lo = mid + 1; }
          else                            { hi   = mid - 1; }
        }
        document.body.removeChild(outer);
        fontPx = best;
      }
    }
    // else: fontPx stays as the fixed font_size from settings
    const refRatio = parseFloat(settings.ref_size_ratio) || 0.45;
    const refPx    = Math.round(fontPx * refRatio);
    const transPx  = Math.round(fontPx * 0.28);

    if (isLowerThird) {
      // In lower-third the CSS scales: verse=0.62x, ref=0.28x, trans=0.22x
      const ltVersePx = Math.round(fontPx * 0.62);
      const ltRefPx   = Math.round(fontPx * 0.28);
      const ltTransPx = Math.round(fontPx * 0.22);
      innerHtml = `
        <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);border-top:3px solid rgba(255,255,255,0.15);padding:24px 11.5% 48px;text-align:left;word-break:break-word;overflow-wrap:break-word;animation:slideUpPrev ${transTime} ease">
          ${showRef ? `<div style="font-family:${fontFamily};font-size:${ltRefPx}px;font-weight:700;color:${refColor};letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">${escapeHtml(verse.reference || formatRef(verse))}</div>` : ''}
          <div style="font-family:${fontFamily};font-size:${ltVersePx}px;line-height:1.5;font-style:italic;color:${textColor};text-shadow:0 2px 8px rgba(0,0,0,0.5);word-break:break-word;overflow-wrap:break-word">&ldquo;${escapeHtml(verse.text)}&rdquo;</div>
          ${showTrans ? `<div style="font-family:${fontFamily};font-size:${ltTransPx}px;color:rgba(255,255,255,0.45);margin-top:10px;letter-spacing:1px">${escapeHtml(verse.translation || 'KJV')}</div>` : ''}
        </div>
      `;
    } else {
      innerHtml = `
        <div style="width:70%;text-align:center;word-break:break-word;overflow-wrap:break-word;animation:fadeInPrev ${transTime} ease">
          ${showRef ? `<div style="font-family:${fontFamily};font-size:${refPx}px;font-weight:700;color:${refColor};letter-spacing:2px;text-transform:uppercase;margin-bottom:28px">${escapeHtml(verse.reference || formatRef(verse))}</div>` : ''}
          <div style="font-family:${fontFamily};font-size:${fontPx}px;line-height:1.5;font-style:italic;color:${textColor};text-shadow:0 2px 8px rgba(0,0,0,0.5);word-break:break-word;overflow-wrap:break-word">&ldquo;${escapeHtml(verse.text)}&rdquo;</div>
          ${showTrans ? `<div style="font-family:${fontFamily};font-size:${transPx}px;color:rgba(255,255,255,0.45);margin-top:24px;letter-spacing:1px">${escapeHtml(verse.translation || 'KJV')}</div>` : ''}
        </div>
      `;
    }
  }

  // Build the 1920x1080 virtual projection surface
  canvas.innerHTML = `
    <div class="_proj-surface" style="
      width:${PROJ_W}px;height:${PROJ_H}px;
      background:${blanked ? '#000' : bg};
      display:flex;
      align-items:${isLowerThird ? 'flex-end' : 'center'};
      justify-content:center;
      position:relative;
      overflow:hidden;
      transition:background ${transTime} ease;
    ">${innerHtml}</div>
    <style>
      @keyframes fadeInPrev {
        from{opacity:0;transform:translateY(10px)}
        to{opacity:1;transform:translateY(0)}
      }
      @keyframes slideUpPrev {
        from{opacity:0;transform:translateY(20px)}
        to{opacity:1;transform:translateY(0)}
      }
    </style>
  `;

  // Scale the 1920x1080 surface to fit the preview container
  requestAnimationFrame(() => {
    const surface = canvas.querySelector('._proj-surface');
    if (!surface) return;
    const cw = canvas.clientWidth  || 1;
    const ch = canvas.clientHeight || 1;
    const scale = Math.min(cw / PROJ_W, ch / PROJ_H);
    surface.style.transform       = `scale(${scale})`;
    surface.style.transformOrigin = 'top left';
    const sw = PROJ_W * scale;
    const sh = PROJ_H * scale;
    surface.style.marginLeft = ((cw - sw) / 2) + 'px';
    surface.style.marginTop  = ((ch - sh) / 2) + 'px';
  });
}

function rescaleAllPreviews() {
  ['studio-canvas', 'live-canvas', 'display-canvas'].forEach(id => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const surface = canvas.querySelector('._proj-surface');
    if (!surface) return;
    const cw = canvas.clientWidth  || 1;
    const ch = canvas.clientHeight || 1;
    const scale = Math.min(cw / PROJ_W, ch / PROJ_H);
    surface.style.transform  = `scale(${scale})`;
    surface.style.marginLeft = ((cw - PROJ_W * scale) / 2) + 'px';
    surface.style.marginTop  = ((ch - PROJ_H * scale) / 2) + 'px';
  });
}

// ── Wrappers: one per preview canvas ──────────────────────────────────────────

function updateStudioPreview(verse) {
  const canvas = document.getElementById('studio-canvas');
  if (!canvas) return;
  renderProjectionPreview(canvas, verse || null, false);
}

function updateLivePreview(verse, blanked) {
  const canvas = document.getElementById('live-canvas');
  if (!canvas) return;
  renderProjectionPreview(canvas, verse || null, blanked);
  updateStatusBadge(!blanked && !!verse);
}

function syncDisplayPreviewLarge(verse) {
  const canvas = document.getElementById('display-canvas');
  if (!canvas) return;
  const v = verse || selectedVerse;
  renderProjectionPreview(canvas, v || null, isBlank);
}
