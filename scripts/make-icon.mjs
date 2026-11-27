#!/usr/bin/env node

/**
 * Generates build/icon.png (512x512) — the app icon for electron-builder.
 *
 * Dependency-free Node port of make-icon.py (same design: neutral-950
 * rounded square, emerald waveform over a piano-keyboard band — audio
 * in, MIDI out). It exists because the PNG is a generated asset that is
 * never committed (build/ is gitignored), so a fresh clone has no icon
 * and electron-builder silently falls back to the default Electron
 * icon. build.mjs runs this automatically when the icon is missing;
 * it can also be run directly from the repo root:
 *
 *   node scripts/make-icon.mjs
 *
 * Rendering is supersampled 2x and box-downsampled for clean edges.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const SIZE = 512;
const SS = 2; // supersampling factor
const W = SIZE * SS;

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT_DIR, 'build', 'icon.png');

// --- tiny RGBA rasteriser (source-over compositing) ---
const px = new Float32Array(W * W * 4); // r,g,b,a in 0..255 space, premultiplied-free

function blend(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 4;
  const sa = a / 255;
  const da = px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  px[i] = (r * sa + px[i] * da * (1 - sa)) / oa;
  px[i + 1] = (g * sa + px[i + 1] * da * (1 - sa)) / oa;
  px[i + 2] = (b * sa + px[i + 2] * da * (1 - sa)) / oa;
  px[i + 3] = oa * 255;
}

function fillRoundedRect(x0, y0, x1, y1, radius, color) {
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2);
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      // distance to the rect's inner core decides corner rounding
      const cx = Math.max(x0 + r - x, 0, x - (x1 - r));
      const cy = Math.max(y0 + r - y, 0, y - (y1 - r));
      if (cx * cx + cy * cy <= r * r) blend(x, y, color);
    }
  }
}

function strokePolyline(points, width, color) {
  const half = width / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const x0 = Math.floor(minX - half - 1), x1 = Math.ceil(maxX + half + 1);
  const y0 = Math.floor(minY - half - 1), y1 = Math.ceil(maxY + half + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let best = Infinity;
      for (let s = 0; s < points.length - 1; s++) {
        const [ax, ay] = points[s];
        const [bx, by] = points[s + 1];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        let t = ((x - ax) * dx + (y - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const ex = ax + t * dx - x, ey = ay + t * dy - y;
        const d2 = ex * ex + ey * ey;
        if (d2 < best) best = d2;
      }
      if (best <= half * half) blend(x, y, color);
    }
  }
}

const S = (v) => v * SS; // scale a 512-space coordinate to the render grid

// --- the design (coordinates in 512 space, as in make-icon.py) ---

// Rounded-square body
fillRoundedRect(S(8), S(8), S(SIZE - 8), S(SIZE - 8), S(96), [10, 10, 10, 255]);

// Emerald waveform (sine x decaying envelope), upper half — drawn in
// three passes (wide glow, mid, core) like the original.
const wavePoints = [];
for (let x = 86; x < SIZE - 85; x++) {
  const t = (x - 86) / (SIZE - 172);
  // max(0, ...): past t=1 the sine goes negative and pow() would return
  // NaN — and a single NaN point poisons the stroke's bounding box
  // (Math.min with NaN is NaN), silently erasing the whole waveform.
  const env = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.7);
  const y = 176 - Math.sin(t * Math.PI * 6) * 62 * env;
  wavePoints.push([S(x), S(y)]);
}
for (const [width, alpha] of [[15, 60], [9, 120], [5, 255]]) {
  strokePolyline(wavePoints, S(width), [16, 185, 129, alpha]);
}

// Piano keyboard band, lower half: 7 white keys, 5 black keys
const kx0 = 86, kx1 = SIZE - 86, ky0 = 292, ky1 = 424;
const keyW = (kx1 - kx0) / 7;
fillRoundedRect(S(kx0), S(ky0), S(kx1), S(ky1), S(10), [245, 245, 245, 255]);
for (let i = 1; i < 7; i++) {
  const x = kx0 + i * keyW;
  fillRoundedRect(S(x - 2), S(ky0 + 6), S(x + 2), S(ky1 - 6), 0, [38, 38, 38, 255]);
}
for (const i of [0, 1, 3, 4, 5]) { // black keys after white keys 1,2,4,5,6
  const cx = kx0 + (i + 1) * keyW;
  fillRoundedRect(
    S(cx - keyW * 0.30), S(ky0), S(cx + keyW * 0.30), S(ky0 + (ky1 - ky0) * 0.62),
    S(6), [23, 23, 23, 255]
  );
}

// --- downsample 2x (box average) ---
const out = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * W + (x * SS + dx)) * 4;
        r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3];
      }
    }
    const o = (y * SIZE + x) * 4;
    out[o] = r / (SS * SS); out[o + 1] = g / (SS * SS);
    out[o + 2] = b / (SS * SS); out[o + 3] = a / (SS * SS);
  }
}

// --- minimal PNG encoder (RGBA8, filter-0 rows, zlib from Node core) ---
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type RGBA
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 4)] = 0; // filter: none
  Buffer.from(out.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (1 + SIZE * 4) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${SIZE}x${SIZE})`);
