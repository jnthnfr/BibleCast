'use strict';

// Integration test for runPrediction's path orchestration: rolling tail
// buffer -> explicit -> contextual -> semantic -> keyword, plus strict-mode
// auto-project gating. The unit suite (detection.test.js) covers the pure
// functions; this drives the full cascade with stubbed api/document.
//
// Regression guard for the PR #2 × PR #3 interaction: the rolling tail
// buffer must not let a completed explicit reference re-fire on the next
// chunk and block contextual progression ("John 3:16" then "verse 18"
// must advance to 3:18, not re-match the carried 3:16).

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

function makeApp() {
  const MOD = path.join(__dirname, '..', 'src', 'renderer', 'modules');
  const src =
    fs.readFileSync(path.join(MOD, 'bible-data.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(MOD, 'search.js'), 'utf8');

  const state = { projected: [], semanticHit: null, now: 1_000_000 };
  const KJV = {
    'john 3 16': { book: 'John', chapter: 3, verse: 16, text: 'For God so loved' },
    'john 3 18': { book: 'John', chapter: 3, verse: 18, text: 'not condemned' },
    'john 3 19': { book: 'John', chapter: 3, verse: 19, text: 'light is come' },
  };

  const sandbox = {
    console,
    Date: { now: () => state.now },
    setTimeout: (f) => f,
    clearTimeout: () => {},
    document: {
      getElementById: (id) => (id === 'translation-select' ? { value: 'KJV' } : null),
      querySelectorAll: () => [],
    },
    settings: {
      auto_project: 'true', require_session: 'false',
      auto_project_only_on_exact_ref: 'true', proj_debounce: '0',
      semantic_enabled: 'false',
    },
    activeSession: null, lastProjectedAt: 0, selectedVerse: null,
    updatePushButton: () => {}, updateStudioPreview: () => {},
    api: {
      searchVerses: async (q) => {
        const v = KJV[q.trim().toLowerCase()];
        return v ? [{ ...v, reference: `${v.book} ${v.chapter}:${v.verse}` }] : [];
      },
      semanticSearch: async () =>
        state.semanticHit
          ? { ok: true, results: [state.semanticHit] }
          : { ok: true, results: [] },
    },
    showPredictions: () => {},
    pushVerse: async () => state.projected.push(sandbox.selectedVerse?.reference),
    escapeHtml: (s) => s,
    formatRef: (v) => `${v.book} ${v.chapter}:${v.verse}`,
  };

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'detection-bundle.js' });

  return {
    state,
    run: (t) => sandbox.runPrediction(t),
    enableSemantic: (hit) => { sandbox.settings.semantic_enabled = 'true'; state.semanticHit = hit; },
    reset: () => {
      state.projected = [];
      state.semanticHit = null;
      state.now = 1_000_000;
      sandbox.settings.semantic_enabled = 'false';
      sandbox.resetRefTailBuffer();
    },
  };
}

test('explicit reference auto-projects under strict mode', async () => {
  const app = makeApp();
  app.reset();
  await app.run('turn with me to John chapter three verse sixteen');
  assert.deepEqual(app.state.projected, ['John 3:16']);
});

test('contextual progression is not blocked by the rolling tail buffer', async () => {
  const app = makeApp();
  app.reset();
  await app.run('turn with me to John chapter three verse sixteen');
  await app.run('now look at verse eighteen');
  await app.run('and the next verse');
  // Regression: before the fix the carried tail re-matched "John 3:16"
  // every chunk, yielding ['John 3:16','John 3:16','John 3:16'].
  assert.deepEqual(app.state.projected, ['John 3:16', 'John 3:18', 'John 3:19']);
});

test('a reference split across two chunks is still bridged', async () => {
  const app = makeApp();
  app.reset();
  await app.run('I really want us to read from the gospel of John chapter three');
  await app.run('sixteen, this is the heart of the gospel');
  assert.deepEqual(app.state.projected, ['John 3:16']);
});

test('semantic match never auto-projects under strict mode', async () => {
  const app = makeApp();
  app.reset();
  app.enableSemantic({ book: 'Psalms', chapter: 23, verse: 1, text: 'shepherd', reference: 'Psalms 23:1' });
  await app.run('the lord is the one who takes care of me i shall not want');
  assert.deepEqual(app.state.projected, []); // suggestion only, never auto-projects
});
