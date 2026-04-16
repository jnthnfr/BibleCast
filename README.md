# BibleCast

A desktop application for church presenters to search, select, and project Bible scriptures onto a second screen during preaching — live, full-screen, and distraction-free.

---

## Screenshots

> Operator panel on the primary monitor. Projection window on the second screen (HDMI/display port).

---

## Features

### Scripture
- **Verse search** — Search by reference (`John 3:16`) or keyword (`grace`)
- **One-click projection** — Push any verse to the full-screen display window instantly
- **Blank / unblank display** — Hide the screen between verses without closing the window
- **Multiple Bible translations** — 14 free public-domain translations downloadable in-app (KJV, ASV, WEB, YLT, BBE, and more)
- **Bible Gateway Scraper** — Download 29 additional translations (ESV, NIV, NASB, NKJV, NLT, AMP, CSB and more) via a built-in Python scraper
- **Import custom translations** — Load any Bible from a JSON or XML file

### Live Transcription & AI
- **Vosk speech recognition** — Real-time offline transcription (word-by-word, ~45 MB model, no internet required)
- **Whisper AI** — High-accuracy offline transcription via @xenova/transformers (CPU and GPU modes)
- **Scripture auto-detection** — Detects spoken references (e.g. "John three sixteen") and suggests matching verses automatically
- **Auto-projection** — Optionally push detected verses to the display without touching the keyboard
- **Voice commands** — Control the display by speaking: "next verse", "clear screen", "repeat", etc.
- **Sermon summary** — Keyword-based local summary or GPT-3.5 AI summary (requires OpenAI key)

### Display & Output
- **HDMI output** — Full-screen projection on a second monitor, auto-detected
- **NDI virtual output** — Broadcast verses as a network video source (OBS / vMix compatible)
- **Lower-third layout** — Full-screen or lower-third overlay mode per output
- **Themes** — Dark, light, and royal blue projection themes
- **Custom backgrounds** — Solid colour, gradient, or image background per output
- **Font size control** — Adjustable text size for any venue
- **Transition speed** — Configurable fade speed between verses

### Sessions & History
- **Session management** — Track each service as a named session; every projected verse is logged
- **History** — Browse past sessions and all verses displayed in each service
- **Display preview** — Live mirror of the projection screen in the operator panel
- **Auto-session** — Optionally create a session automatically on launch

### Application
- **Multi-monitor support** — Projection window auto-placed on the second display
- **GPU acceleration** — WebGPU-accelerated Whisper AI on supported hardware
- **Fully offline** — No cloud account required; all core features work without internet
- **Update checker** — Notifies when a new release is available on GitHub

---

## Translation Sources

### Source 1 — getbible.net (in-app download, no setup)

Free public-domain translations, downloaded directly from the app:

| Abbreviation | Name | Language |
|---|---|---|
| KJV | King James Version (1611) | English |
| ASV | American Standard Version (1901) | English |
| WEB | World English Bible | English |
| YLT | Young's Literal Translation (1898) | English |
| BBE | Bible in Basic English | English |
| DBY | Darby Translation (1890) | English |
| WBS | Webster Bible (1833) | English |
| HNV | Hebrew Names Version | English |
| OEB | Open English Bible | English |
| AFR | Afrikaans Bible (1953) | Afrikaans |
| RVR60 | Reina-Valera (1960) | Spanish |
| LS1910 | Louis Segond (1910) | French |
| LUT | Luther Bibel (1912) | German |
| ALMEIDA | Almeida Revista e Corrigida | Portuguese |

### Source 2 — Bible Gateway Scraper (requires Python 3)

29 additional translations scraped via the built-in scraper (Settings → Bibles → Open Bible Gateway Scraper):

`AMP` `AKJV` `ASV` `BRG` `CSB` `EHV` `ESV` `ESVUK` `GNV` `GW` `ISV` `JUB` `KJV` `KJ21` `LEB` `MEV` `NASB` `NASB1995` `NET` `NIV` `NIVUK` `NKJV` `NLT` `NLV` `NOG` `NRSV` `NRSVUE` `WEB` `YLT`

> Translations marked © are copyrighted. Scrape for personal / local church use only.

---

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 LTS or later | |
| npm | 10+ | |
| Windows | 10 / 11 x64 | |
| Python 3 | 3.8+ | Optional — required for Bible Gateway Scraper only |

### Install

```bash
git clone https://github.com/jnthnfr/BibleCast.git
cd BibleCast
npm install
npm run rebuild
```

> `npm run rebuild` compiles `better-sqlite3` against Electron's Node.js ABI. Required after first install and after any Electron version change.

### Run

```bash
npm start
```

The app opens the operator panel on your primary monitor. The projection window is toggled from the **Outputs** tab in the right sidebar.

### Load Bible data

KJV is bundled and loads automatically on first launch. To add more:

1. Go to **Settings → Bibles**
2. Click **↓ Download** next to any translation (getbible.net source)
3. Or click **Open Bible Gateway Scraper…** for ESV, NIV, NASB, and 26 more (requires Python 3)

---

## Project Structure

```
BibleCast/
├── main.js                  # Electron main process — windows, IPC, database
├── preload.js               # contextBridge — window.biblecast API for renderers
├── src/
│   ├── renderer/            # Operator panel (primary screen)
│   │   ├── index.html
│   │   ├── renderer.js
│   │   └── styles.css
│   ├── display/             # Projection window (second monitor / NDI)
│   │   ├── display.html
│   │   ├── display.js
│   │   └── display.css
│   ├── scraper/             # Bible Gateway scraper popup
│   │   ├── scraper.html
│   │   ├── scraper.js
│   │   └── scraper.css
│   ├── whisper/             # GPU worker window for Whisper AI
│   │   ├── whisper-gpu.html
│   │   └── whisper-gpu.js
│   └── lib/
│       ├── db.js            # SQLite schema + all query functions
│       └── bible-parser.js  # Scripture reference parser
├── scripts/
│   ├── launch.js            # npm start wrapper
│   ├── scrape_bible.py      # Python Bible Gateway scraper (used by popup)
│   ├── seed-db.js           # CLI seeder for local JSON files
│   └── download-translations.js  # Downloads public domain translations
├── data/
│   └── translations/        # Bundled KJV JSON (auto-seeded on first launch)
├── assets/icons/            # App icons
├── electron-builder.json    # Build / installer config
└── DEVELOPER.md             # Full developer guide
```

---

## Import a Custom Translation

BibleCast accepts any Bible in flat JSON format:

```json
[
  { "book": "Genesis", "chapter": 1, "verse": 1, "text": "In the beginning..." },
  { "book": "John",    "chapter": 3, "verse": 16, "text": "For God so loved..." }
]
```

Also accepts **XML** (Holy Bible XML / OSIS / Zefania formats).

**Via the app:** Settings → Bibles → Import JSON / XML File

---

## Build Installer

```bash
npm run build
```

Produces a Windows NSIS installer at `dist/BibleCast Setup 1.0.x.exe`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 32 |
| UI | HTML / CSS / Vanilla JS |
| Database | SQLite via better-sqlite3 |
| IPC | Electron contextBridge + ipcMain/ipcRenderer |
| Speech (real-time) | Vosk via vosk-browser (WASM, fully offline) |
| Speech (accurate) | Whisper AI via @xenova/transformers (CPU + WebGPU) |
| Bible scraper | Python 3 + meaningless (Bible Gateway) |
| Build | electron-builder (NSIS installer) |
| Bible data — source 1 | getbible.net (public domain API) |
| Bible data — source 2 | Bible Gateway via Python scraper |

---

## License

MIT
