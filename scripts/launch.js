/**
 * BibleCast launcher — unsets ELECTRON_RUN_AS_NODE before spawning Electron.
 *
 * electron-rebuild and some native build tools set ELECTRON_RUN_AS_NODE=1,
 * which makes the Electron binary run as plain Node.js (no UI, no app API).
 * We delete it here so `npm start` always works regardless of shell state.
 */

delete process.env.ELECTRON_RUN_AS_NODE;

const { spawnSync } = require('child_process');
const path = require('path');

const electronBin = require('electron');
const appRoot = path.resolve(__dirname, '..');

const result = spawnSync(electronBin, [appRoot], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: false,
});

process.exit(result.status ?? 0);
