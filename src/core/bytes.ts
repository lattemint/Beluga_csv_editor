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
 *
 * GB18030 support: Chinese Windows / Excel saves CSV as the legacy GBK codepage
 * (CP936). The platform can *decode* gb18030 but TextEncoder only knows UTF-8,
 * so encoding is done with a reverse table built from the system decoder at
 * first use (≈24k two-byte sequences, ~20 ms). Decoding a GBK file and
 * re-encoding it with that table reproduces the original bytes exactly — this
 * is covered by the round-trip test.
 */
import type { Encoding } from './model.ts';

const UTF8_BOM: readonly number[] = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM: readonly number[] = [0xff, 0xfe];
const UTF16BE_BOM: readonly number[] = [0xfe, 0xff];

/** Thrown when text has characters the target legacy encoding cannot represent. */
export class EncodingError extends Error {
  readonly characters: string[];

  constructor(characters: string[]) {
    super(`unrepresentable characters: ${characters.join(' ')}`);
    this.name = 'EncodingError';
    this.characters = characters;
  }
}

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

/**
 * Decode as GB18030, or null when the bytes are not plausible Chinese text.
 *
 * GB18030 is designed to map (almost) every byte string, so "it decoded" alone
 * proves nothing. Requiring at least one CJK character keeps random binary data
 * or a Western legacy file from being mistaken for GBK.
 */
function tryDecodeGb18030(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    return /[\u3000-\u9fff\uff00-\uffef]/.test(text) ? text : null;
  } catch {
    return null;
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

  const utf8Valid = isValidUtf8(bytes);
  if (!utf8Valid) {
    const legacy = tryDecodeGb18030(bytes);
    if (legacy !== null) {
      return { text: legacy, encoding: 'gb18030', hasBom: false, validUtf8: false };
    }
  }
  return {
    text: new TextDecoder('utf-8').decode(bytes),
    encoding: 'utf-8',
    hasBom: false,
    validUtf8: utf8Valid,
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
    case 'gb18030':
      return encodeGb18030(text);
    case 'utf-8':
    default:
      return new TextEncoder().encode(text);
  }
}

// ------------------------------------------------------------------ GB18030

let gbTable: Map<string, readonly [number, number]> | null = null;

/** Reverse of the platform's gb18030 decoder: character → its two bytes. */
function gbEncodeTable(): Map<string, readonly [number, number]> {
  if (gbTable) return gbTable;
  const table = new Map<string, readonly [number, number]>();
  const decoder = new TextDecoder('gb18030');
  for (let lead = 0x81; lead <= 0xfe; lead += 1) {
    for (let trail = 0x40; trail <= 0xfe; trail += 1) {
      if (trail === 0x7f) continue;
      const char = decoder.decode(new Uint8Array([lead, trail]));
      if (char.length === 1 && char !== '\uFFFD' && !table.has(char)) {
        table.set(char, [lead, trail]);
      }
    }
  }
  gbTable = table;
  return table;
}

function encodeGb18030(text: string): Uint8Array {
  const table = gbEncodeTable();
  const out: number[] = [];
  const missing: string[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const pair = table.get(char);
    if (pair) {
      out.push(pair[0], pair[1]);
      continue;
    }
    if (missing.length < 8) missing.push(char);
    out.push(0x3f); // '?'
  }
  if (missing.length > 0) throw new EncodingError(missing);
  return new Uint8Array(out);
}

// --------------------------------------------------------------------- UTF-16

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
