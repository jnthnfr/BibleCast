/* BibleCast: verse search, prediction, and selection
 *
 * Three responsibilities, one module:
 *
 *   1. Spoken-reference detection: normalize numbers/homophones in
 *      speech, then match against SCRIPTURE_REF_RE.
 *   2. Background prediction: extract keywords from the live transcript
 *      and surface candidate verses, optionally auto-projecting the top
 *      result when auto_project is on and cooldown has elapsed.
 *   3. Manual search input handler, search results rendering, and
 *      selectVerse (the most-called cross-bucket entry point: history,
 *      sessions, bible-browser, prediction, autocomplete and search
 *      results all funnel through it).
 *
 * Cross-module references (resolve at call time once classic <script>
 * tags have parsed):
 *
 *   BIBLE_BOOKS, SCRIPTURE_REF_RE, STOP_WORDS         (bible-data)
 *   escapeHtml                                        (utils-browser)
 *   formatRef                                         (utils-renderer)
 *   settings, api, selectedVerse, searchTimeout,
 *     activeSession, lastProjectedAt                  (state / sessions)
 *   predictionTimeout                                 (transcription)
 *   pushVerse, updatePushButton, updateStudioPreview  (still in renderer.js)
 */

// ── Bible prediction from speech ──────────────────────────────────────────────

function normalizeSpokenScripture(text) {
  let norm = text.toLowerCase();

  // Remove filler words common in spoken references
  norm = norm.replace(/\b(?:chapter|verse|verses)\b/g, ' ');

  // Replace common homophones for numbers. NOTE: "to" is deliberately
  // excluded — it is overwhelmingly the preposition ("turn TO John"), and
  // mapping it to 2 corrupted the book token into the "2 John" epistle.
  // "too"/"two" are kept (genuine homophones of the number two).
  norm = norm.replace(/\b(?:too|two)\b/g, '2');
  norm = norm.replace(/\bfour\b/g, '4');
  norm = norm.replace(/\bate\b/g, '8');

  // Replace textual numbers with digits
  const numWords = {
    'zero':0, 'one':1, 'three':3, 'five':5, 'six':6, 'seven':7, 'eight':8,
    'nine':9, 'ten':10, 'eleven':11, 'twelve':12, 'thirteen':13, 'fourteen':14,
    'fifteen':15, 'sixteen':16, 'seventeen':17, 'eighteen':18, 'nineteen':19,
    'twenty':20, 'thirty':30, 'forty':40, 'fifty':50, 'sixty':60, 'seventy':70,
    'eighty':80, 'ninety':90, "hundred": 100
  };

  for (const [word, digit] of Object.entries(numWords)) {
    norm = norm.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
  }

  // Combine compound numbers (e.g., "20 3" -> 23)
  norm = norm.replace(/\b(20|30|40|50|60|70|80|90)\s+([1-9])\b/g, (_, tens, ones) => parseInt(tens) + parseInt(ones));
  norm = norm.replace(/\b(100)\s+([1-9]\d?)\b/g, (_, h, rest) => parseInt(h) + parseInt(rest));

  return norm.replace(/\s+/g, ' ').trim();
}

// Parse a spoken/typed reference into its parts so callers can both search
// for it and remember it as context for later bare-verse references.
// Returns { ref, book, chapter, verse } or null. `book` is the spoken token
// as normalized (e.g. "john", "first corinthians") — api.searchVerses
// already accepts that form, so no canonical-name mapping is needed.
function parseScriptureRef(text) {
  const normalized = normalizeSpokenScripture(text);
  const m = normalized.match(SCRIPTURE_REF_RE);
  if (!m) return null;
  const ref     = m[0].trim();
  const chapter = m[1] ? parseInt(m[1], 10) : null;
  const verse   = m[2] ? parseInt(m[2], 10) : null;
  // book = full match minus the trailing "<chapter>[: ]<verse>" tail.
  const book = ref.replace(/\s+\d+(?:[: ]\d+)?$/, '').trim();
  return { ref, book, chapter, verse };
}

function detectScriptureRef(text) {
  const p = parseScriptureRef(text);
  return p ? p.ref : null;
}

