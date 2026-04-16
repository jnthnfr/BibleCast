const { app, BrowserWindow, ipcMain, screen, dialog, session, protocol, net } = require('electron');
const fs   = require('fs');
const path = require('path');

// ── XML Bible parser (no external deps) ──────────────────────────────────────
// Supports:
//   Holy Bible XML  — <XMLBIBLE><BIBLEBOOK bname="…"><CHAPTER cnumber="…"><VERS vnumber="…">
//   OSIS            — <verse osisID="Gen.1.1">…</verse>  (book embedded in ID)
//   Zefania         — <BIBLEBOOK><CHAPTER><VERS vnumber="…">
function parseXmlBible(xmlStr) {
  const decode = s => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/<[^>]+>/g, '').trim();

  const verses = [];

  // ── Format 1: XMLBIBLE / BIBLEBOOK / CHAPTER / VERS ──────────────────────
  if (/<BIBLEBOOK/i.test(xmlStr)) {
    const bookRe    = /<BIBLEBOOK[^>]+bname="([^"]+)"[^>]*>([\s\S]*?)<\/BIBLEBOOK>/gi;
    let bookMatch;
    while ((bookMatch = bookRe.exec(xmlStr)) !== null) {
      const bookName = bookMatch[1];
      const bookBody = bookMatch[2];

      const chapRe = /<CHAPTER[^>]+cnumber="(\d+)"[^>]*>([\s\S]*?)<\/CHAPTER>/gi;
      let chapMatch;
      while ((chapMatch = chapRe.exec(bookBody)) !== null) {
        const chapNum  = parseInt(chapMatch[1], 10);
        const chapBody = chapMatch[2];

        const verseRe = /<VERS[^>]+vnumber="(\d+)"[^>]*>([\s\S]*?)<\/VERS>/gi;
        let vMatch;
        while ((vMatch = verseRe.exec(chapBody)) !== null) {
          const text = decode(vMatch[2]);
          if (text) verses.push({ book: bookName, chapter: chapNum, verse: parseInt(vMatch[1], 10), text });
        }
      }
    }
    return verses;
  }

  // ── Format 2: OSIS — <verse osisID="Gen.1.1"> ────────────────────────────
  if (/osisID/i.test(xmlStr)) {
    const OSIS_BOOKS = {
      Gen:'Genesis', Exod:'Exodus', Lev:'Leviticus', Num:'Numbers', Deut:'Deuteronomy',
      Josh:'Joshua', Judg:'Judges', Ruth:'Ruth', '1Sam':'1 Samuel', '2Sam':'2 Samuel',
      '1Kgs':'1 Kings', '2Kgs':'2 Kings', '1Chr':'1 Chronicles', '2Chr':'2 Chronicles',
      Ezra:'Ezra', Neh:'Nehemiah', Esth:'Esther', Job:'Job', Ps:'Psalms',
      Prov:'Proverbs', Eccl:'Ecclesiastes', Song:'Song of Solomon', Isa:'Isaiah',
      Jer:'Jeremiah', Lam:'Lamentations', Ezek:'Ezekiel', Dan:'Daniel', Hos:'Hosea',
      Joel:'Joel', Amos:'Amos', Obad:'Obadiah', Jonah:'Jonah', Mic:'Micah',
      Nah:'Nahum', Hab:'Habakkuk', Zeph:'Zephaniah', Hag:'Haggai', Zech:'Zechariah',
      Mal:'Malachi', Matt:'Matthew', Mark:'Mark', Luke:'Luke', John:'John',
      Acts:'Acts', Rom:'Romans', '1Cor':'1 Corinthians', '2Cor':'2 Corinthians',
      Gal:'Galatians', Eph:'Ephesians', Phil:'Philippians', Col:'Colossians',
      '1Thess':'1 Thessalonians', '2Thess':'2 Thessalonians', '1Tim':'1 Timothy',
      '2Tim':'2 Timothy', Titus:'Titus', Phlm:'Philemon', Heb:'Hebrews',
      Jas:'James', '1Pet':'1 Peter', '2Pet':'2 Peter', '1John':'1 John',
      '2John':'2 John', '3John':'3 John', Jude:'Jude', Rev:'Revelation',
    };
    const verseRe = /<verse[^>]+osisID="([A-Za-z0-9]+)\.(\d+)\.(\d+)"[^>]*>([\s\S]*?)<\/verse>/gi;
    let vMatch;
    while ((vMatch = verseRe.exec(xmlStr)) !== null) {
      const bookAbbr = vMatch[1];
      const bookName = OSIS_BOOKS[bookAbbr] || bookAbbr;
      const text     = decode(vMatch[4]);
      if (text) verses.push({ book: bookName, chapter: parseInt(vMatch[2], 10), verse: parseInt(vMatch[3], 10), text });
    }
    return verses;
  }

  // ── Format 3: Generic <b>/<c>/<v> or similar fallback ─────────────────────
  // Try common tag combos: <book name="…"><chapter n="…"><verse n="…">
  const bookRe2 = /<(?:book|b)[^>]+(?:name|title)="([^"]+)"[^>]*>([\s\S]*?)<\/(?:book|b)>/gi;
  let bm;
  while ((bm = bookRe2.exec(xmlStr)) !== null) {
    const bookName = bm[1];
    const chapRe2  = /<(?:chapter|c)[^>]+(?:n|number|num)="(\d+)"[^>]*>([\s\S]*?)<\/(?:chapter|c)>/gi;
    let cm;
    while ((cm = chapRe2.exec(bm[2])) !== null) {
      const chapNum = parseInt(cm[1], 10);
      const verseRe2 = /<(?:verse|v)[^>]+(?:n|number|num)="(\d+)"[^>]*>([\s\S]*?)<\/(?:verse|v)>/gi;
      let vm;
      while ((vm = verseRe2.exec(cm[2])) !== null) {
        const text = decode(vm[2]);
        if (text) verses.push({ book: bookName, chapter: chapNum, verse: parseInt(vm[1], 10), text });
      }
    }
  }

  return verses;
}

