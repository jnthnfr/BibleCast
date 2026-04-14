/**
 * BibleCast — Database seeder
 *
 * Usage:
 *   node scripts/seed-db.js                     # loads bundled sample KJV
 *   node scripts/seed-db.js path/to/file.json   # loads a full translation JSON
 *
 * Full translation JSON format (array of verse objects):
 * [
 *   { "book": "Genesis", "chapter": 1, "verse": 1, "text": "In the beginning..." },
 *   ...
 * ]
 *
 * Optional fields: "reference", "book_abbrev"
 *
 * Note: Run this from the BibleCast project root. The DB path is resolved via
 * the APPDATA environment variable — same path Electron uses at runtime.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Resolve the same DB path Electron uses
const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const dbDir = path.join(appData, 'BibleCast');
const dbPath = path.join(dbDir, 'biblecast.db');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`Created directory: ${dbDir}`);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Ensure schema exists
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

// Determine data source
let verses, name, abbreviation, language;

const arg = process.argv[2];

if (arg) {
  // Load from file
  const filePath = path.resolve(arg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Loading translation from: ${filePath}`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  verses = JSON.parse(raw);

  // Attempt to guess name from filename
  const basename = path.basename(filePath, path.extname(filePath)).toUpperCase();
  name = process.argv[3] || `${basename} Bible`;
  abbreviation = process.argv[4] || basename.slice(0, 6);
  language = process.argv[5] || 'English';

  console.log(`Translation: "${name}" (${abbreviation})`);
} else {
  // Load bundled sample
  verses = require('../data/sample-kjv.js');
  name = 'King James Version (Sample)';
  abbreviation = 'KJV';
  language = 'English';
  console.log('Loading bundled sample KJV verses...');
}

// Validate structure
if (!Array.isArray(verses) || !verses.length) {
  console.error('Invalid data: expected a non-empty array of verse objects.');
  process.exit(1);
}

const sample = verses[0];
if (!sample.book || sample.chapter == null || sample.verse == null || !sample.text) {
  console.error('Invalid verse format. Each object must have: book, chapter, verse, text');
  console.error('Got:', JSON.stringify(sample));
  process.exit(1);
}

// Upsert translation
const existing = db.prepare('SELECT id FROM translations WHERE abbreviation = ?').get(abbreviation);

if (existing) {
  db.prepare('UPDATE translations SET name = ?, language = ?, data = ? WHERE abbreviation = ?')
    .run(name, language, JSON.stringify(verses), abbreviation);
  console.log(`Updated existing translation "${abbreviation}".`);
} else {
  db.prepare('INSERT INTO translations (name, abbreviation, language, data) VALUES (?, ?, ?, ?)')
    .run(name, abbreviation, language, JSON.stringify(verses));
  console.log(`Inserted new translation "${abbreviation}".`);
}

const count = verses.length;
console.log(`\nDone. Seeded ${count} verses into ${dbPath}`);
console.log(`\nYou can now run the app with: npm start`);

db.close();
