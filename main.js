const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let operatorWindow = null;
let displayWindow = null;
let db = null;

// Delay DB load until app is ready (needs app.getPath)
function getDb() {
  if (!db) db = require('./src/lib/db');
  return db;
}

// --- Window creation ---

function createOperatorWindow() {
  operatorWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'BibleCast — Operator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  operatorWindow.loadFile('src/renderer/index.html');

  if (process.env.NODE_ENV === 'development') {
    operatorWindow.webContents.openDevTools();
  }

  operatorWindow.on('closed', () => {
    operatorWindow = null;
  });
}

function createDisplayWindow() {
  const displays = screen.getAllDisplays();
  // Use the second display if available, otherwise the primary
  const targetDisplay = displays.length > 1
    ? displays.find(d => d.id !== screen.getPrimaryDisplay().id) || displays[0]
    : displays[0];

  const { x, y, width, height } = targetDisplay.bounds;

  displayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    fullscreen: displays.length > 1,
    frame: false,
    title: 'BibleCast — Display',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  displayWindow.loadFile('src/display/display.html');

  displayWindow.on('closed', () => {
    displayWindow = null;
  });
}

// --- App lifecycle ---

app.whenReady().then(() => {
  createOperatorWindow();
  createDisplayWindow();
  registerIpcHandlers();
  checkFirstRun();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOperatorWindow();
      createDisplayWindow();
    }
  });
});

app.on('window-all-closed', () => {
  getDb().closeDb();
  if (process.platform !== 'darwin') app.quit();
});

// --- First-run check ---

function checkFirstRun() {
  // Wait for windows to load before showing dialog
  setTimeout(() => {
    const db = getDb();
    const translationCount = db.getDb().prepare('SELECT COUNT(*) as c FROM translations').get();
    if (translationCount.c === 0) {
      dialog.showMessageBox(operatorWindow, {
        type: 'info',
        title: 'Welcome to BibleCast',
        message: 'No Bible translations installed yet.',
        detail: 'Go to the Settings tab to download free translations (KJV, ASV, WEB, and more), or import your own JSON file.',
        buttons: ['Open Settings', 'Later'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0 && operatorWindow) {
          operatorWindow.webContents.send('nav:settings');
        }
      });
    }
  }, 1500);
}

// --- IPC Handlers ---

