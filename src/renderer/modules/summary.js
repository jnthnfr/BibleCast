/* BibleCast: sermon summary module
 *
 * Builds a running summary of the live transcript. Always shows a local
 * keyword-frequency summary; if AI summary is enabled in settings and
 * an API key is configured for the selected provider, also asks the main
 * process for an AI summary every 200 new words.
 *
 * Providers (settings.ai_summary_provider):
 *   'openai' (default) → OpenAI gpt-3.5-turbo, key in settings.openai_api_key
 *   'claude'           → Anthropic Claude (model in settings.claude_model,
 *                        key in settings.anthropic_api_key)
 *   'gemini'           → Google Gemini (model in settings.gemini_model,
 *                        key in settings.google_api_key)
 *
 * Reads fullTranscript and settings from renderer.js, and extractKeywords
 * from the search/prediction code that still lives in renderer.js. All
 * those names resolve at call time once classic <script> tags have parsed.
 */

let summaryWordCount = 0; // word count at last AI summary trigger

// Resolve the active provider and its API key from settings. Defaults to
// OpenAI so existing installs with openai_api_key set keep working.
function resolveSummaryProvider() {
  const raw = settings.ai_summary_provider;
  const provider = raw === 'claude' || raw === 'gemini' ? raw : 'openai';
  if (provider === 'claude') {
    return {
      provider,
      apiKey: settings.anthropic_api_key || '',
      model:  settings.claude_model      || 'claude-haiku-4-5',
      label:  'Claude',
    };
  }
  if (provider === 'gemini') {
    return {
      provider,
      apiKey: settings.google_api_key || '',
      model:  settings.gemini_model   || 'gemini-2.5-flash',
      label:  'Gemini',
    };
  }
  return {
    provider,
    apiKey: settings.openai_api_key || '',
    model:  undefined,
    label:  'OpenAI',
  };
}

function updateSermonSummary() {
  const el    = document.getElementById('summary-text');
  if (!el) return;
  const words = fullTranscript.trim().split(/\s+/).filter(Boolean);

  if (words.length < 15) {
    el.textContent = 'Summary builds as the sermon progresses...';
    return;
  }

  // Keyword-based summary is always shown immediately
  const keywords = extractKeywords(fullTranscript);
  const freq     = {};
  keywords.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const topWords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  const localSummary = `${words.length} words · Themes: ${topWords.join(', ')}`;

  // If AI summary is enabled and enough new words have accumulated, trigger it
  const useAI   = settings.ai_summary === 'true';
  const cfg     = resolveSummaryProvider();
  const newWords = words.length - summaryWordCount;

  if (useAI && cfg.apiKey && newWords >= 200) {
    summaryWordCount = words.length;
    summarizeWithAI(localSummary, cfg);
  } else if (!useAI || !cfg.apiKey) {
    // Update badge to show "Local" mode
    const badge = document.getElementById('summary-provider-badge');
    if (badge) { badge.textContent = 'Local'; badge.className = 'whisper-status'; }
    el.textContent = localSummary;
  }
}

async function summarizeWithAI(fallbackText, cfg) {
  const el    = document.getElementById('summary-text');
  const badge = document.getElementById('summary-provider-badge');

  if (badge) { badge.textContent = cfg.label; badge.className = 'whisper-status ai'; }
  if (el) el.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Generating ${cfg.label} summary...</span>`;

  try {
    const MAX_AI_WORDS = 2000;
    const allWords = fullTranscript.trim().split(/\s+/).filter(Boolean);
    const aiInput  = allWords.slice(-MAX_AI_WORDS).join(' ');
    const result = await api.summarizeSermon(aiInput, {
      provider: cfg.provider,
      apiKey:   cfg.apiKey,
      model:    cfg.model,
    });
    if (result.ok && el) {
      el.textContent = result.summary;
    } else {
      if (el) el.textContent = fallbackText;
      if (result.error !== 'insufficient_data') console.warn('[AI Summary]', result.error);
    }
  } catch (e) {
    if (el) el.textContent = fallbackText;
  }
}
