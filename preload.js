const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('biblecast', {

  // --- Verse search & display ---
  searchVerses: (query, translation) =>
    ipcRenderer.invoke('verse:search', { query, translation }),

  pushVerse: (verse) =>
    ipcRenderer.invoke('verse:push', verse),

  navigateVerse: (direction) =>
    ipcRenderer.invoke('verse:navigate', { direction }),

  blankDisplay: (blank) =>
    ipcRenderer.invoke('display:blank', blank),

  getDisplayState: () =>
    ipcRenderer.invoke('display:state'),

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

  listAvailableTranslations: () =>
    ipcRenderer.invoke('translations:available'),

  downloadTranslation: (abbr) =>
    ipcRenderer.invoke('translations:download', abbr),

  seedBundledTranslation: () =>
    ipcRenderer.invoke('translations:seed-bundled'),

  seedSampleTranslation: () =>
    ipcRenderer.invoke('translations:seed-sample'),

  importTranslationFile: () =>
    ipcRenderer.invoke('translations:import-file'),

  // --- Settings ---
  getSettings: () =>
    ipcRenderer.invoke('settings:get'),

  saveSetting: (key, value) =>
    ipcRenderer.invoke('settings:save', { key, value }),

  openDisplay: () =>
    ipcRenderer.invoke('display:open'),

  openNdiDisplay: (open) =>
    ipcRenderer.invoke('display:open-ndi', open),

  sendDisplayLayout: (data) =>
    ipcRenderer.invoke('display:layout', data),

  saveBackgroundImage: (srcPath) =>
    ipcRenderer.invoke('background:save-image', srcPath),

  listMonitors: () =>
    ipcRenderer.invoke('display:list-monitors'),

  setMonitor: (displayId) =>
    ipcRenderer.invoke('display:set-monitor', { displayId }),

  // --- Events: main → renderer ---
  onDisplayUpdate: (callback) =>
    ipcRenderer.on('display:update', (_event, data) => callback(data)),

  onNavSettings: (callback) =>
    ipcRenderer.on('nav:settings', () => callback()),

  onTranslationsReady: (callback) =>
    ipcRenderer.on('translations:ready', () => callback()),

  removeDisplayUpdate: () =>
    ipcRenderer.removeAllListeners('display:update'),

  // --- Whisper AI ---
  transcribeAudio: (audioArray, modelId) =>
    ipcRenderer.invoke('whisper:transcribe', { audioArray, modelId }),

  resetWhisper: () =>
    ipcRenderer.invoke('whisper:reset'),

  onWhisperProgress: (callback) =>
    ipcRenderer.on('whisper:progress', (_event, data) => callback(data)),

  // --- AI Sermon Summary ---
  summarizeSermon: (transcript, apiKey) =>
    ipcRenderer.invoke('ai:summarize', { transcript, apiKey }),

  // --- Updates ---
  checkForUpdates: () =>
    ipcRenderer.invoke('updates:check'),

  openRelease: (url) =>
    ipcRenderer.invoke('updates:open-release', url),

  onUpdateAvailable: (callback) =>
    ipcRenderer.on('update:available', (_event, data) => callback(data)),
});