function registerIpcHandlers() {
  // Verse search
  ipcMain.handle('verse:search', (_event, { query, translation }) => {
    return getDb().searchVerses({ query, translation });
  });

  // Push a verse to the display window
  ipcMain.handle('verse:push', (_event, verse) => {
    const state = {
      current_reference: verse.reference,
      current_text: verse.text,
      is_visible: 1,
      translation: verse.translation || 'KJV',
    };
    getDb().updateDisplayState(state);

    if (displayWindow) {
      displayWindow.webContents.send('display:update', {
        type: 'verse',
        reference: verse.reference,
        text: verse.text,
        translation: verse.translation || 'KJV',
        visible: true,
      });
    }

    // Log to active session
    const session = getDb().getActiveSession();
    if (session) {
      getDb().logDisplayedVerse({
        sessionId: session.id,
        reference: verse.reference,
        book: verse.book,
        chapter: verse.chapter,
        verse: verse.verse,
        text: verse.text,
        translation: verse.translation || 'KJV',
      });
    }

    return { ok: true };
  });

  // Blank / unblank display
  ipcMain.handle('display:blank', (_event, blank) => {
    getDb().updateDisplayState({ is_visible: blank ? 0 : 1 });

    if (displayWindow) {
      displayWindow.webContents.send('display:update', {
        type: 'blank',
        visible: !blank,
      });
    }

    return { ok: true };
  });

  // Display state
  ipcMain.handle('display:state', () => {
    return getDb().getDisplayState();
  });

  // Sessions
  ipcMain.handle('session:create', (_event, name) => {
    return getDb().createSession(name);
  });

  ipcMain.handle('session:active', () => {
    return getDb().getActiveSession();
  });

  ipcMain.handle('session:list', () => {
    return getDb().listSessions();
  });

  ipcMain.handle('session:verses', (_event, sessionId) => {
    return getDb().getSessionVerses(sessionId);
  });

  // Translations
  ipcMain.handle('translations:list', () => {
    return getDb().listTranslations();
  });

  // Settings
  ipcMain.handle('settings:get', () => {
    return getDb().getAllSettings();
  });

  ipcMain.handle('settings:save', (_event, { key, value }) => {
    getDb().setSetting(key, value);
    return { ok: true };
  });

  // List available downloadable translations
  ipcMain.handle('translations:available', () => {
    return [
      { abbr: 'kjv',     name: 'King James Version (1611)',         language: 'English',    free: true },
      { abbr: 'asv',     name: 'American Standard Version (1901)',  language: 'English',    free: true },
      { abbr: 'web',     name: 'World English Bible',               language: 'English',    free: true },
      { abbr: 'ylt',     name: "Young's Literal Translation (1898)", language: 'English',   free: true },
      { abbr: 'bbe',     name: 'Bible in Basic English',            language: 'English',    free: true },
      { abbr: 'dby',     name: 'Darby Translation (1890)',          language: 'English',    free: true },
      { abbr: 'wbs',     name: 'Webster Bible (1833)',              language: 'English',    free: true },
      { abbr: 'hnv',     name: 'Hebrew Names Version',              language: 'English',    free: true },
      { abbr: 'oeb',     name: 'Open English Bible',                language: 'English',    free: true },
      { abbr: 'afr',     name: 'Afrikaans Bible (1953)',            language: 'Afrikaans',  free: true },
      { abbr: 'rvr60',   name: 'Reina-Valera (1960)',               language: 'Spanish',    free: true },
      { abbr: 'ls1910',  name: 'Louis Segond (1910)',               language: 'French',     free: true },
      { abbr: 'lut',     name: 'Luther Bibel (1912)',               language: 'German',     free: true },
      { abbr: 'almeida', name: 'Almeida Revista e Corrigida',       language: 'Portuguese', free: true },
    ];
  });

  // Download a single translation from getbible.net
  ipcMain.handle('translations:download', async (_event, abbr) => {
    const https = require('https');

    function httpGet(url) {
      return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'BibleCast/1.0' } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return httpGet(res.headers.location).then(resolve).catch(reject);
          }
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          let data = '';
          res.setEncoding('utf-8');
          res.on('data', c => { data += c; });
          res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timed out')); });
      });
    }

    function convertGetbible(raw) {
      const verses = [];
      for (const [, bookData] of Object.entries(raw)) {
        const bookName = bookData.name;
        for (const [chapterNum, chapterData] of Object.entries(bookData.chapters)) {
          for (const [, verseData] of Object.entries(chapterData)) {
            const text = (verseData.text || '').trim().replace(/\s+/g, ' ');
            if (text) verses.push({
              book: bookName,
              chapter: parseInt(chapterNum),
              verse: parseInt(verseData.verse),
              text,
            });
          }
        }
      }
      return verses;
    }

    try {
      const raw = await httpGet(`https://api.getbible.net/v2/${abbr.toLowerCase()}.json`);
      const data = JSON.parse(raw);
      const verses = convertGetbible(data);

      if (!verses.length) return { ok: false, error: 'No verses found for this translation.' };

      const NAMES = {
        kjv: 'King James Version', asv: 'American Standard Version',
        web: 'World English Bible', ylt: "Young's Literal Translation",
        bbe: 'Bible in Basic English', dby: 'Darby Translation',
        wbs: 'Webster Bible', hnv: 'Hebrew Names Version',
        oeb: 'Open English Bible', afr: 'Afrikaans Bible (1953)',
        rvr60: 'Reina-Valera (1960)', ls1910: 'Louis Segond (1910)',
        lut: 'Luther Bibel (1912)', almeida: 'Almeida Revista e Corrigida',
      };

      const LANG = {
        afr: 'Afrikaans', rvr60: 'Spanish', ls1910: 'French',
        lut: 'German', almeida: 'Portuguese',
      };

      const name = NAMES[abbr.toLowerCase()] || abbr.toUpperCase() + ' Bible';
      const language = LANG[abbr.toLowerCase()] || 'English';

      getDb().addTranslation({ name, abbreviation: abbr.toUpperCase(), language, data: verses });
      return { ok: true, count: verses.length, name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Seed sample KJV
  ipcMain.handle('translations:seed-sample', () => {
    try {
      const verses = require('./data/sample-kjv.js');
      getDb().addTranslation({
        name: 'King James Version (Sample)',
        abbreviation: 'KJV',
        language: 'English',
        data: verses,
      });
      return { ok: true, count: verses.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Import full translation from a JSON file (opens file picker dialog)
  ipcMain.handle('translations:import-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(operatorWindow, {
      title: 'Import Bible Translation',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (canceled || !filePaths.length) return { ok: false, canceled: true };

    try {
      const raw = fs.readFileSync(filePaths[0], 'utf-8');
      const verses = JSON.parse(raw);

      if (!Array.isArray(verses) || !verses.length) {
        return { ok: false, error: 'File must contain a non-empty array of verse objects.' };
      }
      const sample = verses[0];
      if (!sample.book || sample.chapter == null || sample.verse == null || !sample.text) {
        return { ok: false, error: 'Each verse must have: book, chapter, verse, text' };
      }

      // Use filename as abbreviation (e.g. "NIV.json" → "NIV")
      const basename = require('path').basename(filePaths[0], '.json').toUpperCase().slice(0, 8);
      const name = basename + ' Bible';

      getDb().addTranslation({ name, abbreviation: basename, language: 'English', data: verses });
      return { ok: true, count: verses.length, abbreviation: basename, name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}