// ── Contextual references ─────────────────────────────────────────────────────
//
// Preachers rarely re-state the book: they say "John chapter three" once, then
// "verse sixteen", "the next verse", "verses nine through eleven". This tracks
// the last explicit reference and resolves bare-verse cues against it — the
// "contextual" detection type both PewBeam and Loghema advertise.
//
// Two time windows guard against stale context bleeding across topics:
//   CONTEXT_TTL_MS           how long context stays usable for SUGGESTIONS
//   CONTEXT_AUTOPROJECT_MS   tighter window in which a contextual hit may
//                            also auto-project (strict mode) rather than
//                            only populate the predictions list
let _ctxBook     = null;   // normalized spoken token, e.g. "john"
let _ctxChapter  = null;   // number
let _ctxVerse    = null;   // number — last resolved verse (drives "next verse")
let _ctxAt       = 0;      // timestamp of last context update
const CONTEXT_TTL_MS         = 180000; // 3 min
const CONTEXT_AUTOPROJECT_MS = 45000;  // 45 s

function resetScriptureContext() {
  _ctxBook = null; _ctxChapter = null; _ctxVerse = null; _ctxAt = 0;
}

function rememberScriptureContext(parsed) {
  if (!parsed || !parsed.book || parsed.chapter == null) return;
  _ctxBook    = parsed.book;
  _ctxChapter = parsed.chapter;
  _ctxVerse   = parsed.verse;   // may be null for a chapter-only reference
  _ctxAt      = Date.now();
}

// Convert spoken number words to digits WITHOUT stripping the cue words
// ("verse", "next", "to", "through") that normalizeSpokenScripture removes.
// Range words (to/through/thru) are intentionally preserved.
function normalizeNumberWords(text) {
  let s = text.toLowerCase();
  const numWords = {
    zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8,
    nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14,
    fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
    twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70,
    eighty:80, ninety:90, hundred:100,
  };
  for (const [w, d] of Object.entries(numWords)) {
    s = s.replace(new RegExp(`\\b${w}\\b`, 'g'), d);
  }
  s = s.replace(/\b(20|30|40|50|60|70|80|90)\s+([1-9])\b/g, (_, t, o) => parseInt(t) + parseInt(o));
  s = s.replace(/\b(100)\s+([1-9]\d?)\b/g, (_, h, r) => parseInt(h) + parseInt(r));
  return s.replace(/\s+/g, ' ').trim();
}

// Resolve a bare-verse cue against remembered context. Returns
// { ref, verse, fresh } or null. Only fires on an explicit cue word so a
// stray number in normal speech ("I have 3 points") can't trigger it.
function resolveContextualRef(text) {
  if (!_ctxBook || _ctxChapter == null) return null;
  const age = Date.now() - _ctxAt;
  if (age > CONTEXT_TTL_MS) return null;

  const s = normalizeNumberWords(text);

  // A bare "chapter N" (no book) re-points the chapter for later verses but
  // is too ambiguous to project on its own.
  const chap = s.match(/\bchapter\s+(\d{1,3})\b/);
  if (chap) {
    _ctxChapter = parseInt(chap[1], 10);
    _ctxVerse   = null;
    _ctxAt      = Date.now();
  }

  let verse = null;
  if (/\b(?:the\s+)?(?:next|following)\s+verse\b/.test(s)) {
    if (_ctxVerse == null) return null;
    verse = _ctxVerse + 1;
  } else if (/\b(?:the\s+)?(?:previous|preceding|last)\s+verse\b/.test(s)) {
    if (_ctxVerse == null || _ctxVerse <= 1) return null;
    verse = _ctxVerse - 1;
  } else {
    // "verse 16", "verses 9 through 11", "verses 4 to 7" → take the start.
    const m = s.match(/\bverses?\s+(\d{1,3})(?:\s*(?:-|–|to|through|thru)\s*(\d{1,3}))?\b/);
    if (m) verse = parseInt(m[1], 10);
  }

  if (verse == null || verse < 1) return null;

  _ctxVerse = verse;
  _ctxAt    = Date.now();
  return {
    ref:   `${_ctxBook} ${_ctxChapter} ${verse}`,
    verse,
    fresh: age <= CONTEXT_AUTOPROJECT_MS,
  };
}

// ── Search autocomplete ───────────────────────────────────────────────────────

