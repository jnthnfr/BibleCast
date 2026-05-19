'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { loadDetection } = require('./_load');

const D = loadDetection();

// ── Explicit reference detection ──────────────────────────────────────────────

test('explicit references normalize correctly', () => {
  assert.equal(D.detectScriptureRef('John three sixteen'), 'john 3 16');
  assert.equal(D.detectScriptureRef('Second Corinthians chapter five verse seven'), 'second corinthians 5 7');
  assert.equal(D.detectScriptureRef('Genesis chapter one verse one'), 'genesis 1 1');
  assert.equal(D.detectScriptureRef('two Timothy three sixteen'), '2 timothy 3 16');
});

// Regression: the "to"/"for" prepositions must NOT be coerced into the
// numbers 2/4 (that produced the "2 John" / "4 Psalm" corruption).
test('"to"/"for" homophones do not corrupt the book token', () => {
  assert.equal(D.detectScriptureRef('turn with me to John chapter three verse sixteen'), 'john 3 16');
  assert.equal(D.detectScriptureRef('turn to Romans eight twenty eight'), 'romans 8 28');
  assert.equal(D.detectScriptureRef('look for Psalm twenty three'), 'psalm 23');
});

test('non-references return null', () => {
  assert.equal(D.detectScriptureRef('praise the Lord today and every day'), null);
  assert.equal(D.detectScriptureRef('we have three things to cover'), null);
});

test('parseScriptureRef returns structured parts', () => {
  const p = D.parseScriptureRef('turn with me to John chapter three verse sixteen');
  assert.equal(p.ref, 'john 3 16');
  assert.equal(p.book, 'john');
  assert.equal(p.chapter, 3);
  assert.equal(p.verse, 16);

  const c = D.parseScriptureRef('Romans chapter eight');
  assert.equal(c.book, 'romans');
  assert.equal(c.chapter, 8);
  assert.equal(c.verse, null); // chapter-only
});

// ── Contextual references ─────────────────────────────────────────────────────

test('bare verses resolve against the last explicit reference', () => {
  D.resetScriptureContext();
  D.setNow(1_000_000);
  D.rememberScriptureContext(D.parseScriptureRef('John chapter three verse sixteen'));

  assert.equal(D.resolveContextualRef('now look at verse eighteen').ref, 'john 3 18');
  // "next verse" chains off the last resolved verse (18 -> 19)
  assert.equal(D.resolveContextualRef('and the next verse says').ref, 'john 3 19');
  // range -> start verse
  assert.equal(D.resolveContextualRef('verses nine through eleven').ref, 'john 3 9');
  // previous verse (9 -> 8)
  assert.equal(D.resolveContextualRef('the previous verse').ref, 'john 3 8');
});

test('bare "chapter N" re-points the chapter for later verses', () => {
  D.resetScriptureContext();
  D.setNow(1_000_000);
  D.rememberScriptureContext(D.parseScriptureRef('John chapter three verse one'));
  D.resolveContextualRef('now turn to chapter five');
  assert.equal(D.resolveContextualRef('verse two').ref, 'john 5 2');
});

test('no cue word never triggers a contextual match', () => {
  D.resetScriptureContext();
  D.setNow(1_000_000);
  D.rememberScriptureContext(D.parseScriptureRef('John chapter three verse sixteen'));
  assert.equal(D.resolveContextualRef('I have three points today'), null);
});

test('context expires after the TTL', () => {
  D.resetScriptureContext();
  D.setNow(1_000_000);
  D.rememberScriptureContext(D.parseScriptureRef('John chapter three verse sixteen'));
  D.advance(200_000); // > CONTEXT_TTL_MS (180s)
  assert.equal(D.resolveContextualRef('verse four'), null);
});

test('fresh flag gates auto-projectability', () => {
  D.resetScriptureContext();
  D.setNow(1_000_000);
  D.rememberScriptureContext(D.parseScriptureRef('Romans chapter eight'));

  const fresh = D.resolveContextualRef('verse twenty eight');
  assert.equal(fresh.ref, 'romans 8 28');
  assert.equal(fresh.fresh, true); // within CONTEXT_AUTOPROJECT_MS (45s)

  D.advance(50_000); // 50s: past auto-project window, still within TTL
  const stale = D.resolveContextualRef('the next verse');
  assert.equal(stale.ref, 'romans 8 29');
  assert.equal(stale.fresh, false); // suggestion only, must not auto-project
});

test('no context at all yields null', () => {
  D.resetScriptureContext();
  D.setNow(1_000_000);
  assert.equal(D.resolveContextualRef('verse seven'), null);
});
