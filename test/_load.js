'use strict';

// Loads the pure scripture-detection layer (bible-data.js + search.js) the
// same way index.html does: as classic scripts sharing one lexical scope.
// We concatenate both files and run them once in a vm context with a
// controllable clock and benign stubs for the browser globals the
// DOM-coupled functions reference (those functions are never invoked here —
// only the pure detection functions are exercised).

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT     = path.join(__dirname, '..');
const MOD_DIR  = path.join(ROOT, 'src', 'renderer', 'modules');

function loadDetection() {
  const src =
    fs.readFileSync(path.join(MOD_DIR, 'bible-data.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(MOD_DIR, 'search.js'), 'utf8');

  // Controllable clock so staleness/TTL behaviour is testable.
  const clock = { now: 1_000_000 };

  const sandbox = {
    console,
    Date: { now: () => clock.now },
    // Stubs for globals referenced only inside DOM-coupled functions that
    // the tests never call. Present so an accidental reference can't crash
    // the whole script load.
    document: { getElementById: () => null },
    settings: {},
    api: {},
    window: {},
  };

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'detection-bundle.js' });

  return {
    setNow:                  (ms) => { clock.now = ms; },
    advance:                 (ms) => { clock.now += ms; },
    normalizeSpokenScripture: sandbox.normalizeSpokenScripture,
    detectScriptureRef:       sandbox.detectScriptureRef,
    parseScriptureRef:        sandbox.parseScriptureRef,
    normalizeNumberWords:     sandbox.normalizeNumberWords,
    resolveContextualRef:     sandbox.resolveContextualRef,
    rememberScriptureContext: sandbox.rememberScriptureContext,
    resetScriptureContext:    sandbox.resetScriptureContext,
    resetRefTailBuffer:       sandbox.resetRefTailBuffer,
  };
}

module.exports = { loadDetection };
