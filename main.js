const { app, BrowserWindow, ipcMain, screen } = require('electron');
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
}
