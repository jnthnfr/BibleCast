#!/usr/bin/env node
/**
 * BibleCast — Translation Downloader
 *
 * Downloads Bible translations from getbible.net (public domain / freely licensed)
 * and stores them in the local SQLite database.
 *
 * Usage:
 *   node scripts/download-translations.js              # download all bundled translations
 *   node scripts/download-translations.js kjv          # download a single translation
 *   node scripts/download-translations.js kjv asv web  # download specific ones
 *
 * Available public domain / freely licensed translations:
 *   kjv   King James Version (1611)           — public domain
 *   asv   American Standard Version (1901)    — public domain
 *   web   World English Bible                 — public domain (no rights reserved)
 *   ylt   Young's Literal Translation (1898)  — public domain
 *   bbe   Bible in Basic English (1965)        — public domain (US)
 *   dby   Darby Translation (1890)            — public domain
 *   wbs   Webster Bible (1833)                — public domain
 *   hnv   Hebrew Names Version                — public domain
 *   oeb   Open English Bible                  — public domain
 *
 * Copyrighted translations (NIV, ESV, NKJV, NLT, etc.) cannot be downloaded here.
 * Import them via the app's "Import JSON File" button if you hold a licence.
 *
 * Data source: https://api.getbible.net/v2/  (MIT licensed API)
 */

const https = require('https');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---- Configuration --------------------------------------------------------

const TRANSLATIONS = {
  kjv: { name: 'King James Version',              language: 'English' },
  asv: { name: 'American Standard Version',       language: 'English' },
  web: { name: 'World English Bible',              language: 'English' },
  ylt: { name: "Young's Literal Translation",      language: 'English' },
  bbe: { name: 'Bible in Basic English',           language: 'English' },
  dby: { name: 'Darby Translation',               language: 'English' },
  wbs: { name: 'Webster Bible',                    language: 'English' },
  hnv: { name: 'Hebrew Names Version',             language: 'English' },
  oeb: { name: 'Open English Bible',               language: 'English' },
  // Afrikaans
  afr: { name: 'Afrikaans Bible (1953)',            language: 'Afrikaans' },
  // Spanish
  rvr60: { name: 'Reina-Valera (1960)',             language: 'Spanish' },
  // French
  ls1910: { name: 'Louis Segond (1910)',            language: 'French' },
  // German
  lut: { name: 'Luther Bibel (1912)',               language: 'German' },
  // Portuguese
  almeida: { name: 'Almeida Revista e Corrigida',   language: 'Portuguese' },
};

const BASE_URL = 'https://api.getbible.net/v2';
const FALLBACK_URL = 'https://cdn.getbible.net/data/json';

// ---- DB setup -------------------------------------------------------------

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const dbDir  = path.join(appData, 'BibleCast');
const dbPath = path.join(dbDir, 'biblecast.db');

if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    abbreviation TEXT NOT NULL UNIQUE,
    language TEXT NOT NULL DEFAULT 'English',
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS display_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_reference TEXT,
    current_text TEXT,
    is_visible INTEGER NOT NULL DEFAULT 0,
    translation TEXT NOT NULL DEFAULT 'KJV',
    font_size INTEGER NOT NULL DEFAULT 48,
    theme TEXT NOT NULL DEFAULT 'dark'
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS displayed_verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    reference TEXT NOT NULL,
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    text TEXT NOT NULL,
    translation TEXT NOT NULL DEFAULT 'KJV',
    displayed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO display_state (id) VALUES (1);
`);

// ---- Helpers --------------------------------------------------------------

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'BibleCast/1.0' } }, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      let data = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

/**
 * Convert getbible.net v2 JSON to BibleCast verse array.
 * getbible format: { "1": { name, chapters: { "1": { "1": { verse, text } } } } }
 */
function convertGetbible(raw) {
  const verses = [];
  for (const [, bookData] of Object.entries(raw)) {
    const bookName = bookData.name;
    for (const [chapterNum, chapterData] of Object.entries(bookData.chapters)) {
      for (const [, verseData] of Object.entries(chapterData)) {
        const text = (verseData.text || '').trim().replace(/\s+/g, ' ');
        if (text) {
          verses.push({
            book: bookName,
            chapter: parseInt(chapterNum),
            verse: parseInt(verseData.verse),
            text,
          });
        }
      }
    }
  }
  return verses;
}

function saveTranslation(abbreviation, name, language, verses) {
  const existing = db.prepare('SELECT id FROM translations WHERE abbreviation = ?').get(abbreviation.toUpperCase());
  const abbr = abbreviation.toUpperCase();

  if (existing) {
    db.prepare('UPDATE translations SET name=?, language=?, data=? WHERE abbreviation=?')
      .run(name, language, JSON.stringify(verses), abbr);
  } else {
    db.prepare('INSERT INTO translations (name, abbreviation, language, data) VALUES (?,?,?,?)')
      .run(name, abbr, language, JSON.stringify(verses));
  }
}

// ---- Progress display -----------------------------------------------------

function progress(msg, clear = false) {
  if (clear) process.stdout.clearLine?.(0);
  process.stdout.write('\r' + msg);
}

function println(msg) {
  process.stdout.write('\n' + msg + '\n');
}

// ---- Download logic -------------------------------------------------------

async function downloadTranslation(abbr) {
  const meta = TRANSLATIONS[abbr.toLowerCase()];
  const name = meta ? meta.name : abbr.toUpperCase() + ' Bible';
  const language = meta ? meta.language : 'Unknown';

  process.stdout.write(`  Downloading ${abbr.toUpperCase()} — ${name}... `);

  const url = `${BASE_URL}/${abbr.toLowerCase()}.json`;

  let raw;
  try {
    raw = await httpGet(url);
  } catch (err) {
    println(`FAILED (${err.message})`);
    return false;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    println('FAILED (invalid JSON)');
    return false;
  }

  const verses = convertGetbible(data);

  if (!verses.length) {
    println('FAILED (0 verses extracted — check translation abbreviation)');
    return false;
  }

  saveTranslation(abbr, name, language, verses);
  println(`OK (${verses.length.toLocaleString()} verses)`);
  return true;
}

// ---- Main -----------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const targets = args.length ? args : Object.keys(TRANSLATIONS);

  println(`\nBibleCast Translation Downloader`);
  println(`Database: ${dbPath}`);
  println(`Downloading ${targets.length} translation(s)...\n`);

  let ok = 0, fail = 0;

  for (const abbr of targets) {
    if (!TRANSLATIONS[abbr.toLowerCase()] && args.length) {
      println(`  WARNING: "${abbr}" is not in the known list — attempting anyway.`);
    }
    const success = await downloadTranslation(abbr);
    success ? ok++ : fail++;
    // Small delay to be polite to the API
    await new Promise(r => setTimeout(r, 500));
  }

  println(`\nDone.  ${ok} succeeded, ${fail} failed.`);
  println(`\nStart the app with:  npm start`);

  if (fail > 0) {
    println(`\nFailed translations may use different abbreviations on getbible.net.`);
    println(`Browse available translations at: https://api.getbible.net/v2/translations.json`);
  }

  db.close();
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
