/* BibleCast — Bible Gateway Scraper Popup */

const api = window.biblecast;

// ── Translation catalogue ──────────────────────────────────────────────────

const TRANSLATIONS = [
  { abbr: 'AMP',      name: 'Amplified Bible',                        copyright: false },
  { abbr: 'AKJV',     name: 'American King James Version',            copyright: false },
  { abbr: 'ASV',      name: 'American Standard Version (1901)',       copyright: false },
  { abbr: 'BRG',      name: 'Berean Reference Bible',                 copyright: false },
  { abbr: 'CSB',      name: 'Christian Standard Bible',               copyright: true  },
  { abbr: 'EHV',      name: 'Evangelical Heritage Version',           copyright: false },
  { abbr: 'ESV',      name: 'English Standard Version',               copyright: true  },
  { abbr: 'ESVUK',    name: 'English Standard Version (UK)',          copyright: true  },
  { abbr: 'GNV',      name: 'Geneva Bible (1599)',                     copyright: false },
  { abbr: 'GW',       name: "God's Word Translation",                 copyright: false },
  { abbr: 'ISV',      name: 'International Standard Version',         copyright: false },
  { abbr: 'JUB',      name: 'Jubilee Bible 2000',                     copyright: false },
  { abbr: 'KJV',      name: 'King James Version (1611)',              copyright: false },
  { abbr: 'KJ21',     name: 'King James Version 21st Century',        copyright: false },
  { abbr: 'LEB',      name: 'Lexham English Bible',                   copyright: false },
  { abbr: 'MEV',      name: 'Modern English Version',                 copyright: false },
  { abbr: 'NASB',     name: 'New American Standard Bible (2020)',     copyright: true  },
  { abbr: 'NASB1995', name: 'New American Standard Bible (1995)',     copyright: true  },
  { abbr: 'NET',      name: 'New English Translation',                copyright: false },
  { abbr: 'NIV',      name: 'New International Version',              copyright: true  },
  { abbr: 'NIVUK',    name: 'New International Version (UK)',         copyright: true  },
  { abbr: 'NKJV',     name: 'New King James Version',                 copyright: true  },
  { abbr: 'NLT',      name: 'New Living Translation',                 copyright: true  },
  { abbr: 'NLV',      name: 'New Life Version',                       copyright: false },
  { abbr: 'NOG',      name: 'Names of God Bible',                     copyright: false },
  { abbr: 'NRSV',     name: 'New Revised Standard Version',           copyright: true  },
  { abbr: 'NRSVUE',   name: 'NRSV Updated Edition',                  copyright: true  },
  { abbr: 'WEB',      name: 'World English Bible',                    copyright: false },
  { abbr: 'YLT',      name: "Young's Literal Translation (1898)",     copyright: false },
];

// ── State ──────────────────────────────────────────────────────────────────

let pythonPath    = null;
let installedSet  = new Set();
let isScraping    = false;
let progressMap   = {}; // abbr → { status, done, total }
let progressListener = null; // Store listener reference for cleanup

// ── Boot ───────────────────────────────────────────────────────────────────

async function init() {
  await detectInstalled();
  renderList();
  checkPython();
  bindEvents();
  listenProgress();
}

async function detectInstalled() {
  try {
    const list = await api.listTranslations();
    installedSet = new Set(list.map(t => t.abbreviation.toUpperCase()));
  } catch (_) {}
}

// ── Python check ───────────────────────────────────────────────────────────

async function checkPython() {
  const bar   = document.getElementById('python-bar');
  const val   = document.getElementById('python-val');
  const note  = document.getElementById('python-note');

  bar.className = 'python-bar checking';
  val.textContent = 'Checking…';

  const result = await api.checkPython();

  if (result.ok) {
    pythonPath = result.path;
    bar.className = 'python-bar ok';
    val.textContent = result.version;
    note.textContent = 'Ready';
    document.getElementById('download-btn').disabled = selectedAbbrs().length === 0;
  } else {
    bar.className = 'python-bar fail';
    val.textContent = 'Not found';
    note.textContent = 'Install Python 3 from python.org, then reopen this window';
    document.getElementById('download-btn').disabled = true;
  }
}

// ── Render translation list ────────────────────────────────────────────────

function renderList() {
  const container = document.getElementById('translation-list');
  const countLbl  = document.getElementById('list-count-lbl');
  const available = TRANSLATIONS.filter(t => !installedSet.has(t.abbr.toUpperCase()));
  if (countLbl) countLbl.textContent = `Available Translations (${TRANSLATIONS.length})`;
  container.innerHTML = TRANSLATIONS.map(t => {
    const installed = installedSet.has(t.abbr.toUpperCase());
    return `
      <label class="tl-item${installed ? ' installed' : ''}" data-abbr="${t.abbr}">
        <input type="checkbox" class="tl-check" data-abbr="${t.abbr}" ${installed ? 'disabled' : ''} />
        <span class="tl-abbr">${t.abbr}</span>
        <span class="tl-name">${escapeHtml(t.name)}</span>
        ${installed
          ? '<span class="tl-tag installed">Installed</span>'
          : t.copyright
            ? '<span class="tl-tag copyright">© Copyright</span>'
            : '<span class="tl-tag free">Free</span>'
        }
      </label>
    `;
  }).join('');

  container.querySelectorAll('.tl-check').forEach(cb => {
    cb.addEventListener('change', updateFooter);
  });
}

// ── Selection helpers ──────────────────────────────────────────────────────

function selectedAbbrs() {
  return [...document.querySelectorAll('.tl-check:checked')].map(cb => cb.dataset.abbr);
}