let operatorWindow    = null;
let displayWindow     = null;
let ndiWindow         = null;
let gpuWorkerWindow   = null;
let scraperWindow     = null;
let pendingGpuResolve = null;
let activeScrapeProc  = null;
let db = null;

function getDb() {
  if (!db) {
    try {
      db = require('./src/lib/db');
    } catch (err) {
      dialog.showErrorBox(
        'BibleCast — Database Error',
        'The database module failed to load. Please run:\n\n  npm run rebuild\n\nThen restart the app.\n\nDetail: ' + err.message
      );
      app.quit();
      throw err;
    }
  }
  return db;
}

// --- Window creation ---

function createOperatorWindow() {
  operatorWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1100,
    minHeight: 680,
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

  operatorWindow.on('closed', () => { operatorWindow = null; });
}

function createDisplayWindow() {
  const displays    = screen.getAllDisplays();
  const targetDisplay = displays.length > 1
    ? displays.find(d => d.id !== screen.getPrimaryDisplay().id) || displays[0]
    : displays[0];

  const { x, y, width, height } = targetDisplay.bounds;

  displayWindow = new BrowserWindow({
    x, y, width, height,
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
    // Notify the operator panel so it can update its displayWindowOpen flag
    if (operatorWindow && !operatorWindow.isDestroyed()) {
      operatorWindow.webContents.send('display:window-closed');
    }
  });
}

function createNdiWindow() {
  // NDI virtual output — a second borderless window on the primary monitor,
  // screen-capturable by OBS / vMix as a virtual NDI source.
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;
  const winW = Math.round(width  * 0.4);
  const winH = Math.round(winW   * 9 / 16);
  const winX = primary.bounds.x + Math.round((width  - winW) / 2);
  const winY = primary.bounds.y + Math.round((height - winH) / 2);

  ndiWindow = new BrowserWindow({
    x: winX, y: winY, width: winW, height: winH,
    frame: false,
    alwaysOnTop: true,
    title: 'BibleCast — NDI Output',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ndiWindow.loadFile('src/display/display.html');
  ndiWindow.on('closed', () => { ndiWindow = null; });
}

function createGpuWorkerWindow() {
  gpuWorkerWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  gpuWorkerWindow.loadFile('src/whisper/whisper-gpu.html');
  gpuWorkerWindow.on('closed', () => { gpuWorkerWindow = null; });
}

function createScraperWindow() {
  scraperWindow = new BrowserWindow({
    width: 700,
    height: 620,
    minWidth: 600,
    minHeight: 500,
    title: 'Bible Gateway Translations',
    parent: operatorWindow || undefined,
    modal: false,
    resizable: true,
    backgroundColor: '#1a1d23',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  scraperWindow.setMenuBarVisibility(false);
  scraperWindow.loadFile('src/scraper/scraper.html');
  scraperWindow.on('closed', () => { scraperWindow = null; });
}

// --- App lifecycle ---

// Register app-asset:// protocol so the renderer can load bundled files (e.g. Vosk model)
// Must be called before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

app.whenReady().then(() => {
  // Serve bundled assets via app-asset:// — maps app-asset://vosk/... to assets/vosk/... (dev)
  // or process.resourcesPath/vosk/... (packaged)
  protocol.handle('app-asset', (request) => {
    const url = new URL(request.url);
    const relativePath = url.hostname + url.pathname;
    const basePath = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'assets');
    const filePath = path.join(basePath, relativePath).replace(/\\/g, '/');
    return net.fetch('file:///' + filePath);
  });

  // Allow microphone / speech access for Web Speech API
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'microphone', 'speech'].includes(permission));
  });
  // Pre-approve background permission checks (Web Speech API checks silently on every use)
  session.defaultSession.setPermissionCheckHandler((_wc, _permission, _origin, _details) => true);

  // CSP: allow vosk-browser blob Workers and local app-asset:// model
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
          "worker-src blob: data:; " +
          "style-src 'self' 'unsafe-inline'; " +
          "connect-src 'self' blob: data: https://*.githubusercontent.com; " +
          "media-src 'self' blob:; " +
          "img-src 'self' data: blob: file: https:; " +
          "font-src 'self' data:"
        ],
      },
    });
  });

  createOperatorWindow();
  // Display window is NOT created on launch — toggled via Outputs tab
  registerIpcHandlers();
  checkFirstRun();

  app.on('activate', () => {
    if (!operatorWindow) createOperatorWindow();
  });
});

// Closing the operator window tears down all output windows and quits
app.on('window-all-closed', () => {
  if (displayWindow)   { displayWindow.destroy();   displayWindow  = null; }
  if (ndiWindow)       { ndiWindow.destroy();        ndiWindow      = null; }
  if (gpuWorkerWindow) { gpuWorkerWindow.destroy();  gpuWorkerWindow = null; }
  getDb().closeDb();
  app.quit();
});

// Force-exit after a short grace period so ONNX/worker threads don't keep the process alive
app.on('before-quit', () => {
  setTimeout(() => process.exit(0), 300);
});

// --- First-run: silently seed KJV from bundled file ---

