// Generates PNG icons procedurally so the repository contains no third-party
// art. Run with `pnpm icons`; output goes to public/icons/.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

const OUT_DIR = resolve(import.meta.dirname, "..", "public", "icons");
const SIZES = [16, 32, 48, 128];

// ---------------------------------------------------------------------------
// PNG encoding (RGBA8, no interlacing)
// ---------------------------------------------------------------------------

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
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Drawing. Everything is analytic shapes sampled with 4x4 supersampling.
// ---------------------------------------------------------------------------

const BG_TOP = [0x4f, 0x46, 0xe5]; // indigo-600
const BG_BOTTOM = [0x43, 0x38, 0xca]; // indigo-700
const INK = [0xff, 0xff, 0xff];

/** Signed-distance helper: rounded rectangle, origin at centre, half extents. */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** The mark: two offset "cards" — the lower one behind, the upper one in front
 *  with a notch cut out of its bottom-left corner, reading as stacked tabs. */
function coverage(x, y, s) {
  const back = sdRoundRect(x, y, s * 0.5, s * 0.62, s * 0.26, s * 0.2, s * 0.07);
  const front = sdRoundRect(x, y, s * 0.5, s * 0.4, s * 0.26, s * 0.2, s * 0.07);
  const inFront = front < 0;
  const inBack = back < 0 && !inFront;
  if (inFront || inBack) return 1;
  return 0;
}

function render(size) {
  const s = size;
  const rgba = Buffer.alloc(s * s * 4);
  const SS = 4; // supersampling factor per axis

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let bgHits = 0;
      let inkHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const bg = sdRoundRect(px, py, s / 2, s / 2, s / 2, s / 2, s * 0.22) < 0;
          if (!bg) continue;
          bgHits++;
          if (coverage(px, py, s) > 0) inkHits++;
        }
      }
      const total = SS * SS;
      const bgA = bgHits / total;
      if (bgA === 0) continue;
      const inkA = inkHits / total;
      // Vertical gradient on the background, white ink on top.
      const t = y / Math.max(1, s - 1);
      const bg = [0, 1, 2].map((i) =>
        Math.round((BG_TOP[i] ?? 0) * (1 - t) + (BG_BOTTOM[i] ?? 0) * t),
      );
      const mix = (a, b) => Math.round(a + (b - a) * inkA);
      const idx = (y * s + x) * 4;
      rgba[idx] = mix(bg[0] ?? 0, INK[0] ?? 255);
      rgba[idx + 1] = mix(bg[1] ?? 0, INK[1] ?? 255);
      rgba[idx + 2] = mix(bg[2] ?? 0, INK[2] ?? 255);
      rgba[idx + 3] = Math.round(bgA * 255);
    }
  }
  return encodePng(s, s, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = render(size);
  const name = `icon${size}.png`;
  writeFileSync(resolve(OUT_DIR, name), png);
  console.log(`icons: ${name} (${png.length} bytes)`);
}
