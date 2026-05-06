/* BibleCast: sermon summary module
 *
 * Builds a running summary of the live transcript. Always shows a local
 * keyword-frequency summary; if AI summary is enabled in settings and
 * an OpenAI key is configured, also asks the main process for an AI
 * summary every 200 new words.
 *
 * Reads fullTranscript and settings from renderer.js, and extractKeywords
 * from the search/prediction code that still lives in renderer.js. All
 * those names resolve at call time once classic <script> tags have parsed.
 */

let summaryWordCount = 0; // word count at last AI summary trigger

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
  const useAI  = settings.ai_summary === 'true';
  const apiKey = settings.openai_api_key || '';
  const newWords = words.length - summaryWordCount;

  if (useAI && apiKey && newWords >= 200) {
    summaryWordCount = words.length;
    summarizeWithAI(localSummary);
  } else if (!useAI || !apiKey) {
    // Update badge to show "Local" mode
    const badge = document.getElementById('summary-provider-badge');
    if (badge) { badge.textContent = 'Local'; badge.className = 'whisper-status'; }
    el.textContent = localSummary;
  }
}

async function summarizeWithAI(fallbackText) {
  const el     = document.getElementById('summary-text');
  const badge  = document.getElementById('summary-provider-badge');
  const apiKey = settings.openai_api_key || '';

  if (badge) { badge.textContent = 'AI'; badge.className = 'whisper-status ai'; }
  if (el) el.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Generating AI summary...</span>`;

  try {
    const MAX_AI_WORDS = 2000;
    const allWords   = fullTranscript.trim().split(/\s+/).filter(Boolean);
    const aiInput    = allWords.slice(-MAX_AI_WORDS).join(' ');
    const result = await api.summarizeSermon(aiInput, apiKey);
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