function updateBookAutocomplete() {
  const input = document.getElementById('search-input');
  if (!input) return;

  const val    = input.value;
  const cursor = input.selectionStart;

  // Only suggest while typing the book name (no digits yet) and cursor is at end
  if (!val || /\d/.test(val) || cursor !== val.length) return;

  const lower = val.toLowerCase();
  const match = BIBLE_BOOKS.find(b =>
    b.name.toLowerCase().startsWith(lower) ||
    b.abbrevs.some(a => a.startsWith(lower))
  );

  if (!match || match.name.toLowerCase() === lower) return;

  input.value = match.name;
  input.setSelectionRange(val.length, match.name.length);
}

// ── Keyword prediction ────────────────────────────────────────────────────────

function extractKeywords(text) {
  return text.toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w)); // include 3-letter theological words: sin, God, law, ark, joy
}

function getConfidenceThreshold() {
  const conf = settings.confidence || 'medium';
  if (conf === 'low')  return 1;
  if (conf === 'high') return 4;
  return 2; // medium
}

// Rolling tail buffer for cross-chunk reference detection. When Whisper
// flushes every 5 seconds (or the Chrome bridge emits a final chunk), a
// reference like "John three sixteen" can land partly in chunk N and partly
// in chunk N+1. We keep the trailing ~150 chars of the previous chunk and
// run the regex over (previous_tail + current_chunk) so a split reference
// is still matched. The buffer auto-expires after 15 s of silence so a
// long pause (prayer, music, a different topic) doesn't glue unrelated
// phrases together.
let _refTailBuffer = '';
let _refTailAt     = 0;
const REF_TAIL_LEN     = 150;
const REF_TAIL_TTL_MS  = 15000;

function resetRefTailBuffer() {
  _refTailBuffer = '';
  _refTailAt     = 0;
  resetScriptureContext();
}

function schedulePrediction(text) {
  clearTimeout(predictionTimeout);
  const delay = parseInt(settings.debounce_ms || 1500, 10);
  predictionTimeout = setTimeout(() => runPrediction(text), delay);
}

async function runPrediction(text) {
  const translation = document.getElementById('translation-select')?.value || 'KJV';
  let results = [];
  let resultSource = null; // 'ref' | 'context' | 'keyword'

  // Prepend the previous chunk's trailing edge so references that span
  // chunk boundaries can still be detected. Skip the carry if the previous
  // chunk is stale (>15s ago) so an old fragment doesn't false-match
  // against unrelated new speech.
  const now      = Date.now();
  const carryOk  = _refTailBuffer && (now - _refTailAt) <= REF_TAIL_TTL_MS;
  const matchInput = (carryOk ? _refTailBuffer + ' ' : '') + text;
  _refTailBuffer   = text.slice(-REF_TAIL_LEN);
  _refTailAt       = now;

  // Path 1: explicit reference (e.g. "John 3:16" spoken aloud). Remember it
  // as context so later bare-verse cues ("verse 18", "the next verse")
  // resolve against it.
  const parsed = parseScriptureRef(matchInput);
  if (parsed) {
    results = await api.searchVerses(parsed.ref, translation);
    if (results.length) {
      resultSource = 'ref';
      rememberScriptureContext(parsed);
    }
  }

  // Path 2: contextual reference resolved against the last explicit one.
  // Auto-projects only inside the fresh window; otherwise it just populates
  // the predictions list so the operator can confirm with a click.
  if (!results.length) {
    const ctx = resolveContextualRef(matchInput);
    if (ctx) {
      results = await api.searchVerses(ctx.ref, translation);
      if (results.length) resultSource = ctx.fresh ? 'ref' : 'context';
    }
  }

  // Path 3: semantic / paraphrase match (opt-in). Runs the rolling window
  // through the embedded verse index. Like keyword, it never auto-projects
  // under strict mode (resultSource !== 'ref') — paraphrase matching is the
  // highest false-positive risk, so it only populates predictions for the
  // operator to confirm.
  if (!results.length && settings.semantic_enabled === 'true') {
    const minScore = parseFloat(settings.semantic_threshold) || 0.45;
    try {
      const res = await api.semanticSearch({
        query: matchInput, translation, topK: 5, minScore,
      });
      if (res && res.ok && res.results.length) {
        results = res.results;
        resultSource = 'semantic';
      }
    } catch (err) {
      console.warn('[semantic] search failed:', err.message);
    }
  }

  // Path 4: fall back to keyword search if nothing matched.
  if (!results.length) {
    const keywords = extractKeywords(text);
    if (keywords.length < getConfidenceThreshold()) return;
    results = await api.searchVerses(keywords.slice(0, 4).join(' '), translation);
    if (results.length) resultSource = 'keyword';
  }

  // The rolling tail buffer exists only to bridge a reference split across a
  // chunk boundary. Once any path produces a result the carried speech is
  // spent — retaining it would let a completed reference re-fire on the next
  // chunk and block contextual progression ("John 3:16" then "verse 18" must
  // advance to 3:18, not re-match the carried 3:16). Keep the tail only when
  // this chunk found nothing, i.e. it may be the front half of a split.
  if (results.length) { _refTailBuffer = ''; _refTailAt = 0; }

  showPredictions(results.slice(0, 5));

  // Auto-project if enabled
  if (settings.auto_project === true || settings.auto_project === 'true') {
    const requireSession = settings.require_session !== 'false';
    if (requireSession && !activeSession) return;

    // Strict mode (default on): auto-project only when path 1 matched, that
    // is, the speaker actually said an explicit reference. Keyword-fallback
    // hits still populate the predictions list so the operator can click
    // them manually, but they do not fire pushVerse on their own. This
    // prevents false projections triggered by verbatim quoting of verse
    // wording without a spoken reference.
    const strict = settings.auto_project_only_on_exact_ref !== 'false';
    if (strict && resultSource !== 'ref') return;

    const now      = Date.now();
    const cooldown = parseInt(settings.proj_debounce || 5, 10) * 1000;
    if (now - lastProjectedAt < cooldown) return;

    if (results.length) {
      selectVerse(results[0], null);
      await pushVerse();
      lastProjectedAt = Date.now();
    }
  }
}

