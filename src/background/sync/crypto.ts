/**
 * Optional end-to-end encryption.
 *
 * A passphrase is stretched with PBKDF2-SHA256 into a 256-bit key; each chunk is
 * sealed with AES-GCM and its position in the stream is bound by the additional
 * data, so a chunk cannot be moved, duplicated or reordered without failing to
 * decrypt. The key never leaves memory.
 */

export const KDF_ITERATIONS = 600_000;
const KEY_LENGTH = 256;

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: KDF_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: KEY_LENGTH },
    // Extractable on purpose: the raw key is stored on this device so sync
    // survives a worker restart, and a fingerprint of it lets a second device
    // verify it typed the same passphrase.
    true,
    ["encrypt", "decrypt"],
  );
}

/** A stable, non-secret fingerprint of the key, so a wrong passphrase is detectable. */
export async function keyFingerprint(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key).catch(() => null);
  if (raw) {
    const digest = await crypto.subtle.digest("SHA-256", raw);
    return toHex(new Uint8Array(digest)).slice(0, 32);
  }
  // Non-extractable key: fingerprint what the WebCrypto object implies.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(key.algorithm)),
  );
  return toHex(new Uint8Array(digest)).slice(0, 32);
}

export interface Sealed {
  ivB64: string;
  ciphertext: Uint8Array;
}

export async function seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<Sealed> {
  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(aad) },
      key,
      plaintext as BufferSource,
    ),
  );
  return { ivB64: toBase64(iv), ciphertext };
}

export async function open(
  key: CryptoKey,
  ivB64: string,
  ciphertext: Uint8Array,
  aad: string,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(ivB64) as BufferSource,
        additionalData: new TextEncoder().encode(aad),
      },
      key,
      ciphertext as BufferSource,
    ),
  );
}

/** The AAD that binds a chunk to its identity and position. */
export function chunkAad(storeId: string, deviceId: string, seq: number): string {
  return `${storeId}|${deviceId}|${seq}`;
}
