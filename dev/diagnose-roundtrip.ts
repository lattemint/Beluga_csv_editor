/**
 * Diagnostic helper: show exactly where a file fails to round-trip.
 * Usage: node dev/diagnose-roundtrip.ts <file.csv> [more.csv ...]
 */
import { readFileSync } from 'node:fs';
import { parseCsvBytes } from '../src/core/parse.ts';
import { serializeCsvBytes } from '../src/core/serialize.ts';

function preview(bytes: Uint8Array, at: number): string {
  const from = Math.max(0, at - 90);
  const to = Math.min(bytes.length, at + 90);
  return new TextDecoder('utf-8')
    .decode(bytes.subarray(from, to))
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.log('usage: node dev/diagnose-roundtrip.ts <file.csv> ...');
  process.exit(0);
}

for (const file of targets) {
  const original = readFileSync(file);
  const parsed = parseCsvBytes(original, file);
  const produced = serializeCsvBytes(parsed.doc);

  console.log(`=== ${file}`);
  console.log(
    `    encoding=${parsed.doc.encoding} eol=${JSON.stringify(parsed.doc.eol)} ` +
      `delimiter=${JSON.stringify(parsed.doc.delimiter)} trailingEol=${parsed.doc.trailingEol}`,
  );
  console.log(`    warnings=${JSON.stringify(parsed.warnings)}`);
  console.log(`    stats=${JSON.stringify(parsed.stats)}`);

  const limit = Math.min(produced.length, original.length);
  let diff = -1;
  for (let i = 0; i < limit; i += 1) {
    if (produced[i] !== original[i]) {
      diff = i;
      break;
    }
  }
  if (diff === -1 && produced.length !== original.length) diff = limit;

  if (diff === -1) {
    console.log('    round-trip: OK (byte identical)');
    continue;
  }
  console.log(`    round-trip: FAIL  length ${original.length} -> ${produced.length}  firstDiff ${diff}`);
  console.log(`    orig: …${preview(original, diff)}…`);
  console.log(`    prod: …${preview(produced, diff)}…`);
}
