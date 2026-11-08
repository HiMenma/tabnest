import { describe, expect, it } from "vitest";
import {
  chunkAad,
  deriveKey,
  fromBase64,
  keyFingerprint,
  open,
  randomBytes,
  seal,
  toBase64,
  toHex,
} from "../../src/background/sync/crypto";

const SALT = randomBytes(16);

describe("base64", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = randomBytes(200);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it("hex-encodes", () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });
});

describe("deriveKey", () => {
  it("is deterministic for the same passphrase and salt", async () => {
    const a = await deriveKey("correct horse", SALT);
    const b = await deriveKey("correct horse", SALT);
    expect(await keyFingerprint(a)).toBe(await keyFingerprint(b));
  });

  it("differs for a different passphrase", async () => {
    const a = await deriveKey("correct horse", SALT);
    const b = await deriveKey("wrong horse", SALT);
    expect(await keyFingerprint(a)).not.toBe(await keyFingerprint(b));
  });

  it("differs for a different salt", async () => {
    const a = await deriveKey("correct horse", SALT);
    const b = await deriveKey("correct horse", randomBytes(16));
    expect(await keyFingerprint(a)).not.toBe(await keyFingerprint(b));
  });
});

describe("seal / open", () => {
  it("round-trips plaintext", async () => {
    const key = await deriveKey("passphrase", SALT);
    const plaintext = new TextEncoder().encode("hello sync");
    const aad = chunkAad("store", "device", 1);
    const sealed = await seal(key, plaintext, aad);
    const opened = await open(key, sealed.ivB64, sealed.ciphertext, aad);
    expect(new TextDecoder().decode(opened)).toBe("hello sync");
  });

  it("uses a fresh IV each time", async () => {
    const key = await deriveKey("passphrase", SALT);
    const plaintext = new TextEncoder().encode("x");
    const aad = chunkAad("store", "device", 1);
    const first = await seal(key, plaintext, aad);
    const second = await seal(key, plaintext, aad);
    expect(first.ivB64).not.toBe(second.ivB64);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });

  it("refuses a chunk replayed at another position", async () => {
    const key = await deriveKey("passphrase", SALT);
    const plaintext = new TextEncoder().encode("x");
    const sealed = await seal(key, plaintext, chunkAad("store", "device", 1));
    await expect(
      open(key, sealed.ivB64, sealed.ciphertext, chunkAad("store", "device", 2)),
    ).rejects.toThrow();
  });

  it("refuses a tampered ciphertext", async () => {
    const key = await deriveKey("passphrase", SALT);
    const sealed = await seal(key, new TextEncoder().encode("x"), chunkAad("s", "d", 1));
    const flipped = new Uint8Array(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    await expect(open(key, sealed.ivB64, flipped, chunkAad("s", "d", 1))).rejects.toThrow();
  });

  it("refuses the wrong passphrase", async () => {
    const right = await deriveKey("passphrase", SALT);
    const wrong = await deriveKey("other", SALT);
    const sealed = await seal(right, new TextEncoder().encode("x"), chunkAad("s", "d", 1));
    await expect(
      open(wrong, sealed.ivB64, sealed.ciphertext, chunkAad("s", "d", 1)),
    ).rejects.toThrow();
  });
});
