/* BibleCast: translation management module
 *
 * Owns the translation dropdown in the header, the installed-translations
 * list in the search sidebar and Settings, and the downloadable-translations
 * picker (groups by language, fires download IPC, refreshes both lists on
 * success). Also handles file-based JSON/XML imports.
 *
 * availableCache and installedAbbrs are shared script-level bindings.
 * escapeHtml is provided by src/lib/utils-browser.js, loaded earlier.
 */

async function loadTranslations() {
  const translations = await api.listTranslations();
  const select       = document.getElementById('translation-select');
  if (!select) return;

  select.innerHTML = '';

  if (!translations.length) {
    const opt       = document.createElement('option');
    opt.value       = '';
    opt.textContent = 'No translations, see Search sidebar';
    select.appendChild(opt);
    refreshInstalledList([]);
    return;
  }

  translations.forEach(t => {
    const opt       = document.createElement('option');
    opt.value       = t.abbreviation;
    opt.textContent = `${t.abbreviation}: ${t.name}`;
    select.appendChild(opt);
  });

  refreshInstalledList(translations);
}

function refreshInstalledList(translations) {
  // Right sidebar Search pane
  const el = document.getElementById('translations-list');
  if (el) {
    if (!translations.length) {
      el.textContent = 'None installed yet.';
    } else {
      el.innerHTML = translations.map(t =>
        `<span class="translation-badge-item">${escapeHtml(t.abbreviation)}</span>`
      ).join('');
    }
  }

  // Settings view
  const sel = document.getElementById('settings-translations-list');
  if (sel) {
    if (!translations.length) {
      sel.textContent = 'None installed yet.';
    } else {
      sel.innerHTML = translations.map(t =>
        `<div class="dl-row">
          <div class="dl-info">
            <div class="dl-name">${escapeHtml(t.name)}</div>
            <div class="dl-abbr">${escapeHtml(t.abbreviation)} · ${escapeHtml(t.language)}</div>
          </div>
          <span style="color:var(--success);font-size:0.78rem">✓ Installed</span>
        </div>`
      ).join('');
    }
  }
}

// Available translations (download list)
let availableCache = [];
let installedAbbrs = new Set();

async function loadAvailableTranslations() {
  availableCache = await api.listAvailableTranslations();
  const installed  = await api.listTranslations();
  installedAbbrs   = new Set(installed.map(t => t.abbreviation.toLowerCase()));
  renderAvailableList();
}

function renderAvailableList() {
  renderAvailableInto('settings-available-list');
}

function renderAvailableInto(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!availableCache.length) { el.textContent = 'None available.'; return; }

  // Group by language
  const byLang = {};
  for (const t of availableCache) {
    if (!byLang[t.language]) byLang[t.language] = [];
    byLang[t.language].push(t);
  }

  let html = '';
  for (const [lang, list] of Object.entries(byLang)) {
    html += `<div style="margin-bottom:10px">`;
    html += `<div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px">${escapeHtml(lang)}</div>`;
    for (const t of list) {
      const installed = installedAbbrs.has(t.abbr.toLowerCase());
      html += `<div class="dl-row" data-abbr="${t.abbr}">
        <div class="dl-info">
          <div class="dl-name">${escapeHtml(t.name)}</div>
          <div class="dl-abbr">${escapeHtml(t.abbr.toUpperCase())}</div>
        </div>
        <button
          class="btn btn-secondary btn-sm dl-btn"
          data-abbr="${t.abbr}"
          style="min-width:78px;font-size:0.72rem"
          ${installed ? 'disabled' : ''}
        >${installed ? '✓ Installed' : '↓ Download'}</button>
      </div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;

  el.querySelectorAll('.dl-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => downloadTranslation(btn.dataset.abbr, btn));
  });
}

async function downloadTranslation(abbr, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  setImportStatus(`Downloading ${abbr.toUpperCase()}...`, 'var(--text-muted)');

  const result = await api.downloadTranslation(abbr);

  if (result.ok) {
    setImportStatus(
      `Downloaded "${result.name}", ${result.count.toLocaleString()} verses.`,
      'var(--success)'
    );
    installedAbbrs.add(abbr.toLowerCase());
    if (btn) btn.textContent = '✓ Installed';
    await loadTranslations();
    renderAvailableList();
  } else {
    setImportStatus(`Download failed: ${result.error}`, 'var(--danger)');
    if (btn) { btn.disabled = false; btn.textContent = '↓ Download'; }
  }
}

async function importTranslationFile(statusId) {
  setImportStatus('Opening file picker...', 'var(--text-muted)', statusId);
  const result = await api.importTranslationFile();
  if (result.canceled) { setImportStatus('', '', statusId); return; }
  if (result.ok) {
    setImportStatus(`Imported "${result.name}", ${result.count.toLocaleString()} verses.`, 'var(--success)', statusId);
    await loadTranslations();
    await loadAvailableTranslations();
  } else {
    setImportStatus('Import failed: ' + result.error, 'var(--danger)', statusId);
  }
}

function setImportStatus(msg, color, id = 'import-status') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent  = msg;
  el.style.color  = color;
}
