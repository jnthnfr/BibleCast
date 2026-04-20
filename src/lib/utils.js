/**
 * BibleCast - Shared Utilities
 * Common functions used across the application
 */

// ── HTML Escaping ─────────────────────────────────────────────────────────────
/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
 * Create a throttled function that executes at most once per wait ms
 */
function throttle(func, wait) {
  let timeout;
  let previous = 0;
  return function executedFunction(...args) {
    const now = Date.now();
    if (!timeout && now >= previous + wait) {
      previous = now;
      func(...args);
    } else {
      timeout = setTimeout(() => {
        previous = Date.now();
        timeout = null;
        func(...args);
      }, wait);
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
