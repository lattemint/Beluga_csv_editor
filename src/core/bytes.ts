/**
 * Byte layer: decoding detection and encoding back to bytes.
 *
 * Starsector reads its data files as UTF-8, usually without a BOM, but we keep
 * the BOM flag and the exact encoding on the document so a save can reproduce
 * the original file byte for byte.
 *
 * Uses TextDecoder/TextEncoder so the same module works in Node (tests) and in
 * the browser (the editor). UTF-16 has no TextEncoder support, so those two
 * variants are encoded by hand.
 */
import type { Encoding } from './model.ts';

const UTF8_BOM: readonly number[] = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM: readonly number[] = [0xff, 0xfe];
const UTF16BE_BOM: readonly number[] = [0xfe, 0xff];

export interface DecodedBytes {
  text: string;
  encoding: Encoding;
  hasBom: boolean;
  /** False when the payload is not valid UTF-8 (exotic legacy encoding). */
  validUtf8: boolean;
}

export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function decodeBytes(bytes: Uint8Array): DecodedBytes {
  if (startsWith(bytes, UTF8_BOM)) {
    return {
      text: new TextDecoder('utf-8').decode(bytes.subarray(UTF8_BOM.length)),
      encoding: 'utf-8-bom',
      hasBom: true,
      validUtf8: true,
    };
  }
  if (startsWith(bytes, UTF16LE_BOM)) {
    return {
      text: decodeUtf16(bytes.subarray(UTF16LE_BOM.length), true),
      encoding: 'utf-16le',
      hasBom: true,
      validUtf8: false,
    };
  }
  if (startsWith(bytes, UTF16BE_BOM)) {
    return {
      text: decodeUtf16(bytes.subarray(UTF16BE_BOM.length), false),
      encoding: 'utf-16be',
      hasBom: true,
      validUtf8: false,
    };
  }
  return {
    text: new TextDecoder('utf-8').decode(bytes),
    encoding: 'utf-8',
    hasBom: false,
    validUtf8: isValidUtf8(bytes),
  };
}

export function encodeBytes(text: string, encoding: Encoding): Uint8Array {
  switch (encoding) {
    case 'utf-8-bom':
      return concat(new Uint8Array(UTF8_BOM), new TextEncoder().encode(text));
    case 'utf-16le':
      return concat(new Uint8Array(UTF16LE_BOM), encodeUtf16(text, true));
    case 'utf-16be':
      return concat(new Uint8Array(UTF16BE_BOM), encodeUtf16(text, false));
    case 'utf-8':
    default:
      return new TextEncoder().encode(text);
  }
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const a = bytes[i];
    const b = bytes[i + 1];
    out += String.fromCharCode(littleEndian ? a | (b << 8) : (a << 8) | b);
  }
  return out;
}

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (littleEndian) {
      out[i * 2] = code & 0xff;
      out[i * 2 + 1] = (code >> 8) & 0xff;
    } else {
      out[i * 2] = (code >> 8) & 0xff;
      out[i * 2 + 1] = code & 0xff;
    }
  }
  return out;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
