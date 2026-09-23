/**
 * M0 acceptance tests — the hard gate for "byte-faithful".
 *
 * Run with:  node tests/roundtrip.test.ts
 * (`node --test` is not used: the test runner spawns a child per file and this
 * sandbox forbids the piped stdio that needs. Running the file directly uses
 * node:test in-process, which reports the same way.)
 *
 * The contract under test: read a real Starsector CSV, change nothing, write it
 * back — the bytes must be identical. Everything else (multiline cells, quoted
 * commas, trailing spaces, ragged rows, comment rows, BOM, CRLF) is a detail of
 * that one promise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeBytes } from '../src/core/bytes.ts';
import { setCellValue } from '../src/core/model.ts';
import { detectDelimiter, parseCsvBytes, parseCsvText } from '../src/core/parse.ts';
import {
  serializeCell,
  serializeCsv,
  serializeCsvBytes,
  serializeRow,
  terminatorFor,
} from '../src/core/serialize.ts';

const WORKSPACE = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS = join(WORKSPACE, 'Starsector');
const RULES = join(CORPUS, 'starsector-core', 'data', 'campaign', 'rules.csv');
const PROCGEN = join(CORPUS, 'mods', 'relic_exploration', 'data', 'campaign', 'procgen');

function shortPath(path: string): string {
  return path.startsWith(WORKSPACE) ? path.slice(WORKSPACE.length) : path;
}

function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : limit;
}

function context(bytes: Uint8Array, at: number): string {
  const from = Math.max(0, at - 70);
  const to = Math.min(bytes.length, at + 70);
  return new TextDecoder('utf-8')
    .decode(bytes.subarray(from, to))
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function assertBytesEqual(actual: Uint8Array, expected: Uint8Array, label: string): void {
  const diff = firstDiff(actual, expected);
  if (diff === -1) return;
  assert.fail(
    `${label}: 字节不一致 @ offset ${diff}（长度 ${actual.length} vs ${expected.length}）\n` +
      `  实际: …${context(actual, diff)}…\n` +
      `  期望: …${context(expected, diff)}…`,
  );
}

function walkCsv(dir: string): string[] {
  const found: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(current, name);
      let info: ReturnType<typeof statSync>;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) stack.push(full);
      else if (name.toLowerCase().endsWith('.csv')) found.push(full);
    }
  }
  return found.sort();
}

// ---------------------------------------------------------------- synthetic

test('合成用例：CRLF + 引号内换行 + 尾部空格 + ragged 行，逐字节还原', () => {
  const source = 'id,text,note\r\n"a,1","line1\r\nline2","trailing  "\r\nb,,x\r\n,,,\r\n';
  const parsed = parseCsvText(source, 'synthetic.csv');

  assert.equal(parsed.doc.delimiter, ',', '应识别为逗号');
  assert.equal(parsed.doc.eol, '\r\n', '应识别为 CRLF');
  assert.equal(parsed.doc.trailingEol, true, '应以换行结尾');
  assert.equal(parsed.stats.records, 4, '应有 4 条记录');

  assert.equal(parsed.doc.rows[1].cells[0].value, 'a,1', '引号内的逗号属于字段');
  assert.equal(parsed.doc.rows[1].cells[1].value, 'line1\r\nline2', '引号内换行属于字段');
  assert.equal(parsed.doc.rows[1].cells[2].value, 'trailing  ', '引号内尾部空格不能被 trim');
  assert.equal(parsed.doc.rows[3].cells.length, 4, 'ragged 行的字段数必须原样保留');
  assert.equal(parsed.stats.embeddedNewlines, 1, '应数出 1 处单元格内换行');

  assert.equal(serializeCsv(parsed.doc), source, '序列化必须与原文逐字节一致');
});

test('合成用例："" 与空字段保持可区分', () => {
  const source = 'a,"",b\n';
  const parsed = parseCsvText(source, 'empty.csv');

  assert.equal(parsed.doc.eol, '\n');
  assert.equal(parsed.doc.rows[0].cells[1].value, '', '引号内的空值');
  assert.equal(parsed.doc.rows[0].cells[1].quoted, true, '空的引号字段必须记住它带引号');
  assert.equal(parsed.doc.rows[0].cells[0].quoted, false, '普通字段不应被强行加引号');
  assert.equal(serializeCsv(parsed.doc), source);
});

test('合成用例：没有结尾换行的文件', () => {
  const source = 'a,b\r\nc,d';
  const parsed = parseCsvText(source, 'noeol.csv');
  assert.equal(parsed.doc.trailingEol, false);
  assert.equal(parsed.stats.records, 2);
  assert.equal(serializeCsv(parsed.doc), source);
});

test('合成用例：全空行作为一行空字段保留，不会塌缩', () => {
  const source = 'h\r\n\r\nx\r\n';
  const parsed = parseCsvText(source, 'blank.csv');
  assert.equal(parsed.stats.records, 3, '空行也是一条记录');
  assert.equal(parsed.doc.rows[1].cells.length, 1);
  assert.equal(parsed.doc.rows[1].cells[0].value, '');
  assert.equal(serializeCsv(parsed.doc), source, '空行必须在写回时保住');
});

test('分隔符识别：分号文件（含引号内逗号）应识别为分号', () => {
  const source = 'id;name;note\r\n1;alpha;"x,y;z"\r\n2;beta;z\r\n';
  const ranked = detectDelimiter(source);

  assert.equal(ranked[0].delimiter, ';', `应推荐分号，实际 ${ranked[0].delimiter}`);
  assert.equal(ranked[0].recommended, true);
  assert.ok(
    ranked.find((v) => v.delimiter === ',')!.score < ranked[0].score,
    '逗号的得分必须更低',
  );

  const parsed = parseCsvText(source, 'semi.csv');
  assert.equal(parsed.doc.delimiter, ';');
  assert.equal(parsed.doc.rows[1].cells[2].value, 'x,y;z', '引号内分号/逗号都属于字段');
  assert.equal(serializeCsv(parsed.doc), source);
});

// ------------------------------------------------- adversarial real-world

test('混合换行：每一行保留自己的换行符（真实文件确实会这样）', () => {
  const source = 'id,a,b\n1,2,3\r\n4,5,6\r\n';
  const parsed = parseCsvText(source, 'mixed.csv');

  assert.equal(parsed.doc.eol, '\r\n', '主导风格应为 CRLF');
  assert.equal(parsed.doc.rows[0].eol, '\n', '第一行是 LF');
  assert.equal(parsed.doc.rows[1].eol, '\r\n');
  assert.equal(parsed.doc.rows[2].eol, '\r\n');
  assert.ok(parsed.warnings.some((w) => w.includes('换行风格')), '应提示混用了换行风格');
  assert.equal(serializeCsv(parsed.doc), source, '逐字节还原，不统一换行符');
});

test('畸形引号：字段按原文回放，不会被重新转义', () => {
  // A quoted field holding bare, unescaped quotes. No canonical re-quoting rule
  // can reproduce this, which is exactly why verbatim replay exists.
  const source = 'id,note\r\n1,"禁用"预加载"后更省显存"\r\n2,ok\r\n';
  const parsed = parseCsvText(source, 'malformed.csv');

  assert.equal(parsed.stats.records, 3);
  assert.equal(parsed.doc.rows[1].cells[1].raw, '"禁用"预加载"后更省显存"');
  assert.equal(serializeCsv(parsed.doc), source, '必须原文回放');

  // Once edited the field becomes canonical, and that is fine.
  setCellValue(parsed.doc.rows[1].cells[1], '干净的值', ',');
  assert.equal(serializeCell(parsed.doc.rows[1].cells[1], ','), '干净的值');
  assert.equal(parsed.stats.records, 3, '解析结果不受影响');
});

test('已知难点文件：LunaSettings.csv 与 relic_exploration/rules.csv', () => {
  const files = [
    join(CORPUS, 'mods', 'GraphicsLib', 'data', 'config', 'LunaSettings.csv'),
    join(CORPUS, 'mods', 'relic_exploration', 'data', 'campaign', 'rules.csv'),
  ];
  for (const file of files) {
    const original = readFileSync(file);
    const parsed = parseCsvBytes(original, file);
    assertBytesEqual(serializeCsvBytes(parsed.doc), original, shortPath(file));
  }
});

// ------------------------------------------------------------------- rules

test('rules.csv：编码/换行/分隔符探测正确', () => {
  const bytes = readFileSync(RULES);
  const decoded = decodeBytes(bytes);
  const parsed = parseCsvBytes(bytes, RULES);

  assert.equal(decoded.encoding, 'utf-8', 'rules.csv 应为 UTF-8');
  assert.equal(decoded.hasBom, false, 'rules.csv 不应带 BOM');
  assert.equal(decoded.validUtf8, true, 'rules.csv 应为合法 UTF-8');
  assert.equal(parsed.doc.delimiter, ',');
  assert.equal(parsed.doc.eol, '\r\n');
  assert.equal(parsed.warnings.length, 0, `不应有解析警告: ${parsed.warnings.join(' | ')}`);
});

test('rules.csv：单元格内换行是主体，不是边角情况', () => {
  const bytes = readFileSync(RULES);
  const text = decodeBytes(bytes).text;
  const parsed = parseCsvBytes(bytes, RULES);

  const physicalBreaks = (text.match(/\r\n/g) ?? []).length;
  const { records, embeddedNewlines } = parsed.stats;

  // Every CRLF is either a record terminator or a newline inside a quoted cell.
  assert.equal(
    records + embeddedNewlines,
    physicalBreaks,
    `记录 ${records} + 单元格内换行 ${embeddedNewlines} 应等于物理换行 ${physicalBreaks}`,
  );
  assert.ok(embeddedNewlines > 20000, `期望大量多行单元格，实际 ${embeddedNewlines}`);
  assert.ok(records < physicalBreaks / 2, '记录数应远少于物理行数');
  assert.ok(parsed.stats.quotedCells > 0, '应有带引号的字段');

  console.log(
    `      [rules.csv] 记录 ${records} · 物理行 ${physicalBreaks} · ` +
      `单元格内换行 ${embeddedNewlines} · 引号字段 ${parsed.stats.quotedCells} · ` +
      `列数 ${parsed.stats.columns} · ragged ${parsed.stats.raggedRows}`,
  );
});

test('rules.csv：不改动时逐字节往返一致', () => {
  const original = readFileSync(RULES);
  const parsed = parseCsvBytes(original, RULES);
  assertBytesEqual(serializeCsvBytes(parsed.doc), original, 'rules.csv');
});

test('procgen 样本：注释行 # 与全空分隔行被正确分类且原样保留', () => {
  for (const name of ['condition_gen_data.csv', 'drop_groups.csv', 'salvage_entity_gen_data.csv']) {
    const file = join(PROCGEN, name);
    const original = readFileSync(file);
    const parsed = parseCsvBytes(original, file);
    assertBytesEqual(serializeCsvBytes(parsed.doc), original, name);

    if (name === 'condition_gen_data.csv') {
      assert.equal(parsed.stats.commentRows, 4, `# 注释行数，实际 ${parsed.stats.commentRows}`);
      assert.equal(parsed.stats.blankRows, 4, `全空行数，实际 ${parsed.stats.blankRows}`);
      console.log(
        `      [procgen] ${name} 注释行 ${parsed.stats.commentRows} · 空行 ${parsed.stats.blankRows} · ` +
          `ragged ${parsed.stats.raggedRows}`,
      );
    }
  }
});

test('procgen：引号内的逗号与尾部空格原样保留', () => {
  const file = join(PROCGEN, 'condition_gen_data.csv');
  const parsed = parseCsvBytes(readFileSync(file), file);

  const texts: string[] = [];
  for (const row of parsed.doc.rows) {
    for (const cell of row.cells) texts.push(cell.value);
  }
  const multi = texts.filter((value) => value.includes(', '));
  assert.ok(multi.length > 0, '应能找到引号内含逗号的字段');
  assert.ok(
    texts.some((value) => value.endsWith(' ') && value.trim().length > 0),
    '引号内的尾部空格必须被保留下来',
  );
});

// ------------------------------------------------------------------ corpus

test('整个 Starsector 语料库：每个 CSV 都逐字节往返一致', () => {
  const files = walkCsv(CORPUS);
  assert.ok(files.length > 100, `语料库文件太少：${files.length}`);

  const failures: string[] = [];
  const delimiterCounts = new Map<string, number>();
  let totalBytes = 0;

  for (const file of files) {
    const original = readFileSync(file);
    totalBytes += original.length;
    const parsed = parseCsvBytes(original, file);
    delimiterCounts.set(
      parsed.doc.delimiter,
      (delimiterCounts.get(parsed.doc.delimiter) ?? 0) + 1,
    );
    if (firstDiff(serializeCsvBytes(parsed.doc), original) !== -1) failures.push(shortPath(file));
  }

  const breakdown = [...delimiterCounts.entries()]
    .map(([delimiter, count]) => `${JSON.stringify(delimiter)}=${count}`)
    .join(' ');
  console.log(
    `      [corpus] ${files.length} 个文件 / ${(totalBytes / 1024 / 1024).toFixed(2)} MB / 分隔符 ${breakdown}`,
  );

  assert.equal(
    failures.length,
    0,
    `${failures.length} 个文件无法逐字节往返:\n${failures.slice(0, 20).join('\n')}`,
  );
});

// ------------------------------------------------------------------ editing

test('改动一个单元格后，文件中其余字节逐一保持原样', () => {
  const original = readFileSync(RULES);
  const sourceText = decodeBytes(original).text;
  const parsed = parseCsvBytes(original, RULES);
  const doc = parsed.doc;

  const targetRow = 5;
  const targetCol = 4;
  const replacement = '★被改动的单元格★';
  setCellValue(doc.rows[targetRow].cells[targetCol], replacement, doc.delimiter);

  const produced = serializeCsv(doc);

  // Everything outside the edited record must be identical, byte for byte.
  const prefix = doc.rows
    .slice(0, targetRow)
    .map((row, index) => serializeRow(row.cells, doc.delimiter) + terminatorFor(doc, index))
    .join('');
  const suffix = doc.rows
    .slice(targetRow + 1)
    .map(
      (row, offset) =>
        serializeRow(row.cells, doc.delimiter) + terminatorFor(doc, targetRow + 1 + offset),
    )
    .join('');

  assert.ok(sourceText.startsWith(prefix), '改动前的前缀应与原文一致');
  assert.ok(sourceText.endsWith(suffix), '改动前的后缀应与原文一致');
  assert.ok(produced.startsWith(prefix), '写回后的前缀必须逐字符不变');
  assert.ok(produced.endsWith(suffix), '写回后的后缀必须逐字符不变');

  const reparsed = parseCsvBytes(serializeCsvBytes(doc), RULES);
  assert.equal(reparsed.stats.records, parsed.stats.records, '记录数不应变化');
  assert.equal(reparsed.doc.rows[targetRow].cells[targetCol].value, replacement);
});

test('改动单元格引入逗号/换行时会被正确加引号并仍可解析', () => {
  const original = readFileSync(RULES);
  const parsed = parseCsvBytes(original, RULES);
  const cell = parsed.doc.rows[5].cells[1];
  setCellValue(cell, '含,逗号\n以及换行', parsed.doc.delimiter);

  const reparsed = parseCsvBytes(serializeCsvBytes(parsed.doc), RULES);
  assert.equal(reparsed.doc.rows[5].cells[1].value, '含,逗号\n以及换行');
  assert.equal(reparsed.doc.rows[5].cells[1].quoted, true);
});
