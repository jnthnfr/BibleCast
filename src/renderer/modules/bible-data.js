/* BibleCast: shared Bible reference data
 *
 * Pure data, no side effects. Read by the search/prediction module
 * (BIBLE_BOOKS, SCRIPTURE_REF_RE), the keyword extractor (STOP_WORDS),
 * and the Bible browser (BIBLE_CHAPTER_COUNTS). Loaded as a classic
 * <script> before any module that references these names so they
 * resolve in the shared script-level lexical scope.
 */

// All 66 Bible books with common abbreviations (used for autocomplete + voice detection)
const BIBLE_BOOKS = [
  { name: 'Genesis',         abbrevs: ['gen'] },
  { name: 'Exodus',          abbrevs: ['exod','ex'] },
  { name: 'Leviticus',       abbrevs: ['lev'] },
  { name: 'Numbers',         abbrevs: ['num'] },
  { name: 'Deuteronomy',     abbrevs: ['deut','dt'] },
  { name: 'Joshua',          abbrevs: ['josh'] },
  { name: 'Judges',          abbrevs: ['judg','jdg'] },
  { name: 'Ruth',            abbrevs: ['rth'] },
  { name: '1 Samuel',        abbrevs: ['1sam'] },
  { name: '2 Samuel',        abbrevs: ['2sam'] },
  { name: '1 Kings',         abbrevs: ['1kgs'] },
  { name: '2 Kings',         abbrevs: ['2kgs'] },
  { name: '1 Chronicles',    abbrevs: ['1chr'] },
  { name: '2 Chronicles',    abbrevs: ['2chr'] },
  { name: 'Ezra',            abbrevs: ['ezra'] },
  { name: 'Nehemiah',        abbrevs: ['neh'] },
  { name: 'Esther',          abbrevs: ['est'] },
  { name: 'Job',             abbrevs: ['job'] },
  { name: 'Psalms',          abbrevs: ['ps','psa'] },
  { name: 'Proverbs',        abbrevs: ['prov'] },
  { name: 'Ecclesiastes',    abbrevs: ['eccl'] },
  { name: 'Song of Solomon', abbrevs: ['song','sos'] },
  { name: 'Isaiah',          abbrevs: ['isa'] },
  { name: 'Jeremiah',        abbrevs: ['jer'] },
  { name: 'Lamentations',    abbrevs: ['lam'] },
  { name: 'Ezekiel',         abbrevs: ['ezek'] },
  { name: 'Daniel',          abbrevs: ['dan'] },
  { name: 'Hosea',           abbrevs: ['hos'] },
  { name: 'Joel',            abbrevs: ['joel'] },
  { name: 'Amos',            abbrevs: ['amos'] },
  { name: 'Obadiah',         abbrevs: ['obad'] },
  { name: 'Jonah',           abbrevs: ['jon'] },
  { name: 'Micah',           abbrevs: ['mic'] },
  { name: 'Nahum',           abbrevs: ['nah'] },
  { name: 'Habakkuk',        abbrevs: ['hab'] },
  { name: 'Zephaniah',       abbrevs: ['zeph'] },
  { name: 'Haggai',          abbrevs: ['hag'] },
  { name: 'Zechariah',       abbrevs: ['zech'] },
  { name: 'Malachi',         abbrevs: ['mal'] },
  { name: 'Matthew',         abbrevs: ['matt','mt'] },
  { name: 'Mark',            abbrevs: ['mk','mrk'] },
  { name: 'Luke',            abbrevs: ['lk','luk'] },
  { name: 'John',            abbrevs: ['jn','jhn'] },
  { name: 'Acts',            abbrevs: ['acts'] },
  { name: 'Romans',          abbrevs: ['rom'] },
  { name: '1 Corinthians',   abbrevs: ['1cor'] },
  { name: '2 Corinthians',   abbrevs: ['2cor'] },
  { name: 'Galatians',       abbrevs: ['gal'] },
  { name: 'Ephesians',       abbrevs: ['eph'] },
  { name: 'Philippians',     abbrevs: ['phil'] },
  { name: 'Colossians',      abbrevs: ['col'] },
  { name: '1 Thessalonians', abbrevs: ['1thess'] },
  { name: '2 Thessalonians', abbrevs: ['2thess'] },
  { name: '1 Timothy',       abbrevs: ['1tim'] },
  { name: '2 Timothy',       abbrevs: ['2tim'] },
  { name: 'Titus',           abbrevs: ['titus'] },
  { name: 'Philemon',        abbrevs: ['phlm'] },
  { name: 'Hebrews',         abbrevs: ['heb'] },
  { name: 'James',           abbrevs: ['jas','jam'] },
  { name: '1 Peter',         abbrevs: ['1pet'] },
  { name: '2 Peter',         abbrevs: ['2pet'] },
  { name: '1 John',          abbrevs: ['1jn'] },
  { name: '2 John',          abbrevs: ['2jn'] },
  { name: '3 John',          abbrevs: ['3jn'] },
  { name: 'Jude',            abbrevs: ['jude'] },
  { name: 'Revelation',      abbrevs: ['rev'] },
];

