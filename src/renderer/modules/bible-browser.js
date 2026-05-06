/* BibleCast: Bible browser module
 *
 * Drill-down browser for picking a verse by book then chapter then verse.
 * Reads BIBLE_BOOKS and BIBLE_CHAPTER_COUNTS from modules/bible-data.js.
 * Calls into selectVerse / formatRef which still live in renderer.js;
 * those names resolve at call time once all classic <script> tags have
 * parsed.
 */

let bbSelectedBook = null;
let bbSelectedChapter = null;

function initBibleBrowser() {
  const booksEl    = document.getElementById('bb-books');
  const chaptersEl = document.getElementById('bb-chapters');
  const versesEl   = document.getElementById('bb-verses');
  const navEl      = document.getElementById('bb-nav');
  const crumbEl    = document.getElementById('bb-crumb');
  const backBtn    = document.getElementById('bb-back-btn');
  const backLbl    = document.getElementById('bb-back-label');

  // Populate book grid
  BIBLE_BOOKS.forEach((book, i) => {
    const btn = document.createElement('button');
    btn.textContent = book.name;
    btn.addEventListener('click', () => showChapters(book, i));
    booksEl.appendChild(btn);
  });

  function showChapters(book, bookIdx) {
    bbSelectedBook    = book;
    bbSelectedChapter = null;
    chaptersEl.innerHTML = '';
    const count = BIBLE_CHAPTER_COUNTS[bookIdx] || 50;
    for (let c = 1; c <= count; c++) {
      const btn = document.createElement('button');
      btn.textContent = c;
      btn.addEventListener('click', () => showVerses(book, c));
      chaptersEl.appendChild(btn);
    }
    booksEl.style.display    = 'none';
    chaptersEl.style.display = 'flex';
    versesEl.style.display   = 'none';
    navEl.style.display      = 'flex';
    crumbEl.textContent      = book.name;
    backLbl.textContent      = 'Books';
  }

  async function showVerses(book, chapter) {
    bbSelectedChapter = chapter;
    const translation = document.getElementById('translation-select')?.value || 'KJV';
    const query       = `${book.name} ${chapter}`;
    const results     = await api.searchVerses(query, translation);

    versesEl.innerHTML = '';
    if (!results.length) {
      versesEl.innerHTML = '<div style="padding:6px;font-size:0.78rem;color:var(--text-muted)">No verses found</div>';
    } else {
      results.forEach(v => {
        const item = document.createElement('div');
        item.className = 'bb-verse-item';
        item.innerHTML = `<div class="bb-vref">${escapeHtml(v.reference || formatRef(v))}</div><div class="bb-vtxt">${escapeHtml(v.text)}</div>`;
        item.addEventListener('click', () => {
          document.querySelectorAll('.result-item').forEach(i => i.classList.remove('selected'));
          selectVerse(v, null);
          // Mirror selection into the main results list
          const input = document.getElementById('search-input');
          if (input) input.value = v.reference || formatRef(v);
        });
        versesEl.appendChild(item);
      });
    }

    chaptersEl.style.display = 'none';
    versesEl.style.display   = 'block';
    crumbEl.textContent      = `${book.name} ${chapter}`;
    backLbl.textContent      = book.name;
  }

  backBtn.addEventListener('click', () => {
    if (versesEl.style.display !== 'none') {
      // Back to chapters
      versesEl.style.display   = 'none';
      chaptersEl.style.display = 'flex';
      crumbEl.textContent      = bbSelectedBook?.name || '';
      backLbl.textContent      = 'Books';
    } else {
      // Back to books
      chaptersEl.style.display = 'none';
      booksEl.style.display    = 'flex';
      navEl.style.display      = 'none';
      crumbEl.textContent      = '';
      bbSelectedBook    = null;
      bbSelectedChapter = null;
    }
  });
}
