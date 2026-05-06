/* BibleCast: voice-command dispatch + verse navigation
 *
 * Recognises spoken commands ("next", "previous", "clear", "show",
 * "repeat") in the live transcript and dispatches into the projection
 * controls (pushVerse, toggleBlank, navigateVerse). Reads the
 * voice-cmds-toggle checkbox to gate dispatch.
 *
 * Cross-bucket calls (selectVerse, pushVerse, toggleBlank, isBlank,
 * selectedVerse) resolve at call time once all classic <script> tags
 * have parsed.
 */

function checkVoiceCommands(text) {
  if (!document.getElementById('voice-cmds-toggle')?.checked) return;
  const lower = text.toLowerCase().trim();

  if (/\b(next|next verse)\b/.test(lower)) {
    navigateVerse('next');
  } else if (/\b(previous|previous verse|go back)\b/.test(lower)) {
    navigateVerse('prev');
  } else if (/\b(clear|clear screen|clear the screen|hide|hide screen|hide the screen)\b/.test(lower)) {
    if (!isBlank) toggleBlank();
  } else if (/\b(show|show verse|project|project verse)\b/.test(lower)) {
    if (isBlank) toggleBlank();
    else if (selectedVerse) pushVerse();
  } else if (/\b(repeat|repeat that|repeat verse)\b/.test(lower)) {
    if (selectedVerse) pushVerse();
  }
}

async function navigateVerse(direction) {
  const result = await api.navigateVerse(direction === 'next' ? 'next' : 'prev');
  if (result.ok && result.verse) {
    selectVerse(result.verse, null);
    await pushVerse();
  }
}