// Detect a spoken/typed scripture reference. Colon optional, space works too.
// e.g. "John 3:16", "John 3 16", "First Corinthians 13 4"
const SCRIPTURE_REF_RE = /\b(?:(?:first|second|third|1st|2nd|3rd|1|2|3)\s+)?(?:genesis|gen|exodus|exod?|leviticus|lev|numbers|num|deuteronomy|deut|joshua|josh|judges|judg|ruth|(?:first|second|1st?|2nd?)\s*samuel|samuel|sam|(?:first|second|1st?|2nd?)\s*kings|kings|(?:first|second|1st?|2nd?)\s*chronicles|chronicles|chron|ezra|nehemiah|neh|esther|est|job|psalms?|ps|proverbs?|prov|ecclesiastes|eccl|song(?:\s*of\s*solomon)?|isaiah|isa|jeremiah|jer|lamentations|lam|ezekiel|ezek|daniel|dan|hosea|hos|joel|amos|obadiah|jonah|micah|mic|nahum|nah|habakkuk|hab|zephaniah|zeph|haggai|hag|zechariah|zech|malachi|mal|matthew|matt|mark|luke|john|acts|romans|rom|(?:first|second|1st?|2nd?)\s*corinthians|corinthians|cor|galatians|gal|ephesians|eph|philippians|phil|colossians|col|(?:first|second|1st?|2nd?)\s*thessalonians|thessalonians|thess|(?:first|second|1st?|2nd?)\s*timothy|timothy|tim|titus|philemon|phlm|hebrews|heb|james|jas|(?:first|second|1st?|2nd?)\s*peter|peter|pet|(?:first|second|third|1st?|2nd?|3rd?)\s*john|jude|revelation|rev)\s+(\d+)(?:[: ](\d+))?/i;

// Stricter regex used to inline-highlight references in the live transcript.
// Requires the explicit "chapter:verse" colon (or dot) form so partial phrases
// like "John 3" or "Acts 5 minutes" don't get falsely linked. The /g flag is
// required for the highlighter's exec loop; consumers must reset .lastIndex
// before each pass.
const INLINE_REF_RE = new RegExp(
  '\\b(?:(?:1st|2nd|3rd|1|2|3|First|Second|Third)\\s+)?' +
  '(?:Genesis|Gen|Exodus|Exod?|Leviticus|Lev|Numbers|Num|Deuteronomy|Deut|' +
  'Joshua|Josh|Judges|Judg|Ruth|Samuel|Sam|Kings|Kgs|Chronicles|Chron|Chr|' +
  'Ezra|Nehemiah|Neh|Esther|Est|Job|Psalms?|Psa?|Proverbs?|Prov|' +
  'Ecclesiastes|Eccl|Song(?:\\s+of\\s+Solomon)?|Isaiah|Isa|Jeremiah|Jer|' +
  'Lamentations|Lam|Ezekiel|Ezek|Daniel|Dan|Hosea|Hos|Joel|Amos|Obadiah|Obad|' +
  'Jonah|Jon|Micah|Mic|Nahum|Nah|Habakkuk|Hab|Zephaniah|Zeph|Haggai|Hag|' +
  'Zechariah|Zech|Malachi|Mal|Matthew|Matt|Mt|Mark|Mk|Luke|Lk|John|Jhn|Jn|Acts|' +
  'Romans|Rom|Corinthians|Cor|Galatians|Gal|Ephesians|Eph|Philippians|Phil|' +
  'Colossians|Col|Thessalonians|Thess|Timothy|Tim|Titus|Tit|Philemon|Phlm|' +
  'Hebrews|Heb|James|Jas|Peter|Pet|Jude|Revelation|Rev)' +
  '\\s+(\\d{1,3})\\s*[:.]\\s*(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?\\b',
  'gi'
);

// Walk `text` and produce safe HTML where any digit-form scripture reference
// is wrapped in <a class="scripture-ref" data-ref="…">. Non-match regions are
// run through escapeHtml so the result is still safe to assign via innerHTML.
// The data-ref attribute carries the same string the user sees, so click
// handlers can hand it to parseReference().
function highlightScriptureRefs(text) {
  if (!text) return '';
  let out = '';
  let lastIndex = 0;
  INLINE_REF_RE.lastIndex = 0;
  let m;
  while ((m = INLINE_REF_RE.exec(text)) !== null) {
    out += escapeHtml(text.slice(lastIndex, m.index));
    const matched = m[0];
    const safe = escapeHtml(matched);
    out += `<a class="scripture-ref" data-ref="${safe}" title="Click to queue · Shift-click or double-click to project">${safe}</a>`;
    lastIndex = m.index + matched.length;
  }
  out += escapeHtml(text.slice(lastIndex));
  return out;
}

// Stop-word list for keyword-based prediction. Tuned to keep short
// theological words (sin, God, law, ark, joy) by filtering on length > 2
// at the call site rather than including those words here.
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','is','are',
  'was','were','be','been','being','have','has','had','do','does','did','will','would',
  'shall','should','may','might','must','can','could','that','this','these','those',
  'i','you','he','she','it','we','they','what','which','who','when','where','why',
  'how','all','each','every','both','few','more','most','other','some','such','no',
  'nor','not','only','own','same','so','than','too','very','just','as','said','going',
  'come','know','our','your','his','her','their','there','here','about','from',
]);

// Chapter counts for all 66 books (canonical order matches BIBLE_BOOKS)
const BIBLE_CHAPTER_COUNTS = [
  50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,
  12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,
  28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,4,3,5,3
];
