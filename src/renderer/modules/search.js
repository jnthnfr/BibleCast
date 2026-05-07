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

  // Replace common homophones for numbers
  norm = norm.replace(/\b(?:to|too|two)\b/g, '2');
  norm = norm.replace(/\b(?:for|four)\b/g, '4');
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

function detectScriptureRef(text) {
  const normalized = normalizeSpokenScripture(text);
  const m = normalized.match(SCRIPTURE_REF_RE);
  return m ? m[0].trim() : null;
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

function schedulePrediction(text) {
  clearTimeout(predictionTimeout);
  const delay = parseInt(settings.debounce_ms || 1500, 10);
  predictionTimeout = setTimeout(() => runPrediction(text), delay);
}

async function runPrediction(text) {
  const translation = document.getElementById('translation-select')?.value || 'KJV';
  let results = [];

  // Try direct reference match first (e.g. "John 3:16" spoken aloud)
  const ref = detectScriptureRef(text);
  if (ref) {
    results = await api.searchVerses(ref, translation);
  }

  // Fall back to keyword search if no reference found or no results
  if (!results.length) {
    const keywords = extractKeywords(text);
    if (keywords.length < getConfidenceThreshold()) return;
    results = await api.searchVerses(keywords.slice(0, 4).join(' '), translation);
  }

  showPredictions(results.slice(0, 5));

  // Auto-project if enabled
  if (settings.auto_project === true || settings.auto_project === 'true') {
    const requireSession = settings.require_session !== 'false';
    if (requireSession && !activeSession) return;

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
