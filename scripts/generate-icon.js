/**
 * generate-icon.js
 * Generates assets/icons/icon.ico — a 32x32 ICO with a blue cross on dark background.
 * Pure Node.js, no extra dependencies.
 * Usage: node scripts/generate-icon.js
 */

const fs   = require('fs');
const path = require('path');

const SIZE   = 32;
const W      = SIZE;
const H      = SIZE;

// colours (BGRA for BMP)
const BG     = [0x1a, 0x1a, 0x2e, 0xff]; // dark navy
const CROSS  = [0xdb, 0x56, 0x1a, 0xff]; // #1a56db — blue (BMP stores BGR so reversed)

// --- build pixel grid ---
const pixels = [];
const armW = Math.round(W * 0.22); // cross arm thickness (~7px)
const vCx  = Math.floor(W / 2);
const hCy  = Math.floor(H / 2);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inVert = x >= vCx - Math.floor(armW / 2) && x < vCx - Math.floor(armW / 2) + armW;
    const inHorz = y >= hCy - Math.floor(armW / 2) && y < hCy - Math.floor(armW / 2) + armW;
    pixels.push(inVert || inHorz ? CROSS : BG);
  }
}

// --- BMP DIB header (BITMAPINFOHEADER = 40 bytes) ---
// ICO bitmaps are stored bottom-up and use a combined height = H*2 (XOR + AND mask)
function bmpData(w, h, pixelRows) {
  const rowBytes  = w * 4;
  const imgHeight = h * 2; // XOR + AND mask
  const buf = Buffer.alloc(40 + rowBytes * h + Math.ceil(w / 8) * h);
  let o = 0;

  // BITMAPINFOHEADER
  buf.writeUInt32LE(40, o);          o += 4; // biSize
  buf.writeInt32LE(w, o);            o += 4; // biWidth
  buf.writeInt32LE(imgHeight, o);    o += 4; // biHeight (XOR+AND)
  buf.writeUInt16LE(1, o);           o += 2; // biPlanes
  buf.writeUInt16LE(32, o);          o += 2; // biBitCount
  buf.writeUInt32LE(0, o);           o += 4; // biCompression (BI_RGB)
  buf.writeUInt32LE(rowBytes * h, o);o += 4; // biSizeImage
  buf.writeInt32LE(0, o);            o += 4; // biXPelsPerMeter
  buf.writeInt32LE(0, o);            o += 4; // biYPelsPerMeter
  buf.writeUInt32LE(0, o);           o += 4; // biClrUsed
  buf.writeUInt32LE(0, o);           o += 4; // biClrImportant

  // XOR pixel data — BMP is bottom-up, so write rows in reverse
  for (let row = h - 1; row >= 0; row--) {
    for (let col = 0; col < w; col++) {
      const [b, g, r, a] = pixelRows[row * w + col];
      buf[o++] = b;
      buf[o++] = g;
      buf[o++] = r;
      buf[o++] = a;
    }
  }

  // AND mask (all 0 = fully opaque) — bottom-up, padded to 4-byte rows
  const maskRowBytes = Math.ceil(w / 8);
  for (let row = h - 1; row >= 0; row--) {
    for (let b = 0; b < maskRowBytes; b++) buf[o++] = 0x00;
  }

  return buf;
}

const imgData = bmpData(W, H, pixels);

// --- ICO file structure ---
// ICONDIR (6) + ICONDIRENTRY (16) + image data
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);  // reserved
icoHeader.writeUInt16LE(1, 2);  // type = 1 (ICO)
icoHeader.writeUInt16LE(1, 4);  // count = 1 image

const entry = Buffer.alloc(16);
entry.writeUInt8(W === 256 ? 0 : W, 0);  // width  (0 = 256)
entry.writeUInt8(H === 256 ? 0 : H, 1);  // height (0 = 256)
entry.writeUInt8(0, 2);   // colour count (0 = >8bpp)
entry.writeUInt8(0, 3);   // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bit count
entry.writeUInt32LE(imgData.length, 8);  // size of image data
entry.writeUInt32LE(6 + 16, 12);         // offset from start of file

const ico = Buffer.concat([icoHeader, entry, imgData]);

const outDir  = path.join(__dirname, '..', 'assets', 'icons');
const outFile = path.join(outDir, 'icon.ico');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, ico);
console.log(`Generated ${outFile} (${ico.length} bytes)`);
