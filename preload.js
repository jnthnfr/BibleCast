const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('biblecast', {
  // --- Verse search & push ---
  searchVerses: (query, translation) =>
    ipcRenderer.invoke('verse:search', { query, translation }),

  pushVerse: (verse) =>
    ipcRenderer.invoke('verse:push', verse),

  // --- Display control ---
  blankDisplay: (blank) =>
    ipcRenderer.invoke('display:blank', blank),

  // --- Sessions ---
  createSession: (name) =>
    ipcRenderer.invoke('session:create', name),

  getActiveSession: () =>
    ipcRenderer.invoke('session:active'),

  listSessions: () =>
    ipcRenderer.invoke('session:list'),

  getSessionVerses: (sessionId) =>
    ipcRenderer.invoke('session:verses', sessionId),

  // --- Translations ---
  listTranslations: () =>
    ipcRenderer.invoke('translations:list'),

  seedSampleTranslation: () =>
    ipcRenderer.invoke('translations:seed-sample'),

  importTranslationFile: () =>
    ipcRenderer.invoke('translations:import-file'),

  listAvailableTranslations: () =>
    ipcRenderer.invoke('translations:available'),

  downloadTranslation: (abbr) =>
    ipcRenderer.invoke('translations:download', abbr),

  // --- Settings ---
  getSettings: () =>
    ipcRenderer.invoke('settings:get'),

  saveSetting: (key, value) =>
    ipcRenderer.invoke('settings:save', { key, value }),

  // --- Display state ---
  getDisplayState: () =>
    ipcRenderer.invoke('display:state'),

  // --- Events from main → renderer ---
  onDisplayUpdate: (callback) =>
    ipcRenderer.on('display:update', (_event, data) => callback(data)),

  onNavSettings: (callback) =>
    ipcRenderer.on('nav:settings', () => callback()),

  removeDisplayUpdate: () =>
    ipcRenderer.removeAllListeners('display:update'),
});
