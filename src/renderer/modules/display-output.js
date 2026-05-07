/* BibleCast: display output controls
 *
 * Owns the operator's actions on the live projection: push a verse,
 * stop projecting, blank/unblank the screen, clear HDMI without
 * closing the window, plus the status indicators (LIVE/STANDBY badges,
 * Display off/Live dot, Outputs-pane status text) and the
 * Following-verses strip that appears below the live canvas.
 *
 * Also owns syncDisplayState (polled every 5s by init() in renderer.js)
 * and its _lastSyncKey de-dup guard, which prevents the live canvas
 * from re-running the fade-in animation on an unchanged slide.
 *
 * Cross-module references (resolve at call time once classic <script>
 * tags have parsed):
 *
 *   selectedVerse, isBlank, isProjecting, displayWindowOpen,
 *     hdmiMirrorOpen, api, settings                  (state)
 *   escapeHtml                                       (utils-browser)
 *   selectVerse                                      (search)
 *   refreshHistory                                   (sessions)
 *   renderProjectionPreview, updateLivePreview,
 *     syncDisplayPreviewLarge                        (projection-preview)
 */

const STOP_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;
const PLAY_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

function updatePushButton(projecting) {
  const disabled = !selectedVerse;
  const label    = projecting ? 'Stop Projecting' : 'Project';
  const icon     = projecting ? STOP_SVG : PLAY_SVG;
  [['push-btn','push-btn-label','push-btn-icon'],
   ['push-btn-dp','push-btn-dp-label','push-btn-dp-icon']].forEach(([btnId, lblId, iconId]) => {
    const btn = document.getElementById(btnId);
    const lbl = document.getElementById(lblId);
    const ico = document.getElementById(iconId);
    if (btn) { btn.disabled = disabled; btn.classList.toggle('btn-stop', !!projecting); }
    if (lbl) lbl.textContent = label;
    if (ico) ico.innerHTML = icon;
  });
  ['next-btn','next-btn-dp','prev-btn','prev-btn-dp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

// ── Following verses strip ────────────────────────────────────────────────────

async function renderFollowingVerses(reference, translation) {
  const strip = document.getElementById('following-strip');
  const list  = document.getElementById('following-list');
  if (!strip || !list) return;

  // Respect the "show following verses" setting (defaults on)
  const showFollowing = document.getElementById('setting-show-following');
  if (showFollowing && !showFollowing.checked) { strip.style.display = 'none'; return; }

  const verses = await api.getFollowingVerses(reference, translation, 10);
  if (!verses || !verses.length) { strip.style.display = 'none'; return; }

  list.innerHTML = verses.map((v, i) =>
    `<div class="following-item" data-idx="${i}">
      <span class="following-ref">${escapeHtml(v.reference)}</span>
      <span class="following-text">${escapeHtml(v.text)}</span>
    </div>`
  ).join('');

  list.querySelectorAll('.following-item').forEach((el, i) => {
    el.addEventListener('click', async () => {
      const v = verses[i];
      selectVerse(v, null);
      list.querySelectorAll('.following-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      await pushVerse();
    });
  });

  strip.style.display = 'block';
}

function clearFollowingVerses() {
  const strip = document.getElementById('following-strip');
  const list  = document.getElementById('following-list');
  if (strip) strip.style.display = 'none';
  if (list)  list.innerHTML = '';
}

// ── Display controls ──────────────────────────────────────────────────────────

async function pushVerse() {
  if (!selectedVerse) return;
  isBlank      = false;
  isProjecting = true;
  _lastSyncKey = null;

  if (!displayWindowOpen) {
    const r = await api.openDisplay();
    displayWindowOpen = !!r.open;
    updateDisplayBtn();
  }

  // Open NDI if the toggle is enabled, mirrors HDMI open logic above.
  // openNdiDisplay(true) creates the window on first use, or shows it if already hidden.
  const ndiToggle = document.getElementById('ndi-toggle');
  if (ndiToggle?.checked) {
    await api.openNdiDisplay(true);
  }

  const verse = { ...selectedVerse };
  if (!verse.translation) {
    verse.translation = document.getElementById('translation-select')?.value || 'KJV';
  }

  await api.pushVerse(verse);
  updatePushButton(true);
  updateLivePreview(verse, false);
  updateLiveBadge(true);
  syncDisplayPreviewLarge(verse);
  await refreshHistory();
  renderFollowingVerses(verse.reference, verse.translation);
}

async function stopProjecting() {
  isProjecting = false;
  isBlank      = true;
  _lastSyncKey = null;
  await api.blankDisplay(true);
  updatePushButton(false);
  updateLiveBadge(false);

  // Close HDMI display window
  if (displayWindowOpen) {
    await api.openDisplay(); // toggles it closed
    displayWindowOpen = false;
    updateDisplayBtn();
  }

  // Hide NDI output: use hide (not destroy) so the OS window handle stays stable
  // and OBS window-capture won't lose the source. Toggle stays checked so the
  // next Project click will re-show the same window automatically.
  const ndiToggle = document.getElementById('ndi-toggle');
  if (ndiToggle?.checked) {
    await api.openNdiDisplay(false);
  }

  // Close HDMI mirror
  if (hdmiMirrorOpen) {
    await api.openHdmiMirror(false);
    hdmiMirrorOpen = false;
    const mirrorToggle = document.getElementById('hdmi-mirror-toggle');
    if (mirrorToggle) mirrorToggle.checked = false;
    api.saveSetting('hdmi_mirror_enabled', 'false');
  }

  const lc = document.getElementById('live-canvas');
  if (lc) renderProjectionPreview(lc, null, true);
  const dc = document.getElementById('display-canvas');
  if (dc) renderProjectionPreview(dc, null, true);
  clearFollowingVerses();
}

async function clearHdmiDisplay() {
  isProjecting = false;
  isBlank      = false;
  _lastSyncKey = null;
  await api.clearHdmiDisplay();
  updatePushButton(false);
  updateLiveBadge(false);
  const lc = document.getElementById('live-canvas');
  if (lc) renderProjectionPreview(lc, null, false);
  const dc = document.getElementById('display-canvas');
  if (dc) renderProjectionPreview(dc, null, false);
  clearFollowingVerses();
}

async function toggleBlank() {
  isBlank = !isBlank;
  _lastSyncKey = null;
  await api.blankDisplay(isBlank);
  updateLiveBadge(!isBlank && !!selectedVerse);

  const canvas = document.getElementById('live-canvas');
  if (canvas) canvas.classList.toggle('blanked', isBlank);

  if (isBlank) {
    const dc = document.getElementById('display-canvas');
    if (dc) dc.innerHTML = '<div class="preview-empty">Display blanked</div>';
  }
}

function updateLiveBadge(live) {
  ['live-badge', 'live-badge-dp'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = live ? 'LIVE' : 'STANDBY';
    badge.className   = 'live-badge' + (live ? ' live' : '');
  });
}

// Tracks last state synced to live canvas, prevents unnecessary re-renders
let _lastSyncKey = null;

async function syncDisplayState() {
  const state = await api.getDisplayState();
  if (!state) return;

  const visible = state.is_visible === 1;
  isBlank       = !visible;

  isProjecting  = visible && !!state.current_text;
  updatePushButton(isProjecting);
  const projLive = displayWindowOpen && visible && !!state.current_text;
  updateStatusBadge(projLive);
  updateLiveBadge(projLive);

  // Update the output status in Outputs pane
  const statusEl = document.getElementById('output-status-text');
  if (statusEl) {
    statusEl.textContent = visible && state.current_text
      ? `Projecting: ${state.current_reference || ''}`
      : 'Standby';
  }

  // Only re-render the canvas if the content actually changed, prevents the
  // fadeInPrev animation from firing every 5 seconds on an unchanged slide.
  const syncKey = `${visible}|${state.current_text || ''}|${state.current_reference || ''}`;
  if (syncKey === _lastSyncKey) return;
  _lastSyncKey = syncKey;

  if (state.current_text) {
    const canvas = document.getElementById('live-canvas');
    if (canvas) {
      const v = { reference: state.current_reference || '', text: state.current_text, translation: state.translation || 'KJV' };
      renderProjectionPreview(canvas, visible ? v : null, !visible);
      canvas.classList.toggle('blanked', !visible);
    }
  }
}

function updateDisplayBtn() {
  const btn = document.getElementById('open-display-btn');
  if (btn) {
    if (displayWindowOpen) {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Close Display`;
    } else {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Open Display`;
      // Display just closed, immediately clear live indicators
      updateStatusBadge(false);
      updateLiveBadge(false);
    }
  }
  // Keep HDMI toggle in sync
  const hdmiToggle = document.getElementById('hdmi-toggle');
  if (hdmiToggle) hdmiToggle.checked = displayWindowOpen;
  api.saveSetting('hdmi_enabled', displayWindowOpen.toString());

  // Clear button is only useful while the HDMI window is open
  ['clear-hdmi-btn', 'clear-hdmi-btn-dp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !displayWindowOpen;
  });
}

function updateStatusBadge(live) {
  const dot  = document.getElementById('display-status-dot');
  const text = document.getElementById('display-status-text');
  if (dot)  dot.className    = 'status-dot' + (live ? ' live' : '');
  if (text) text.textContent = live ? 'Live' : 'Display off';

  // Outputs pane badge + status text
  const outBadge = document.getElementById('live-badge-out');
  if (outBadge) {
    outBadge.textContent = live ? 'LIVE' : 'STANDBY';
    outBadge.className   = 'live-badge' + (live ? ' live' : '');
  }
  const outStatus = document.getElementById('output-verse-status');
  if (outStatus) {
    outStatus.textContent = live && selectedVerse
      ? `${selectedVerse.reference || ''}`
      : 'No verse on display';
  }
}