function updateFooter() {
  const sel = selectedAbbrs();
  const info = document.getElementById('footer-info');
  info.textContent = sel.length === 0
    ? 'Select translations to download'
    : `${sel.length} translation${sel.length > 1 ? 's' : ''} selected`;
  const dlBtn = document.getElementById('download-btn');
  dlBtn.disabled = sel.length === 0 || !pythonPath || isScraping;
}

// ── Progress rendering ─────────────────────────────────────────────────────

function ensureProgressRow(abbr) {
  const container = document.getElementById('progress-rows');
  if (document.getElementById(`prog-${abbr}`)) return;

  const row = document.createElement('div');
  row.className = 'prog-row';
  row.id = `prog-${abbr}`;
  row.innerHTML = `
    <span class="prog-abbr" id="pa-${abbr}">${abbr}</span>
    <div class="prog-bar-wrap">
      <div class="prog-bar" id="pb-${abbr}" style="width:0%"></div>
    </div>
    <span class="prog-status" id="ps-${abbr}">Queued</span>
  `;
  container.appendChild(row);
}

function updateProgressRow(abbr, pct, statusText, state) {
  const abbrEl  = document.getElementById(`pa-${abbr}`);
  const barEl   = document.getElementById(`pb-${abbr}`);
  const statEl  = document.getElementById(`ps-${abbr}`);
  if (!abbrEl || !barEl || !statEl) return;

  abbrEl.className = `prog-abbr ${state}`;
  barEl.className  = `prog-bar ${state}`;
  barEl.style.width = pct + '%';
  statEl.textContent = statusText;
}

// ── Progress listener ──────────────────────────────────────────────────────

function listenProgress() {
  progressListener = msg => {
    const { abbr } = msg;

    // Queue-level completion — reset scraping state
    if (msg.type === 'queue-done') {
      isScraping = false;
      document.getElementById('cancel-btn').style.display = 'none';
      document.getElementById('close-btn').style.display  = '';
      document.getElementById('download-btn').disabled = selectedAbbrs().length === 0 || !pythonPath;
      document.getElementById('footer-info').textContent = 'All downloads complete.';
      // Reload installed badge list
      detectInstalled().then(renderList);
      return;
    }

    if (!abbr) return;
    ensureProgressRow(abbr);

    switch (msg.type) {
      case 'starting':
        updateProgressRow(abbr, 0, 'Starting…', 'active');
        break;

      case 'status':
        updateProgressRow(abbr, 2, msg.msg || 'Working…', 'active');
        break;

      case 'progress': {
        const pct = msg.total > 0 ? Math.round((msg.done / msg.total) * 100) : 0;
        updateProgressRow(abbr, pct, `${msg.book} (${msg.done + 1}/${msg.total})`, 'active');
        break;
      }

      case 'warning':
        // Partial failure on a single book — don't abort, just note it
        updateProgressRow(
          abbr,
          Math.round(((progressMap[abbr]?.done || 0) / 66) * 100),
          `Warning: ${msg.book}`,
          'active'
        );
        break;

      case 'imported':
        updateProgressRow(abbr, 100, `✓ ${(msg.count || 0).toLocaleString()} verses`, 'done');
        installedSet.add(abbr.toUpperCase());
        break;

      case 'error':
        updateProgressRow(abbr, 100, `✗ ${msg.msg || 'Error'}`, 'error');
        break;
    }
  };
  api.onScrapeProgress(progressListener);
}

function cleanupScraper() {
  if (progressListener) {
    api.offScrapeProgress?.(progressListener);
    progressListener = null;
  }
}

// ── Download ───────────────────────────────────────────────────────────────

async function startDownload() {
  const abbrs = selectedAbbrs();
  if (!abbrs.length || !pythonPath) return;

  isScraping = true;
  progressMap = {};

  // Show progress area
  const progArea = document.getElementById('progress-area');
  progArea.classList.add('visible');
  document.getElementById('progress-rows').innerHTML = '';

  // Pre-create a row for each selected translation
  abbrs.forEach(abbr => ensureProgressRow(abbr));

  // Update buttons
  document.getElementById('download-btn').disabled = true;
  document.getElementById('cancel-btn').style.display = '';
  document.getElementById('close-btn').style.display = 'none';
  document.getElementById('footer-info').textContent =
    `Downloading ${abbrs.length} translation${abbrs.length > 1 ? 's' : ''}…`;

  // Uncheck downloaded ones so the list updates correctly after
  document.querySelectorAll('.tl-check:checked').forEach(cb => { cb.checked = false; });

  await api.startScrape({ abbrs, pythonPath });
}

// ── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Event bindings ─────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('select-all-btn').addEventListener('click', () => {
    document.querySelectorAll('.tl-check:not(:disabled)').forEach(cb => { cb.checked = true; });
    updateFooter();
  });

  document.getElementById('select-none-btn').addEventListener('click', () => {
    document.querySelectorAll('.tl-check').forEach(cb => { cb.checked = false; });
    updateFooter();
  });

  document.getElementById('select-free-btn').addEventListener('click', () => {
    document.querySelectorAll('.tl-check:not(:disabled)').forEach(cb => {
      const abbr = cb.dataset.abbr;
      const t = TRANSLATIONS.find(x => x.abbr === abbr);
      cb.checked = t ? !t.copyright : false;
    });
    updateFooter();
  });

  document.getElementById('download-btn').addEventListener('click', startDownload);

  document.getElementById('cancel-btn').addEventListener('click', async () => {
    await api.cancelScrape();
    isScraping = false;
    document.getElementById('cancel-btn').style.display  = 'none';
    document.getElementById('close-btn').style.display   = '';
    document.getElementById('download-btn').disabled = selectedAbbrs().length === 0 || !pythonPath;
    document.getElementById('footer-info').textContent = 'Download cancelled.';
  });

  document.getElementById('close-btn').addEventListener('click', () => {
    cleanupScraper();
    window.close();
  });
}

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
