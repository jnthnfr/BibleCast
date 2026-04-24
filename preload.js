const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('biblecast', {

  // --- Verse search & display ---
  searchVerses: (query, translation) =>
    ipcRenderer.invoke('verse:search', { query, translation }),

  pushVerse: (verse) =>
    ipcRenderer.invoke('verse:push', verse),

  navigateVerse: (direction) =>
    ipcRenderer.invoke('verse:navigate', { direction }),

  getFollowingVerses: (reference, translation, count) =>
    ipcRenderer.invoke('verse:following', { reference, translation, count }),

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

  openHdmiMirror: (open) =>
    ipcRenderer.invoke('display:open-hdmi-mirror', open),

  onHdmiMirrorClosed: (callback) =>
    ipcRenderer.on('hdmi-mirror:closed', () => callback()),

  clearHdmiDisplay: () =>
    ipcRenderer.invoke('display:clear-hdmi'),

  sendDisplayLayout: (data) =>
    ipcRenderer.invoke('display:layout', data),

  saveBackgroundImage: (file) =>
    ipcRenderer.invoke('background:save-image', webUtils.getPathForFile(file)),

  listMonitors: () =>
    ipcRenderer.invoke('display:list-monitors'),

  setMonitor: (displayId) =>
    ipcRenderer.invoke('display:set-monitor', { displayId }),

  // --- Events: main → renderer ---
  onDisplayUpdate: (callback) =>
    ipcRenderer.on('display:update', (_event, data) => callback(data)),

  onDisplayClosed: (callback) =>
    ipcRenderer.on('display:window-closed', () => callback()),

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

  setWhisperGpu: (enable) =>
    ipcRenderer.invoke('whisper:set-gpu', enable),

  getHardwareInfo: () =>
    ipcRenderer.invoke('system:hardware-info'),

  onWhisperProgress: (callback) =>
    ipcRenderer.on('whisper:progress', (_event, data) => callback(data)),

  // --- AI Sermon Summary ---
  summarizeSermon: (transcript, apiKey) =>
    ipcRenderer.invoke('ai:summarize', { transcript, apiKey }),

  // --- App info ---
  getAppVersion: () =>
    ipcRenderer.invoke('app:version'),

  // --- Updates ---
  checkForUpdates: () =>
    ipcRenderer.invoke('updates:check'),

  downloadUpdate: () =>
    ipcRenderer.invoke('updates:download'),

  installUpdate: () =>
    ipcRenderer.invoke('updates:install'),

  openRelease: (url) =>
    ipcRenderer.invoke('updates:open-release', url),

  onUpdaterEvent: (callback) =>
    ipcRenderer.on('updater:event', (_event, data) => callback(data)),

  // --- Vosk model ---
  readVoskModel: () =>
    ipcRenderer.invoke('vosk:read-model'),

  // --- Bible Gateway Scraper ---
  openScraperWindow: () =>
    ipcRenderer.invoke('scraper:open'),

  checkPython: () =>
    ipcRenderer.invoke('scraper:check-python'),

  startScrape: (opts) =>
    ipcRenderer.invoke('scraper:start', opts),

  cancelScrape: () =>
    ipcRenderer.invoke('scraper:cancel'),

  onScrapeProgress: (callback) =>
    ipcRenderer.on('scraper:progress', (_event, data) => callback(data)),

  removeScrapeProgress: () =>
    ipcRenderer.removeAllListeners('scraper:progress'),

  // --- Chrome Web Speech Bridge ---
  startChromeBridge: () => ipcRenderer.invoke('chrome:start-bridge'),
  stopChromeBridge: () => ipcRenderer.invoke('chrome:stop-bridge'),
  onChromeSpeechResult: (callback) =>
    ipcRenderer.on('chrome-speech:result', (_event, data) => callback(data)),

  onChromeSpeechError: (callback) =>
    ipcRenderer.on('chrome-speech:error', (_event, msg) => callback(msg)),
});
