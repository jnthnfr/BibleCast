#!/usr/bin/env python3
"""
BibleCast — Bible Gateway Scraper
Scrapes a single translation via the `meaningless` library.
Outputs newline-delimited JSON to stdout so the Electron main process
can stream progress in real time.

Usage: python scrape_bible.py <ABBR>
  e.g. python scrape_bible.py NIV
"""

import sys
import json
import subprocess

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def emit(obj):
    """Write a JSON object as one line to stdout and flush immediately."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def ensure_meaningless():
    """Install meaningless if it is not already available."""
    try:
        import meaningless  # noqa: F401
        return True
    except ImportError:
        emit({'type': 'status', 'msg': 'Installing meaningless package…'})
        try:
            subprocess.check_call(
                [sys.executable, '-m', 'pip', 'install', 'meaningless', '-q'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            emit({'type': 'status', 'msg': 'Package installed.'})
            return True
        except subprocess.CalledProcessError as exc:
            emit({'type': 'error', 'msg': f'pip install failed (exit {exc.returncode}). '
                  'Please run: pip install meaningless'})
            return False


# ---------------------------------------------------------------------------
# Book list (canonical order, 66 books)
# ---------------------------------------------------------------------------

BOOKS = [
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
    'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
    '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
    'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
    'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
    'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
    'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah',
    'Haggai', 'Zechariah', 'Malachi',
    'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans',
    '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
    'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
    '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
    'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
    'Jude', 'Revelation',
]

# ---------------------------------------------------------------------------
# Flatten whatever structure meaningless returns into our flat-array format
# ---------------------------------------------------------------------------

def flatten_book(book_name, raw):
    """
    Convert a meaningless book result to a list of
    {book, chapter, verse, text} dicts.

    Handles multiple possible return shapes:
      - dict  {chap_str: {verse_str: text_str}}       — most common
      - dict  {chap_str: [text1, text2, …]}            — older versions
      - list  [{chapter, verse, text}, …]              — rare
    """
    verses = []

    if isinstance(raw, dict):
        for chap_key, chap_val in raw.items():
            try:
                chap_num = int(chap_key)
            except (ValueError, TypeError):
                continue

            if isinstance(chap_val, dict):
                for verse_key, text in chap_val.items():
                    try:
                        verse_num = int(verse_key)
                    except (ValueError, TypeError):
                        continue
                    if text and isinstance(text, str):
                        verses.append({
                            'book': book_name,
                            'chapter': chap_num,
                            'verse': verse_num,
                            'text': text.strip().replace('\n', ' '),
                        })

            elif isinstance(chap_val, list):
                for v_idx, text in enumerate(chap_val, 1):
                    if text and isinstance(text, str):
                        verses.append({
                            'book': book_name,
                            'chapter': chap_num,
                            'verse': v_idx,
                            'text': text.strip().replace('\n', ' '),
                        })

    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and item.get('text'):
                verses.append({
                    'book': book_name,
                    'chapter': int(item.get('chapter', 1)),
                    'verse': int(item.get('verse', 1)),
                    'text': str(item['text']).strip().replace('\n', ' '),
                })

    return verses


# ---------------------------------------------------------------------------
# Main scrape routine
# ---------------------------------------------------------------------------

def scrape(abbr):
    if not ensure_meaningless():
        sys.exit(1)

    try:
        from meaningless import BibleGatewayExtractor
    except ImportError:
        emit({'type': 'error', 'msg': 'meaningless import failed after install attempt.'})
        sys.exit(1)

    emit({'type': 'status', 'msg': f'Connecting to Bible Gateway ({abbr.upper()})…'})

    try:
        extractor = BibleGatewayExtractor(
            translation=abbr.upper(),
            show_passage_numbers=False,
            show_verse_numbers=False,
        )
    except Exception as exc:
        emit({'type': 'error', 'msg': f'Could not create extractor: {exc}'})
        sys.exit(1)

    all_verses = []
    total = len(BOOKS)

    for idx, book in enumerate(BOOKS):
        emit({'type': 'progress', 'book': book, 'done': idx, 'total': total})

        try:
            raw = extractor.get_book(book)
            book_verses = flatten_book(book, raw)
            all_verses.extend(book_verses)
        except KeyboardInterrupt:
            emit({'type': 'error', 'msg': 'Cancelled.'})
            sys.exit(130)
        except Exception as exc:
            emit({'type': 'warning', 'book': book, 'msg': str(exc)})

    emit({'type': 'done', 'count': len(all_verses), 'verses': all_verses})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if len(sys.argv) < 2:
        emit({'type': 'error', 'msg': 'Usage: scrape_bible.py <TRANSLATION_ABBR>'})
        sys.exit(1)

    scrape(sys.argv[1].strip())
