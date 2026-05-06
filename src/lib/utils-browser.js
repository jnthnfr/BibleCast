/* BibleCast: browser-safe shared utilities (no module.exports) */

/**
 * Escape characters that have meaning in HTML so user-provided strings
 * can be safely interpolated into innerHTML or attributes. Returns ''
 * for null/undefined so we never render the literal "null" or "undefined".
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