function showPredictions(verses) {
  const lbl  = document.getElementById('predictions-lbl');
  const list = document.getElementById('predictions-list');
  if (!lbl || !list) return;

  if (!verses.length) {
    lbl.style.display  = 'none';
    list.innerHTML     = '';
    return;
  }

  lbl.style.display = 'block';
  list.innerHTML = verses.map((v, i) => `
    <div class="prediction-item" data-idx="${i}">
      <div class="prediction-ref">${escapeHtml(v.reference || formatRef(v))}</div>
      <div class="prediction-text">${escapeHtml(v.text)}</div>
    </div>
  `).join('');

  list.querySelectorAll('.prediction-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      list.querySelectorAll('.prediction-item').forEach(p => p.classList.remove('selected'));
      el.classList.add('selected');
      selectVerse(verses[i], el);
    });
  });
}

// ── Manual search ─────────────────────────────────────────────────────────────

function onSearchInput() {
  clearTimeout(searchTimeout);
  updateBookAutocomplete();
  searchTimeout = setTimeout(doSearch, 300);
}

async function doSearch(projectFirst = false) {
  const query       = document.getElementById('search-input')?.value.trim();
  const translation = document.getElementById('translation-select')?.value;
  const list        = document.getElementById('results-list');
  if (!list) return;

  if (!query) {
    list.innerHTML = '<div class="no-results">Search for a verse above</div>';
    selectedVerse  = null;
    updatePushButton(false);
    return;
  }

  if (!translation) {
    list.innerHTML = '<div class="no-results">Load a Bible translation first</div>';
    return;
  }

  const results = await api.searchVerses(query, translation);

  if (!results.length) {
    list.innerHTML = '<div class="no-results">No verses found</div>';
    selectedVerse  = null;
    updatePushButton(false);
    return;
  }

  list.innerHTML = '';
  results.forEach((v, idx) => {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-ref">${escapeHtml(v.reference || formatRef(v))}</div>
      <div class="result-text">${escapeHtml(v.text)}</div>
    `;
    item.addEventListener('click', () => {
      document.querySelectorAll('.result-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      selectVerse(v, item);
    });
    list.appendChild(item);
    // Auto-select first result visually when projecting
    if (projectFirst && idx === 0) item.classList.add('selected');
  });

  if (projectFirst) {
    selectVerse(results[0], null);
    await pushVerse();
  }
}

// ── Selection ─────────────────────────────────────────────────────────────────
// Most-called cross-bucket function: history, sessions, bible-browser,
// prediction, autocomplete and search results all funnel through here.

function selectVerse(verse, _el) {
  if (!verse.reference) verse.reference = formatRef(verse);
  selectedVerse = verse;
  updatePushButton();
  updateStudioPreview(verse);
}
