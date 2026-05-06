/**
 * BibleCast - Shared Utilities
 * Common functions used across the application
 */

// ── HTML Escaping ─────────────────────────────────────────────────────────────
/**
 * Escape characters that have meaning in HTML so user-provided strings
 * can be safely interpolated into innerHTML or attributes. Mirrors the
 * implementation in src/lib/utils-browser.js so both contexts behave the
 * same way (in particular: null/undefined returns '', not the literal
 * string "null", and the apostrophe is escaped for attribute safety).
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

// ── Debouncing ────────────────────────────────────────────────────────────────
/**
 * Create a debounced function that delays execution until wait ms after last call
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a throttled function that fires at most once per wait ms.
 *
 * Leading edge: the first call in a quiet period fires immediately.
 * Trailing edge: if any calls land during the wait window, the function
 * fires once more after the window closes, using the most recent args.
 *
 * The previous implementation called setTimeout on every call inside
 * the throttle window without clearing the previous handle, which
 * produced N trailing fires for N calls instead of one.
 */
function throttle(func, wait) {
  let timeout = null;
  let previous = 0;
  let lastArgs = null;

  return function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - previous);
    lastArgs = args;

    // Leading edge (or clock skew put `previous` in the future).
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      const callArgs = lastArgs;
      lastArgs = null;
      func(...callArgs);
      return;
    }

    // Trailing edge: schedule exactly one call at the end of the window.
    if (!timeout) {
      timeout = setTimeout(() => {
        previous = Date.now();
        timeout = null;
        if (lastArgs) {
          const callArgs = lastArgs;
          lastArgs = null;
          func(...callArgs);
        }
      }, remaining);
    }
  };
}

// ── Array Utilities ───────────────────────────────────────────────────────────
/**
 * Create a lookup map from an array of objects for O(1) lookup
 */
function createLookupMap(array, keyField) {
  const map = new Map();
  for (const item of array) {
    const key = item[keyField];
    if (key !== undefined) {
      map.set(key, item);
    }
  }
  return map;
}

/**
 * Binary search in a sorted array
 */
function binarySearch(arr, target, getKey) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const key = getKey(arr[mid]);
    if (key === target) return mid;
    if (key < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

// ── Type Utilities ────────────────────────────────────────────────────────────
/**
 * Safely convert value to integer, with fallback
 */
function toInt(value, fallback = 0) {
  if (value == null) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Safely convert value to float, with fallback
 */
function toFloat(value, fallback = 0) {
  if (value == null) return fallback;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Check if value is a non-empty string
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// ── Export ────────────────────────────────────────────────────────────────────
module.exports = {
  escapeHtml,
  debounce,
  throttle,
  createLookupMap,
  binarySearch,
  toInt,
  toFloat,
  isNonEmptyString,
};
