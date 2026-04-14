/**
 * Bible reference parser
 * Handles formats: "John 3:16", "John 3 16", "1 Cor 13:4-7", "Genesis 1:1"
 */

const BOOK_ALIASES = {
  'gen': 'Genesis', 'genesis': 'Genesis',
  'ex': 'Exodus', 'exo': 'Exodus', 'exodus': 'Exodus',
  'lev': 'Leviticus', 'leviticus': 'Leviticus',
  'num': 'Numbers', 'numbers': 'Numbers',
  'deut': 'Deuteronomy', 'deu': 'Deuteronomy', 'deuteronomy': 'Deuteronomy',
  'josh': 'Joshua', 'joshua': 'Joshua',
  'judg': 'Judges', 'judges': 'Judges',
  'ruth': 'Ruth',
  '1sam': '1 Samuel', '1 sam': '1 Samuel', '1samuel': '1 Samuel',
  '2sam': '2 Samuel', '2 sam': '2 Samuel', '2samuel': '2 Samuel',
  '1kgs': '1 Kings', '1 kgs': '1 Kings', '1kings': '1 Kings',
  '2kgs': '2 Kings', '2 kgs': '2 Kings', '2kings': '2 Kings',
  '1chr': '1 Chronicles', '1 chr': '1 Chronicles',
  '2chr': '2 Chronicles', '2 chr': '2 Chronicles',
  'ezra': 'Ezra', 'neh': 'Nehemiah', 'nehemiah': 'Nehemiah',
  'esth': 'Esther', 'esther': 'Esther',
  'job': 'Job',
  'ps': 'Psalms', 'psa': 'Psalms', 'psalm': 'Psalms', 'psalms': 'Psalms',
  'prov': 'Proverbs', 'pro': 'Proverbs', 'proverbs': 'Proverbs',
  'eccl': 'Ecclesiastes', 'ecc': 'Ecclesiastes', 'ecclesiastes': 'Ecclesiastes',
  'song': 'Song of Solomon', 'sos': 'Song of Solomon',
  'isa': 'Isaiah', 'isaiah': 'Isaiah',
  'jer': 'Jeremiah', 'jeremiah': 'Jeremiah',
  'lam': 'Lamentations', 'lamentations': 'Lamentations',
  'ezek': 'Ezekiel', 'eze': 'Ezekiel', 'ezekiel': 'Ezekiel',
  'dan': 'Daniel', 'daniel': 'Daniel',
  'hos': 'Hosea', 'hosea': 'Hosea',
  'joel': 'Joel', 'amos': 'Amos',
  'obad': 'Obadiah', 'obadiah': 'Obadiah',
  'jonah': 'Jonah', 'jon': 'Jonah',
  'mic': 'Micah', 'micah': 'Micah',
  'nah': 'Nahum', 'nahum': 'Nahum',
  'hab': 'Habakkuk', 'habakkuk': 'Habakkuk',
  'zeph': 'Zephaniah', 'zephaniah': 'Zephaniah',
  'hag': 'Haggai', 'haggai': 'Haggai',
  'zech': 'Zechariah', 'zechariah': 'Zechariah',
  'mal': 'Malachi', 'malachi': 'Malachi',
  'matt': 'Matthew', 'mat': 'Matthew', 'matthew': 'Matthew',
  'mark': 'Mark', 'mrk': 'Mark',
  'luke': 'Luke', 'luk': 'Luke',
  'john': 'John', 'jhn': 'John',
  'acts': 'Acts',
  'rom': 'Romans', 'romans': 'Romans',
  '1cor': '1 Corinthians', '1 cor': '1 Corinthians', '1corinthians': '1 Corinthians',
  '2cor': '2 Corinthians', '2 cor': '2 Corinthians', '2corinthians': '2 Corinthians',
  'gal': 'Galatians', 'galatians': 'Galatians',
  'eph': 'Ephesians', 'ephesians': 'Ephesians',
  'phil': 'Philippians', 'php': 'Philippians', 'philippians': 'Philippians',
  'col': 'Colossians', 'colossians': 'Colossians',
  '1thess': '1 Thessalonians', '1 thess': '1 Thessalonians',
  '2thess': '2 Thessalonians', '2 thess': '2 Thessalonians',
  '1tim': '1 Timothy', '1 tim': '1 Timothy',
  '2tim': '2 Timothy', '2 tim': '2 Timothy',
  'titus': 'Titus', 'tit': 'Titus',
  'phlm': 'Philemon', 'philemon': 'Philemon',
  'heb': 'Hebrews', 'hebrews': 'Hebrews',
  'jas': 'James', 'james': 'James',
  '1pet': '1 Peter', '1 pet': '1 Peter', '1peter': '1 Peter',
  '2pet': '2 Peter', '2 pet': '2 Peter', '2peter': '2 Peter',
  '1jn': '1 John', '1 jn': '1 John', '1john': '1 John',
  '2jn': '2 John', '2 jn': '2 John', '2john': '2 John',
  '3jn': '3 John', '3 jn': '3 John', '3john': '3 John',
  'jude': 'Jude',
  'rev': 'Revelation', 'revelation': 'Revelation',
};

/**
 * Parse a scripture reference string.
 * Returns { book, chapter, verse, verseEnd, isRange, formatted } or null if not parseable.
 */
function parseReference(input) {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();

  // Match: optional number prefix + book name + chapter + optional verse + optional end verse
  // e.g. "John 3:16", "1 Cor 13:4-7", "Genesis 1", "Ps 23:1"
  const pattern = /^(\d\s*)?([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+(\d+)(?:[:\s](\d+))?(?:-(\d+))?$/i;
  const match = trimmed.match(pattern);
  if (!match) return null;

  const prefix = match[1] ? match[1].trim() : '';
  const bookName = match[2].trim();
  const chapter = parseInt(match[3]);
  const verse = match[4] ? parseInt(match[4]) : null;
  const verseEnd = match[5] ? parseInt(match[5]) : null;

  const lookupKey = (prefix ? prefix + bookName : bookName).toLowerCase().replace(/\s+/g, '');
  const lookupKeySpaced = (prefix ? prefix + ' ' + bookName : bookName).toLowerCase();

  const book = BOOK_ALIASES[lookupKey] ||
    BOOK_ALIASES[lookupKeySpaced] ||
    BOOK_ALIASES[bookName.toLowerCase()] ||
    null;

  if (!book) return null;

  const formatted = verse
    ? verseEnd
      ? `${book} ${chapter}:${verse}-${verseEnd}`
      : `${book} ${chapter}:${verse}`
    : `${book} ${chapter}`;

  return {
    book,
    chapter,
    verse,
    verseEnd,
    isRange: verseEnd !== null,
    formatted,
  };
}

/**
 * Format a verse object into a display reference string.
 */
function formatReference({ book, chapter, verse, verseEnd }) {
  if (!verse) return `${book} ${chapter}`;
  if (verseEnd) return `${book} ${chapter}:${verse}-${verseEnd}`;
  return `${book} ${chapter}:${verse}`;
}

module.exports = { parseReference, formatReference, BOOK_ALIASES };
