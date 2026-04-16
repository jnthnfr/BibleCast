#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BibleCast — Bible Gateway Scraper
Uses the `meaningless` library (WebExtractor) to download one translation.
Outputs newline-delimited JSON to stdout for real-time Electron progress.

Usage: python scrape_bible.py <ABBR>
  e.g. python scrape_bible.py NIV
"""

import sys
import json
import re
import subprocess

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def emit(obj):
    line = json.dumps(obj, ensure_ascii=False)
    sys.stdout.buffer.write((line + '\n').encode('utf-8'))
    sys.stdout.buffer.flush()


def ensure_meaningless():
    try:
        from meaningless import WebExtractor  # noqa: F401
        return True
    except ImportError:
        emit({'type': 'status', 'msg': 'Installing meaningless package…'})
        try:
            subprocess.check_call(
                [sys.executable, '-m', 'pip', 'install', 'meaningless', '-q'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except subprocess.CalledProcessError as exc:
            emit({'type': 'error', 'msg': f'pip install failed (exit {exc.returncode}). '
                  'Please run manually: pip install meaningless'})
            return False


# ---------------------------------------------------------------------------
# Superscript verse-number parser
# ---------------------------------------------------------------------------

# Unicode superscript → ASCII digit map
_SUP = {'⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
        '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9'}
_SUP_RE = re.compile(r'[⁰¹²³⁴⁵⁶⁷⁸⁹]+')


def _sup_to_int(s):
    return int(''.join(_SUP[c] for c in s))


def parse_chapter_string(raw_text):
    """
    Convert a meaningless chapter string into {verse_num: text} dict.

    The library omits the superscript marker on verse 1 — all text before
    the first superscript run is verse 1.
    """
    verses = {}
    # Split on superscript runs, keeping the delimiters
    parts = _SUP_RE.split(raw_text)
    markers = _SUP_RE.findall(raw_text)

    # parts[0] is text before any marker → verse 1
    v1 = parts[0].strip()
    if v1:
        verses[1] = v1

    for i, marker in enumerate(markers):
        verse_num = _sup_to_int(marker)
        text = parts[i + 1].strip() if i + 1 < len(parts) else ''
        if text:
            verses[verse_num] = text

    return verses


# ---------------------------------------------------------------------------
# Chapter counts for all 66 canonical books
# ---------------------------------------------------------------------------

BOOKS = [
    ('Genesis',          50), ('Exodus',           40), ('Leviticus',        27),
    ('Numbers',          36), ('Deuteronomy',       34), ('Joshua',           24),
    ('Judges',           21), ('Ruth',               4), ('1 Samuel',         31),
    ('2 Samuel',         24), ('1 Kings',            22), ('2 Kings',          25),
    ('1 Chronicles',     29), ('2 Chronicles',       36), ('Ezra',             10),
    ('Nehemiah',         13), ('Esther',             10), ('Job',              42),
    ('Psalms',          150), ('Proverbs',           31), ('Ecclesiastes',     12),
    ('Song of Solomon',   8), ('Isaiah',             66), ('Jeremiah',         52),
    ('Lamentations',      5), ('Ezekiel',            48), ('Daniel',           12),
    ('Hosea',            14), ('Joel',                3), ('Amos',              9),
    ('Obadiah',           1), ('Jonah',               4), ('Micah',             7),
    ('Nahum',             3), ('Habakkuk',            3), ('Zephaniah',         3),
    ('Haggai',            2), ('Zechariah',          14), ('Malachi',           4),
    ('Matthew',          28), ('Mark',               16), ('Luke',             24),
    ('John',             21), ('Acts',               28), ('Romans',           16),
    ('1 Corinthians',    16), ('2 Corinthians',      13), ('Galatians',         6),
    ('Ephesians',         6), ('Philippians',         4), ('Colossians',        4),
    ('1 Thessalonians',   5), ('2 Thessalonians',     3), ('1 Timothy',         6),
    ('2 Timothy',         4), ('Titus',               3), ('Philemon',          1),
    ('Hebrews',          13), ('James',               5), ('1 Peter',           5),
    ('2 Peter',           3), ('1 John',              5), ('2 John',            1),
    ('3 John',            1), ('Jude',                1), ('Revelation',       22),
]

TOTAL_CHAPTERS = sum(c for _, c in BOOKS)  # 1189


# ---------------------------------------------------------------------------
# Main scrape
# ---------------------------------------------------------------------------

def scrape(abbr):
    if not ensure_meaningless():
        sys.exit(1)

    try:
        from meaningless import WebExtractor
    except ImportError:
        emit({'type': 'error', 'msg': 'Could not import meaningless after install.'})
        sys.exit(1)

    emit({'type': 'status', 'msg': f'Connecting to Bible Gateway ({abbr.upper()})…'})

    try:
        extractor = WebExtractor(
            translation=abbr.upper(),
            show_passage_numbers=True,   # superscript verse numbers needed for parsing
        )
    except Exception as exc:
        emit({'type': 'error', 'msg': f'Could not create extractor: {exc}'})
        sys.exit(1)

    all_verses = []
    chapters_done = 0
    book_index = 0

    for book, num_chapters in BOOKS:
        emit({'type': 'progress', 'book': book, 'done': book_index, 'total': len(BOOKS)})
        book_index += 1

        for chap in range(1, num_chapters + 1):
            try:
                raw = extractor.get_chapter(book, chap)
                parsed = parse_chapter_string(raw)
                for verse_num, text in sorted(parsed.items()):
                    if text:
                        all_verses.append({
                            'book':    book,
                            'chapter': chap,
                            'verse':   verse_num,
                            'text':    text,
                        })
            except KeyboardInterrupt:
                emit({'type': 'error', 'msg': 'Cancelled.'})
                sys.exit(130)
            except Exception as exc:
                emit({'type': 'warning', 'book': book,
                      'msg': f'Ch.{chap}: {exc}'})

            chapters_done += 1

    emit({'type': 'done', 'count': len(all_verses), 'verses': all_verses})


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if len(sys.argv) < 2:
        emit({'type': 'error', 'msg': 'Usage: scrape_bible.py <TRANSLATION_ABBR>'})
        sys.exit(1)
    scrape(sys.argv[1].strip())