function checkFirstRun() {
  setTimeout(() => {
    const db = getDb();
    const count = db.getDb().prepare('SELECT COUNT(*) as c FROM translations').get();
    if (count.c > 0) return; // already have data

    const kjvPath = path.join(__dirname, 'data', 'translations', 'kjv.json');
    if (fs.existsSync(kjvPath)) {
      try {
        const verses = JSON.parse(fs.readFileSync(kjvPath, 'utf-8'));
        db.addTranslation({
          name: 'King James Version',
          abbreviation: 'KJV',
          language: 'English',
          data: verses,
        });
        console.log(`[BibleCast] Auto-seeded KJV — ${verses.length} verses`);
        if (operatorWindow) operatorWindow.webContents.send('translations:ready');
      } catch (err) {
        console.error('[BibleCast] KJV auto-seed failed:', err.message);
        // Fall back to showing download prompt
        showNoTranslationsDialog();
      }
    } else {
      showNoTranslationsDialog();
    }
  }, 800);
}

function showNoTranslationsDialog() {
  if (!operatorWindow) return;
  dialog.showMessageBox(operatorWindow, {
    type: 'info',
    title: 'Welcome to BibleCast',
    message: 'No Bible translations installed yet.',
    detail: 'Open Settings → Bibles to download free translations (KJV, ASV, WEB, and more), or run "npm run bundle:kjv" to bundle KJV offline.',
    buttons: ['Open Settings', 'Later'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0 && operatorWindow) {
      operatorWindow.webContents.send('nav:settings');
    }
  });
}

// --- IPC Handlers ---

