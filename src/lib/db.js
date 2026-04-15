const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

let db;

function getDb() {
  if (!db) {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'biblecast.db');

    // Ensure the directory exists
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO display_state (id) VALUES (1);
  `);
}

// --- Sessions ---

function createSession(name) {
  const db = getDb();
  db.prepare('UPDATE sessions SET is_active = 0 WHERE is_active = 1').run();
  const result = db.prepare(
    'INSERT INTO sessions (name, is_active) VALUES (?, 1)'
  ).run(name);
  return getSession(result.lastInsertRowid);
}

function getSession(id) {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function getActiveSession() {
  return getDb().prepare('SELECT * FROM sessions WHERE is_active = 1').get();
}

function listSessions() {
  return getDb().prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
}

// --- Displayed verses ---

function logDisplayedVerse({ sessionId, reference, book, chapter, verse, text, translation }) {
  getDb().prepare(`
    INSERT INTO displayed_verses (session_id, reference, book, chapter, verse, text, translation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, reference, book, chapter, verse, text, translation);
}

function getSessionVerses(sessionId) {
  return getDb().prepare(
    'SELECT * FROM displayed_verses WHERE session_id = ? ORDER BY displayed_at ASC'
  ).all(sessionId);
}

// --- Verse search ---

function searchVerses({ query, translation = 'KJV', limit = 20 }) {
  const db = getDb();
  const trans = db.prepare('SELECT data FROM translations WHERE abbreviation = ?').get(translation);
  if (!trans) return [];

  const verses = JSON.parse(trans.data);

  // Check if query looks like a reference (e.g. "John 3:16" or "John 3 16")
  const refMatch = query.match(/^(\d?\s*[a-zA-Z]+(?:\s+[a-zA-Z]+)*?)\s+(\d+)(?:[: ](\d+))?/);
  if (refMatch) {
    return searchByReference(verses, refMatch, limit);
  }

  // Keyword search
  return searchByKeyword(verses, query.toLowerCase(), limit);
}

function searchByReference(verses, match, limit) {
  const bookQuery = match[1].toLowerCase().trim();
  const chapter = parseInt(match[2]);
  const verse = match[3] ? parseInt(match[3]) : null;

  return verses
    .filter(v => {
      const bookMatch = v.book.toLowerCase().startsWith(bookQuery) ||
        v.book_abbrev?.toLowerCase().startsWith(bookQuery);
      if (!bookMatch) return false;
      if (v.chapter !== chapter) return false;
      if (verse !== null && v.verse !== verse) return false;
      return true;
    })
    .slice(0, limit);
}

function searchByKeyword(verses, keyword, limit) {
  return verses
    .filter(v => v.text.toLowerCase().includes(keyword))
    .slice(0, limit);
}

// --- Translations ---

function listTranslations() {
  return getDb().prepare('SELECT id, name, abbreviation, language FROM translations').all();
}

function addTranslation({ name, abbreviation, language, data }) {
  getDb().prepare(`
    INSERT OR REPLACE INTO translations (name, abbreviation, language, data)
    VALUES (?, ?, ?, ?)
  `).run(name, abbreviation, language, JSON.stringify(data));
}

// --- Display state ---

function getDisplayState() {
  return getDb().prepare('SELECT * FROM display_state WHERE id = 1').get();
}

function updateDisplayState(fields) {
  const allowed = ['current_reference', 'current_text', 'is_visible', 'translation', 'font_size', 'theme'];
  const updates = Object.entries(fields)
    .filter(([k]) => allowed.includes(k))
    .map(([k]) => `${k} = ?`).join(', ');
  const values = Object.entries(fields)
    .filter(([k]) => allowed.includes(k))
    .map(([, v]) => v);

  if (!updates) return;
  getDb().prepare(`UPDATE display_state SET ${updates} WHERE id = 1`).run(...values);
}

// --- Settings ---

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  createSession,
  getSession,
  getActiveSession,
  listSessions,
  logDisplayedVerse,
  getSessionVerses,
  searchVerses,
  listTranslations,
  addTranslation,
  getDisplayState,
  updateDisplayState,
  getSetting,
  setSetting,
  getAllSettings,
  closeDb,
};
