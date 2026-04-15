/**
 * bundle-kjv.js — Downloads the full KJV Bible from getbible.net and saves
 * it to data/translations/kjv.json so the app can seed it on first launch
 * without needing an internet connection.
 *
 * Usage:
 *   node scripts/bundle-kjv.js
 *   npm run bundle:kjv
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TRANSLATIONS = [
  { abbr: 'kjv',  name: 'King James Version',         language: 'English' },
];

// Pass extra abbrs as CLI args: node bundle-kjv.js asv web
const extra = process.argv.slice(2);
if (extra.length) {
  extra.forEach(a => {
    if (!TRANSLATIONS.find(t => t.abbr === a.toLowerCase())) {
      TRANSLATIONS.push({ abbr: a.toLowerCase(), name: a.toUpperCase() + ' Bible', language: 'English' });
    }
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'BibleCast/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function convertGetbible(raw) {
  const verses = [];
  // API v2 new format: { translation, books: [ { name, chapters: [ { chapter, verses: [ { verse, text } ] } ] } ] }
  const books = Array.isArray(raw.books) ? raw.books : Object.values(raw.books || {});
  for (const bookData of books) {
    const bookName = bookData.name;
    const chapters = Array.isArray(bookData.chapters) ? bookData.chapters : Object.values(bookData.chapters || {});
    for (const chapterData of chapters) {
      const chapterNum = chapterData.chapter;
      const verseList  = Array.isArray(chapterData.verses) ? chapterData.verses : Object.values(chapterData.verses || {});
      for (const verseData of verseList) {
        const text = (verseData.text || '').trim().replace(/\s+/g, ' ');
        if (text) {
          verses.push({
            book:    bookName,
            chapter: parseInt(chapterNum, 10),
            verse:   parseInt(verseData.verse, 10),
            text,
          });
        }
      }
    }
  }
  return verses;
}

async function bundleTranslation({ abbr, name, language }) {
  const url = `https://api.getbible.net/v2/${abbr}.json`;
  console.log(`Downloading ${abbr.toUpperCase()} from ${url} …`);

  const raw  = await httpGet(url);
  const data = JSON.parse(raw);
  const verses = convertGetbible(data);

  if (!verses.length) throw new Error(`No verses parsed for ${abbr}`);

  const outDir = path.join(__dirname, '..', 'data', 'translations');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, `${abbr}.json`);
  fs.writeFileSync(outPath, JSON.stringify(verses), 'utf-8');

  console.log(`✓ ${name} — ${verses.length.toLocaleString()} verses → ${outPath}`);
  return { abbr, name, language, count: verses.length };
}

(async () => {
  let success = 0;
  for (const t of TRANSLATIONS) {
    try {
      await bundleTranslation(t);
      success++;
    } catch (err) {
      console.error(`✗ ${t.abbr}: ${err.message}`);
    }
  }
  console.log(`\nDone — ${success}/${TRANSLATIONS.length} translation(s) bundled.`);
})();
