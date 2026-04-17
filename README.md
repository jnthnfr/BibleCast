# BibleCast

A desktop app for church presenters that combines manual verse search with live sermon listening, automatically detecting spoken Bible verse references in real time and displaying the full verse text on a second screen. Operators can also search and push any verse to the display manually, giving full control whether the system catches a reference automatically or the presenter needs to queue one up on the fly.

---

## Features

- Verse search by reference or keyword
- One-click projection to HDMI output or NDI virtual source
- 14 free translations downloadable in-app + 29 more via Bible Gateway scraper (requires Python 3)
- Import any Bible from JSON or XML
- Live speech transcription (Vosk offline / Whisper AI)
- Auto-detects spoken scripture references and suggests verses
- Voice commands — next, previous, clear, repeat
- Sessions & history — every projected verse is logged
- Custom backgrounds, themes, font sizes, lower-third layout

---

## Requirements

- Node.js 20+
- Windows 10/11 x64
- Python 3 *(optional — Bible Gateway scraper only)*

---

## Setup

```bash
git clone https://github.com/jnthnfr/BibleCast.git
cd BibleCast
npm install
npm run rebuild
npm start
```

KJV loads automatically on first launch. Add more translations via **Settings → Bibles**.

---

## Build

```bash
npm run build
```

Outputs a Windows NSIS installer to `dist/`.

---

## License

MIT
