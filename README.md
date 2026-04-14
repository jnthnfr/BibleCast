# BibleCast

A desktop application for church presenters to search, select, and project Bible scriptures onto a second screen during preaching — live, full-screen, and distraction-free.

---

## Screenshots

> Operator panel on the primary monitor. Projection window on the second screen (HDMI/display port).

---

## Features

- **Verse search** — Search by reference (`John 3:16`) or keyword (`grace`)
- **One-click projection** — Push any verse to the full-screen display window instantly
- **Multiple Bible translations** — Download 14+ free public-domain translations (KJV, ASV, WEB, YLT, BBE, and more) directly from the app
- **Import custom translations** — Load any Bible translation from a JSON file
- **Blank / unblank display** — Hide the screen between verses without closing the window
- **Session management** — Track each service as a named session; every projected verse is logged
- **History** — Browse past sessions and all verses displayed in each service
- **Display preview** — See exactly what's on the projection screen from the operator panel
- **Themes** — Dark, light, and royal blue projection themes
- **Font size control** — Adjustable text size for any venue
- **Multi-monitor support** — Projection window automatically opens on the second connected display
- **Fully offline** — No cloud account or internet connection required after translations are downloaded

---

## Supported Translations

All downloadable translations are public domain or freely licensed:

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

> Copyrighted translations (NIV, ESV, NKJV, NLT) cannot be bundled. If you hold a licence, import them via **Settings → Import JSON File**.

---

## Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20 LTS or later |
| npm | 10+ |
| Windows | 10 / 11 x64 |

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

The app opens two windows:
- **Operator panel** — your primary monitor (search, push, sessions)
- **Projection window** — your second monitor (full-screen verse display)

### Load Bible data

On first launch you'll be prompted to go to **Settings**. From there:

1. Click **↓ Download** next to any translation
2. Wait a few seconds while it downloads (~3 MB per translation)
3. Switch to the **Search** tab and start searching

Or download all translations at once from the terminal:

```bash
npm run download
```

To download a specific translation:

```bash
npm run download:kjv
# or
node scripts/download-translations.js asv web ylt
```

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
│   ├── display/             # Projection window (second monitor)
│   │   ├── display.html
│   │   ├── display.js
│   │   └── display.css
│   └── lib/
│       ├── db.js            # SQLite schema + all query functions
│       └── bible-parser.js  # Scripture reference parser
├── data/
│   └── sample-kjv.js        # Bundled sample verses (fallback)
├── scripts/
│   ├── launch.js            # npm start wrapper (clears ELECTRON_RUN_AS_NODE)
│   ├── seed-db.js           # CLI seeder for local JSON files
│   └── download-translations.js  # Downloads public domain translations
├── assets/icons/            # App icons
├── electron-builder.json    # Build / installer config
└── DEVELOPER.md             # Full developer guide
```

---

## Import a Custom Translation

BibleCast accepts any Bible in this JSON format:

```json
[
  { "book": "Genesis", "chapter": 1, "verse": 1, "text": "In the beginning..." },
  { "book": "John",    "chapter": 3, "verse": 16, "text": "For God so loved..." }
]
```

**Via the app:** Settings → Import JSON File → select your file.

**Via the CLI:**

```bash
node scripts/seed-db.js path/to/translation.json "Full Name" "ABBR" "Language"
```

---

## Build Installer

```bash
npm run build
```

Produces a Windows NSIS installer at `dist/BibleCast Setup 1.0.0.exe`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 32 |
| UI | HTML / CSS / Vanilla JS |
| Database | SQLite via better-sqlite3 |
| IPC | Electron contextBridge + ipcMain/ipcRenderer |
| Build | electron-builder |
| Bible data source | [getbible.net](https://getbible.net) (public domain API) |

---

## Contributing

Pull requests are welcome. For major changes please open an issue first.

---

## License

MIT