function registerIpcHandlers() {

  // Verse search — normalise the query through bible-parser before hitting the DB
  const { parseReference } = require('./src/lib/bible-parser');
  ipcMain.handle('verse:search', (_event, { query, translation }) => {
    // Try to parse a structured reference first (e.g. "1 Cor 13:4" or "john 3 16")
    const parsed = parseReference(query);
    const normalisedQuery = parsed ? parsed.formatted : query;
    return getDb().searchVerses({ query: normalisedQuery, translation });
  });

  // Push a verse to the display window
  ipcMain.handle('verse:push', (_event, verse) => {
    const state = {
      current_reference: verse.reference,
      current_text:      verse.text,
      is_visible:        1,
      translation:       verse.translation || 'KJV',
    };
    getDb().updateDisplayState(state);

    const verseMsg = {
      type:        'verse',
      reference:   verse.reference,
      text:        verse.text,
      translation: verse.translation || 'KJV',
      visible:     true,
    };
    if (displayWindow) displayWindow.webContents.send('display:update', verseMsg);
    if (ndiWindow)     ndiWindow.webContents.send('display:update', verseMsg);

    // Log to active session
    const sess = getDb().getActiveSession();
    if (sess) {
      getDb().logDisplayedVerse({
        sessionId:  sess.id,
        reference:  verse.reference,
        book:       verse.book,
        chapter:    verse.chapter,
        verse:      verse.verse,
        text:       verse.text,
        translation: verse.translation || 'KJV',
      });
    }

    return { ok: true };
  });

  // Blank / unblank display
  ipcMain.handle('display:blank', (_event, blank) => {
    getDb().updateDisplayState({ is_visible: blank ? 0 : 1 });

    const blankMsg = { type: 'blank', visible: !blank };
    if (displayWindow) displayWindow.webContents.send('display:update', blankMsg);
    if (ndiWindow)     ndiWindow.webContents.send('display:update', blankMsg);

    return { ok: true };
  });

  // Display state
  ipcMain.handle('display:state', () => getDb().getDisplayState());

  // Sessions
  ipcMain.handle('session:create', (_event, name) => getDb().createSession(name));
  ipcMain.handle('session:active', ()              => getDb().getActiveSession());
  ipcMain.handle('session:list',   ()              => getDb().listSessions());
  ipcMain.handle('session:verses', (_event, id)   => getDb().getSessionVerses(id));

  // Translations
  ipcMain.handle('translations:list', () => getDb().listTranslations());

  // Settings
  ipcMain.handle('settings:get',  ()                    => getDb().getAllSettings());
  ipcMain.handle('settings:save', (_event, { key, value }) => {
    getDb().setSetting(key, value);

    // Propagate display-affecting settings to display windows immediately
    const displayKeys = [
      'font_size','theme','text_color','transition_speed','show_translation','show_reference',
      'bg_type','bg_color','bg_gradient_start','bg_gradient_end','bg_image_url',
    ];
    if (displayKeys.includes(key)) {
      const s = getDb().getAllSettings();
      const settingsMsg = {
        type:             'settings',
        fontSize:         s.font_size          || '64',
        theme:            s.theme              || 'dark',
        textColor:        s.text_color         || '#ffffff',
        transitionSpeed:  s.transition_speed   || '0.5',
        showTranslation:  s.show_translation   !== 'false',
        showReference:    s.show_reference     !== 'false',
        bgType:           s.bg_type            || 'solid',
        bgColor:          s.bg_color           || '#000000',
        bgGradientStart:  s.bg_gradient_start  || '#0a1628',
        bgGradientEnd:    s.bg_gradient_end    || '#1a3a5c',
        bgImageUrl:       s.bg_image_url       || '',
      };
      if (displayWindow) displayWindow.webContents.send('display:update', settingsMsg);
      if (ndiWindow)     ndiWindow.webContents.send('display:update', settingsMsg);
    }
    return { ok: true };
  });

  // List available downloadable translations
  ipcMain.handle('translations:available', () => [
    { abbr: 'kjv',     name: 'King James Version (1611)',          language: 'English'    },
    { abbr: 'asv',     name: 'American Standard Version (1901)',   language: 'English'    },
    { abbr: 'web',     name: 'World English Bible',                language: 'English'    },
    { abbr: 'ylt',     name: "Young's Literal Translation (1898)", language: 'English'    },
    { abbr: 'bbe',     name: 'Bible in Basic English',             language: 'English'    },
    { abbr: 'dby',     name: 'Darby Translation (1890)',           language: 'English'    },
    { abbr: 'wbs',     name: 'Webster Bible (1833)',               language: 'English'    },
    { abbr: 'hnv',     name: 'Hebrew Names Version',               language: 'English'    },
    { abbr: 'oeb',     name: 'Open English Bible',                 language: 'English'    },
    { abbr: 'afr',     name: 'Afrikaans Bible (1953)',             language: 'Afrikaans'  },
    { abbr: 'rvr60',   name: 'Reina-Valera (1960)',                language: 'Spanish'    },
    { abbr: 'ls1910',  name: 'Louis Segond (1910)',                language: 'French'     },
    { abbr: 'lut',     name: 'Luther Bibel (1912)',                language: 'German'     },
    { abbr: 'almeida', name: 'Almeida Revista e Corrigida',        language: 'Portuguese' },
  ]);

  // Download a translation from getbible.net
  ipcMain.handle('translations:download', async (_event, abbr) => {
    const https = require('https');

    function httpGet(url) {
      return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'BibleCast/1.0' } }, res => {
          if (res.statusCode === 301 || res.statusCode === 302)
            return httpGet(res.headers.location).then(resolve).catch(reject);
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
      const books = Array.isArray(raw.books) ? raw.books : Object.values(raw.books || {});
      for (const bookData of books) {
        const bookName = bookData.name;
        const chapters = Array.isArray(bookData.chapters) ? bookData.chapters : Object.values(bookData.chapters || {});
        for (const chapterData of chapters) {
          const chapterNum = chapterData.chapter;
          const verseList  = Array.isArray(chapterData.verses) ? chapterData.verses : Object.values(chapterData.verses || {});
          for (const verseData of verseList) {
            const text = (verseData.text || '').trim().replace(/\s+/g, ' ');
            if (text) verses.push({
              book:    bookName,
              chapter: parseInt(chapterNum, 10),
              verse:   parseInt(verseData.verse, 10),
              text,
            });
          }
        }
      }
      return verses;
    }

    try {
      const raw    = await httpGet(`https://api.getbible.net/v2/${abbr.toLowerCase()}.json`);
      const data   = JSON.parse(raw);
      const verses = convertGetbible(data);
      if (!verses.length) return { ok: false, error: 'No verses found.' };

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

      const name     = NAMES[abbr.toLowerCase()] || abbr.toUpperCase() + ' Bible';
      const language = LANG[abbr.toLowerCase()]  || 'English';

      getDb().addTranslation({ name, abbreviation: abbr.toUpperCase(), language, data: verses });
      return { ok: true, count: verses.length, name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Seed bundled KJV (manual trigger)
  ipcMain.handle('translations:seed-bundled', () => {
    const kjvPath = path.join(__dirname, 'data', 'translations', 'kjv.json');
    if (!fs.existsSync(kjvPath)) return { ok: false, error: 'Bundled KJV not found. Run: npm run bundle:kjv' };
    try {
      const verses = JSON.parse(fs.readFileSync(kjvPath, 'utf-8'));
      getDb().addTranslation({ name: 'King James Version', abbreviation: 'KJV', language: 'English', data: verses });
      return { ok: true, count: verses.length, name: 'King James Version' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Seed sample KJV (fallback)
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

  // Import translation from JSON or XML file
  ipcMain.handle('translations:import-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(operatorWindow, {
      title: 'Import Bible Translation (JSON or XML)',
      filters: [
        { name: 'Bible Files', extensions: ['json', 'xml'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'XML',  extensions: ['xml'] },
      ],
      properties: ['openFile'],
    });

    if (canceled || !filePaths.length) return { ok: false, canceled: true };

    try {
      const filePath = filePaths[0];
      const ext      = path.extname(filePath).toLowerCase();
      const raw      = fs.readFileSync(filePath, 'utf-8');
      let verses;

      if (ext === '.xml') {
        verses = parseXmlBible(raw);
        if (!verses.length) return { ok: false, error: 'No verses found in XML file. Supported formats: Holy Bible XML (XMLBIBLE/BIBLEBOOK/VERS), OSIS, Zefania.' };
      } else {
        verses = JSON.parse(raw);
        if (!Array.isArray(verses) || !verses.length)
          return { ok: false, error: 'JSON file must contain a non-empty array of verse objects.' };
        const sample = verses[0];
        if (!sample.book || sample.chapter == null || sample.verse == null || !sample.text)
          return { ok: false, error: 'Each verse must have: book, chapter, verse, text' };
      }

      const basename = path.basename(filePath, ext).toUpperCase().slice(0, 10);
      const name     = basename + ' Bible';

      getDb().addTranslation({ name, abbreviation: basename, language: 'English', data: verses });
      return { ok: true, count: verses.length, abbreviation: basename, name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Toggle the display window — create on first call, close on second
  ipcMain.handle('display:open', () => {
    if (displayWindow) {
      displayWindow.destroy();
      displayWindow = null;
      return { ok: false, open: false };
    }
    createDisplayWindow();
    // Once loaded, push current state + settings so it renders immediately
    displayWindow.webContents.once('did-finish-load', () => {
      const state = getDb().getDisplayState();
      const s     = getDb().getAllSettings();
      // Send settings first so theme/font/bg are applied before verse renders
      displayWindow.webContents.send('display:update', {
        type:            'settings',
        fontSize:        state?.font_size       || s.font_size         || '64',
        theme:           state?.theme           || s.theme             || 'dark',
        textColor:       s.text_color           || '#ffffff',
        transitionSpeed: s.transition_speed     || '0.5',
        showTranslation: s.show_translation     !== 'false',
        showReference:   s.show_reference       !== 'false',
        bgType:          s.bg_type              || 'solid',
        bgColor:         s.bg_color             || '#000000',
        bgGradientStart: s.bg_gradient_start    || '#0a1628',
        bgGradientEnd:   s.bg_gradient_end      || '#1a3a5c',
        bgImageUrl:      s.bg_image_url         || '',
      });
      // Apply saved layout
      if (s.hdmi_layout) {
        displayWindow.webContents.send('display:update', { type: 'layout', layout: s.hdmi_layout });
      }
      // If there's a verse currently on display, push it
      if (state?.current_text && state.is_visible) {
        displayWindow.webContents.send('display:update', {
          type:        'verse',
          reference:   state.current_reference,
          text:        state.current_text,
          translation: state.translation || 'KJV',
          visible:     true,
        });
      }
    });
    return { ok: true, open: true };
  });

  // List connected monitors
  ipcMain.handle('display:list-monitors', () => {
    return screen.getAllDisplays().map((d, i) => ({
      id:      d.id,
      label:   `Display ${i + 1}${d.id === screen.getPrimaryDisplay().id ? ' — Primary' : ''}`,
      primary: d.id === screen.getPrimaryDisplay().id,
      bounds:  d.bounds,
    }));
  });

  // Move display window to a specific monitor
  ipcMain.handle('display:set-monitor', (_event, { displayId }) => {
    if (!displayWindow) return { ok: false };
    const displays = screen.getAllDisplays();
    const target   = displays.find(d => d.id === displayId) || displays[0];
    const { x, y, width, height } = target.bounds;
    displayWindow.setBounds({ x, y, width, height });
    if (displays.length > 1) displayWindow.setFullScreen(true);
    return { ok: true };
  });

  // Open / close NDI virtual output window
  ipcMain.handle('display:open-ndi', (_event, open) => {
    if (open) {
      if (!ndiWindow) {
        createNdiWindow();
        ndiWindow.webContents.once('did-finish-load', () => {
          const state = getDb().getDisplayState();
          const s     = getDb().getAllSettings();
          ndiWindow.webContents.send('display:update', {
            type:            'settings',
            fontSize:        state?.font_size       || s.font_size         || '64',
            theme:           state?.theme           || s.theme             || 'dark',
            textColor:       s.text_color           || '#ffffff',
            transitionSpeed: s.transition_speed     || '0.5',
            showTranslation: s.show_translation     !== 'false',
            showReference:   s.show_reference       !== 'false',
            bgType:          s.bg_type              || 'solid',
            bgColor:         s.bg_color             || '#000000',
            bgGradientStart: s.bg_gradient_start    || '#0a1628',
            bgGradientEnd:   s.bg_gradient_end      || '#1a3a5c',
            bgImageUrl:      s.bg_image_url         || '',
          });
          if (s.ndi_layout) {
            ndiWindow.webContents.send('display:update', { type: 'layout', layout: s.ndi_layout });
          }
          if (state?.current_text && state.is_visible) {
            ndiWindow.webContents.send('display:update', {
              type:        'verse',
              reference:   state.current_reference,
              text:        state.current_text,
              translation: state.translation || 'KJV',
              visible:     true,
            });
          }
        });
      }
    } else {
      if (ndiWindow) { ndiWindow.destroy(); ndiWindow = null; }
    }
    return { ok: true };
  });

  // Set layout (fullscreen / lower-third) for HDMI or NDI window
  ipcMain.handle('display:layout', (_event, { target, layout }) => {
    const msg = { type: 'layout', layout };
    if (target === 'hdmi' && displayWindow) displayWindow.webContents.send('display:update', msg);
    if (target === 'ndi'  && ndiWindow)     ndiWindow.webContents.send('display:update', msg);
    getDb().setSetting(target === 'ndi' ? 'ndi_layout' : 'hdmi_layout', layout);
    return { ok: true };
  });

  // Copy a background image file to the app userData backgrounds folder
  ipcMain.handle('background:save-image', async (_event, srcPath) => {
    try {
      const bgDir  = path.join(app.getPath('userData'), 'backgrounds');
      fs.mkdirSync(bgDir, { recursive: true });
      const dest   = path.join(bgDir, path.basename(srcPath));
      fs.copyFileSync(srcPath, dest);
      const fileUrl = 'file:///' + dest.replace(/\\/g, '/');
      return { ok: true, filePath: fileUrl };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Whisper AI (local, via @xenova/transformers) ─────────────────────────────
  let whisperPipeline = null;
  let whisperLoading  = false;

  async function getWhisperPipeline(modelId, progressCb) {
    if (whisperPipeline) return whisperPipeline;
    if (whisperLoading)  throw new Error('Model is already loading');
    whisperLoading = true;
    try {
      // @xenova/transformers is ESM-only — use dynamic import() from CommonJS
      const { pipeline, env } = await import('@xenova/transformers');
      // Cache models next to app userData so they survive app restarts
      env.cacheDir = path.join(app.getPath('userData'), 'whisper-models');

      // Apply CPU thread count from settings
      const os = require('os');
      const threadsSetting = getDb().getSetting('whisper_threads') || 'auto';
      env.backends.onnx.wasm.numThreads =
        threadsSetting === 'auto'
          ? Math.max(2, Math.floor(os.cpus().length / 2))
          : parseInt(threadsSetting, 10);

      whisperPipeline = await pipeline('automatic-speech-recognition', modelId || 'Xenova/whisper-base.en', {
        progress_callback: progress => progressCb && progressCb(progress),
      });
      return whisperPipeline;
    } finally {
      whisperLoading = false;
    }
  }

  // GPU worker IPC — results/progress forwarded from the hidden GPU window
  ipcMain.on('whisper:gpu:result', (_e, result) => {
    if (pendingGpuResolve) { pendingGpuResolve(result); pendingGpuResolve = null; }
  });
  ipcMain.on('whisper:gpu:progress', (_e, p) => {
    operatorWindow?.webContents.send('whisper:progress', p);
  });

  // Open/close GPU worker window
  ipcMain.handle('whisper:set-gpu', (_e, enable) => {
    if (enable && !gpuWorkerWindow) createGpuWorkerWindow();
    if (!enable && gpuWorkerWindow) { gpuWorkerWindow.destroy(); gpuWorkerWindow = null; }
    return { ok: true };
  });

  ipcMain.handle('whisper:transcribe', async (_event, { audioArray, modelId }) => {
    // Route to GPU worker window when GPU acceleration is enabled
    const useGpu = getDb().getSetting('whisper_gpu') === 'true';
    if (useGpu && gpuWorkerWindow) {
      const cacheDir = path.join(app.getPath('userData'), 'whisper-models');
      return new Promise(resolve => {
        pendingGpuResolve = resolve;
        gpuWorkerWindow.webContents.send('whisper:gpu:transcribe', { audioArray, modelId, cacheDir });
        setTimeout(() => {
          if (pendingGpuResolve) {
            pendingGpuResolve({ ok: false, error: 'GPU timeout — falling back to CPU' });
            pendingGpuResolve = null;
          }
        }, 30000);
      });
    }

    // CPU path
    try {
      const pipe    = await getWhisperPipeline(modelId, progress => {
        operatorWindow?.webContents.send('whisper:progress', progress);
      });
      const float32 = new Float32Array(audioArray);
      const result  = await pipe(float32, { language: 'english', task: 'transcribe' });
      return { ok: true, text: result.text || '' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Reset the cached pipeline (called when user changes model size or thread count)
  ipcMain.handle('whisper:reset', () => {
    whisperPipeline = null;
    if (gpuWorkerWindow) gpuWorkerWindow.webContents.send('whisper:gpu:reset');
    return { ok: true };
  });

  // Hardware info for the Settings AI Performance section
  ipcMain.handle('system:hardware-info', async () => {
    const os   = require('os');
    const cpus = os.cpus();
    const gpuInfo = await app.getGPUInfo('basic').catch(() => ({}));
    const gpuName = gpuInfo?.gpuDevice?.[0]?.deviceString || 'Unknown GPU';
    return {
      cpuModel: cpus[0]?.model || 'Unknown CPU',
      cpuCores: cpus.length,
      gpuName,
    };
  });

  // ── AI Sermon Summary (OpenAI GPT) ───────────────────────────────────────────
  ipcMain.handle('ai:summarize', async (_event, { transcript, apiKey }) => {
    if (!apiKey || !transcript || transcript.trim().split(/\s+/).length < 30)
      return { ok: false, error: 'insufficient_data' };

    const https = require('https');
    const body  = JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant for church sermon operators. Summarize the following sermon excerpt in 3–5 concise sentences, focusing on the main theological themes, key scripture references, and central message.',
        },
        { role: 'user', content: transcript.slice(-4000) },
      ],
      max_tokens: 200,
      temperature: 0.4,
    });

    function postJson(url, data, headers) {
      return new Promise((resolve, reject) => {
        const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } };
        const req = https.request(url, options, res => {
          let raw = '';
          res.on('data', c => { raw += c; });
          res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,200)}`));
            resolve(raw);
          });
        });
        req.on('error', reject);
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timed out')); });
        req.write(data);
        req.end();
      });
    }

    try {
      const raw      = await postJson('https://api.openai.com/v1/chat/completions', body, { Authorization: `Bearer ${apiKey}` });
      const parsed   = JSON.parse(raw);
      const summary  = parsed.choices?.[0]?.message?.content?.trim();
      if (!summary) return { ok: false, error: 'No summary returned' };
      return { ok: true, summary };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Update checker ───────────────────────────────────────────────────────────
  const GITHUB_OWNER = 'jnthnfr';
  const GITHUB_REPO  = 'BibleCast';

  ipcMain.handle('updates:check', async () => {
    const https = require('https');
    function httpGetUpdate(url) {
      return new Promise((resolve, reject) => {
        const req = https.get(url, {
          headers: { 'User-Agent': `BibleCast/${app.getVersion()}`, Accept: 'application/vnd.github+json' }
        }, res => {
          if (res.statusCode === 301 || res.statusCode === 302)
            return httpGetUpdate(res.headers.location).then(resolve).catch(reject);
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          let data = '';
          res.setEncoding('utf-8');
          res.on('data', c => { data += c; });
          res.on('end',  () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timed out')); });
      });
    }

    function semverGt(a, b) {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return true;
        if ((pa[i] || 0) < (pb[i] || 0)) return false;
      }
      return false;
    }

    try {
      const raw     = await httpGetUpdate(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
      const release = JSON.parse(raw);
      const latest  = (release.tag_name || '').replace(/^v/, '');
      const current = app.getVersion();
      const updateAvailable = !!latest && semverGt(latest, current);
      const exeAsset = (release.assets || []).find(a => a.name.endsWith('.exe'));
      return {
        ok: true,
        updateAvailable,
        currentVersion:  current,
        latestVersion:   latest,
        releaseUrl:      release.html_url || '',
        downloadUrl:     exeAsset?.browser_download_url || release.html_url || '',
        releaseName:     release.name || `v${latest}`,
        publishedAt:     release.published_at || '',
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Vosk model ───────────────────────────────────────────────────────────────
  ipcMain.handle('vosk:read-model', () => {
    const modelPath = app.isPackaged
      ? path.join(process.resourcesPath, 'vosk', 'vosk-model-small-en-us-0.15.tar.gz')
      : path.join(__dirname, 'assets', 'vosk', 'vosk-model-small-en-us-0.15.tar.gz');
    return fs.readFileSync(modelPath); // returned as Buffer → Uint8Array in renderer
  });

  ipcMain.handle('updates:open-release', (_event, url) => {
    const { shell } = require('electron');
    shell.openExternal(url);
    return { ok: true };
  });

  // Next / previous verse navigation (for voice commands)
  // ── Bible Gateway Scraper ────────────────────────────────────────────────────

  // Open / focus the scraper popup window
  ipcMain.handle('scraper:open', () => {
    if (scraperWindow && !scraperWindow.isDestroyed()) {
      scraperWindow.focus();
    } else {
      createScraperWindow();
    }
    return { ok: true };
  });

  // Detect Python installation and return version + executable path
  ipcMain.handle('scraper:check-python', async () => {
    const { execFile } = require('child_process');

    function tryPython(cmd) {
      return new Promise(resolve => {
        execFile(cmd, ['--version'], { timeout: 5000 }, (err, stdout, stderr) => {
          const out = (stdout + stderr).trim();
          if (!err && /^Python\s+3\./i.test(out)) {
            resolve({ ok: true, version: out, path: cmd });
          } else {
            resolve({ ok: false });
          }
        });
      });
    }

    // Try python3 first (preferred on most systems), then plain python
    const r3 = await tryPython('python3');
    if (r3.ok) return r3;
    const r = await tryPython('python');
    if (r.ok) return r;
    return { ok: false, error: 'Python 3 not found. Install from python.org and ensure it is on PATH.' };
  });

  // Start scraping a queue of translations sequentially
  ipcMain.handle('scraper:start', async (_event, { abbrs, pythonPath: pyPath }) => {
    if (!abbrs || !abbrs.length) return { ok: false, error: 'No translations specified' };

    const { spawn } = require('child_process');

    // Resolve the bundled Python scraper script
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'scripts', 'scrape_bible.py')
      : path.join(__dirname, 'scripts', 'scrape_bible.py');

    const TRANSLATION_NAMES = {
      AMP: 'Amplified Bible', AKJV: 'American King James Version',
      ASV: 'American Standard Version (1901)', BRG: 'Berean Reference Bible',
      CSB: 'Christian Standard Bible', EHV: 'Evangelical Heritage Version',
      ESV: 'English Standard Version', ESVUK: 'English Standard Version (UK)',
      GNV: 'Geneva Bible (1599)', GW: "God's Word Translation",
      ISV: 'International Standard Version', JUB: 'Jubilee Bible 2000',
      KJV: 'King James Version', KJ21: 'King James Version 21st Century',
      LEB: 'Lexham English Bible', MEV: 'Modern English Version',
      NASB: 'New American Standard Bible (2020)', NASB1995: 'New American Standard Bible (1995)',
      NET: 'New English Translation', NIV: 'New International Version',
      NIVUK: 'New International Version (UK)', NKJV: 'New King James Version',
      NLT: 'New Living Translation', NLV: 'New Life Version',
      NOG: 'Names of God Bible', NRSV: 'New Revised Standard Version',
      NRSVUE: 'NRSV Updated Edition', WEB: 'World English Bible',
      YLT: "Young's Literal Translation",
    };

    async function scrapeOne(abbr) {
      return new Promise(resolve => {
        const proc = spawn(pyPath, [scriptPath, abbr], { stdio: ['ignore', 'pipe', 'ignore'] });
        activeScrapeProc = proc;

        let buffer      = '';
        let finalVerses = null;

        proc.stdout.on('data', chunk => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete last line

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed);

              // Forward every progress event to the scraper window
              if (scraperWindow && !scraperWindow.isDestroyed()) {
                scraperWindow.webContents.send('scraper:progress', { abbr, ...msg });
              }

              if (msg.type === 'done') finalVerses = msg.verses;
            } catch (_) { /* non-JSON line — ignore */ }
          }
        });

        proc.on('close', code => {
          activeScrapeProc = null;
          resolve({ ok: code === 0 && finalVerses != null, verses: finalVerses });
        });

        proc.on('error', err => {
          activeScrapeProc = null;
          resolve({ ok: false, error: err.message });
        });
      });
    }

    // Process queue sequentially in the background (non-blocking IPC return)
    setImmediate(async () => {
      for (const abbr of abbrs) {
        if (scraperWindow && !scraperWindow.isDestroyed()) {
          scraperWindow.webContents.send('scraper:progress', { abbr, type: 'starting' });
        }

        const result = await scrapeOne(abbr);

        if (result.ok && result.verses && result.verses.length > 0) {
          const name = TRANSLATION_NAMES[abbr.toUpperCase()] || abbr.toUpperCase() + ' Bible';
          try {
            getDb().addTranslation({
              name,
              abbreviation: abbr.toUpperCase(),
              language: 'English',
              data: result.verses,
            });
            if (scraperWindow && !scraperWindow.isDestroyed()) {
              scraperWindow.webContents.send('scraper:progress', {
                abbr, type: 'imported', count: result.verses.length, name,
              });
            }
            // Notify the operator panel so the translation dropdown refreshes
            if (operatorWindow && !operatorWindow.isDestroyed()) {
              operatorWindow.webContents.send('translations:ready');
            }
          } catch (err) {
            if (scraperWindow && !scraperWindow.isDestroyed()) {
              scraperWindow.webContents.send('scraper:progress', {
                abbr, type: 'error', msg: 'DB import failed: ' + err.message,
              });
            }
          }
        } else if (!result.ok) {
          if (scraperWindow && !scraperWindow.isDestroyed()) {
            scraperWindow.webContents.send('scraper:progress', {
              abbr, type: 'error', msg: result.error || 'Scrape failed or returned 0 verses',
            });
          }
        }
      }

      // Signal that the full queue is done
      if (scraperWindow && !scraperWindow.isDestroyed()) {
        scraperWindow.webContents.send('scraper:progress', { type: 'queue-done' });
      }
    });

    return { ok: true };
  });

  // Kill the active Python scrape process
  ipcMain.handle('scraper:cancel', () => {
    if (activeScrapeProc) {
      try { activeScrapeProc.kill(); } catch (_) {}
      activeScrapeProc = null;
    }
    return { ok: true };
  });

  ipcMain.handle('verse:navigate', async (_event, { direction }) => {
    const state = getDb().getDisplayState();
    if (!state || !state.current_reference) return { ok: false };

    const translation = state.translation || 'KJV';
    const trans = getDb().getDb().prepare('SELECT data FROM translations WHERE abbreviation = ?').get(translation);
    if (!trans) return { ok: false };

    const verses = JSON.parse(trans.data);
    const idx = verses.findIndex(v =>
      `${v.book} ${v.chapter}:${v.verse}` === state.current_reference
    );
    if (idx < 0) return { ok: false };

    const next = direction === 'next' ? verses[idx + 1] : verses[idx - 1];
    if (!next) return { ok: false };

    next.reference = `${next.book} ${next.chapter}:${next.verse}`;
    next.translation = translation;
    return { ok: true, verse: next };
  });

  // ── Out-of-Process Chrome Web Speech Bridge ──────────────────────────────────
  const http = require('http');
  const os = require('os');
  let chromeBridgeServer = null;
  let chromeBridgePort = 0;
  let chromeProcess = null;

  function getSystemChromePath() {
    const winPaths = [
      'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
      'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  ipcMain.handle('chrome:start-bridge', async () => {
    if (chromeProcess) return { ok: true, msg: 'Already running' };

    const chromePath = getSystemChromePath();
    if (!chromePath) return { ok: false, error: 'Google Chrome not found on this system.' };

    return new Promise((resolve) => {
      if (!chromeBridgeServer) {
        chromeBridgeServer = http.createServer((req, res) => {
          if (req.method === 'GET' && req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html><html><body><h1>BibleCast Web Speech Bridge</h1>
              <script>
                const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SR) {
                  fetch('/error', { method: 'POST', body: 'No SpeechRecognition in this browser' });
                } else {
                  const r = new SR();
                  r.continuous = true;
                  r.interimResults = true;
                  r.lang = 'en-US';
                  r.onresult = e => {
                    let finalTxt = '', interimTxt = '';
                    for (let i = e.resultIndex; i < e.results.length; ++i) {
                      if (e.results[i].isFinal) finalTxt += e.results[i][0].transcript;
                      else interimTxt += e.results[i][0].transcript;
                    }
                    if (interimTxt || finalTxt) {
                       fetch('/result', {
                         method: 'POST',
                         headers: {'Content-Type': 'application/json'},
                         body: JSON.stringify({ interim: interimTxt, final: finalTxt })
                       }).catch(()=>{});
                    }
                  };
                  r.onerror = (e) => {
                    fetch('/error', { method: 'POST', body: e.error });
                  };
                  r.onend = () => { r.start(); };
                  r.start();
                }
              </script>
              </body></html>
            `);
          } else if (req.method === 'POST' && req.url === '/result') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                const { webContents } = require('electron');
                webContents.getAllWebContents().forEach(wc => {
                  wc.send('chrome-speech:result', data);
                });
              } catch(e) {}
              res.writeHead(200);
              res.end('OK');
            });
          } else if (req.method === 'POST' && req.url === '/error') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
              const { webContents } = require('electron');
              webContents.getAllWebContents().forEach(wc => {
                wc.send('chrome-speech:error', body.toString());
              });
              res.writeHead(200);
              res.end('OK');
            });
          } else {
            res.writeHead(404);
            res.end();
          }
        });

        chromeBridgeServer.listen(0, '127.0.0.1', () => {
          chromeBridgePort = chromeBridgeServer.address().port;
          launchChrome();
        });
      } else {
        launchChrome();
      }

      function launchChrome() {
        const { spawn } = require('child_process');
        chromeProcess = spawn(chromePath, [
          '--app=http://127.0.0.1:' + chromeBridgePort + '/',
          '--use-fake-ui-for-media-stream',
          '--window-position=-2000,-2000'
        ]);
        chromeProcess.on('exit', () => { chromeProcess = null; });
        resolve({ ok: true });
      }
    });
  });

  ipcMain.handle('chrome:stop-bridge', () => {
    if (chromeProcess) {
      chromeProcess.kill();
      chromeProcess = null;
    }
    return { ok: true };
  });

  // Kill Chrome bridge process when BibleCast quits
  app.on('before-quit', () => {
    if (chromeProcess) { chromeProcess.kill(); chromeProcess = null; }
  });
}
