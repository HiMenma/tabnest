import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ICONS = resolve(import.meta.dirname, "..", "..", "public", "icons");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("generated icons", () => {
  for (const size of [16, 32, 48, 128]) {
    it(`icon${size}.png is a valid ${size}x${size} RGBA PNG`, () => {
      const file = resolve(ICONS, `icon${size}.png`);
      const buf = readFileSync(file);

      expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

      // IHDR is always the first chunk: length(4) type(4) width(4) height(4) …
      expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
      expect(buf.readUInt32BE(16)).toBe(size);
      expect(buf.readUInt32BE(20)).toBe(size);
      expect(buf[24]).toBe(8); // bit depth
      expect(buf[25]).toBe(6); // truecolour with alpha

      // A blank icon would compress to almost nothing; this catches a broken renderer.
      expect(buf.length).toBeGreaterThan(150);
    });
  }
});
