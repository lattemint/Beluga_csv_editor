/**
 * Prototype sample data.
 *
 * Step 1 (this prototype) renders a hand-built document so the interface can be
 * judged before the real parser exists. The shape mirrors the real thing:
 *   - 7 columns: id, trigger, conditions, script, text, options, notes
 *   - multiline `text` / `options` cells (quoted, embedded newlines)
 *   - fields containing commas -> quoted
 *   - `#` section comment rows and all-empty spacer rows
 *   - CJK content, because the real rules.csv in this workspace is localized
 *   - ragged rows (fewer trailing fields than the widest row)
 *
 * Step 2 replaces this with a real RFC 4180 parse of an actual file; the UI
 * consumes only the CsvDocument model, so nothing here leaks into it.
 */
import type { CsvDocument, Row } from './model.ts';
import { makeRow } from './model.ts';

/** Deterministic PRNG so the sample looks the same on every reload. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const COLUMNS = ['id', 'trigger', 'conditions', 'script', 'text', 'options', 'notes'];

const TRIGGERS = [
  'None',
  'OnCustomEvent',
  'OnMarketEntered',
  'OnBattleEnd',
  'OnFleetDespawned',
  'OnPlayerActivatedAbility',
];

const SCRIPTS = ['None', 'NoScript', 're_BeaconPingScript', 're_LabDiscoveryScript', 're_SalvageHook'];

const FRAGMENTS = [
  '航道尽头只剩静电噪声，信标仍在重复同一段坐标。',
  '你听见金属在真空中缓慢冷却的声音。',
  '这段记录被刻意抹去过两次，留下的只有一句警告。',
  '数据核心还在运转，说明有人比你先到过这里。',
  '传感器读数与三百年前的档案完全吻合。',
  '没有回应。只有引力井边缘那一点细微的抖动。',
  '舱门内侧刻着一行字：不要把坐标交给任何人。',
  '自动警告信标在被切断之前，发出了最后一帧图像。',
  '轨道上漂浮着某种不该出现在这里的结构。',
  '信号源正在远离，速度不符合任何已知推进方式。',
];

const OPTION_LABELS = [
  '继续接近',
  '切断连接',
  '记录坐标',
  '留下标记',
  '立即撤离',
  '请求通讯',
  '扫描残骸',
  '无视警告',
];

const NOTES = [
  '由势力事件触发',
  '需要在星系内停留 3 秒',
  '与 re_lab 掉落组共用',
  '测试用，勿删',
  '',
  'TODO: 待本地化校对',
  '注意与 vanilla 规则冲突',
];

const ID_TOPICS = [
  'leave',
  'join',
  'survey',
  'salvage',
  'beacon',
  'derelict',
  'remnant',
  'colony',
  'trade',
  'bounty',
  'ruins',
  'lab',
];

const ID_SCOPES = ['default', 'hegemony', 'pirates', 'remnant', 're_lab', 're_pioneer', 'independent'];

/** A few hand-written rows so the very first screen already shows every feature. */
const HERO_ROWS: readonly (readonly string[])[] = [
  ['defaultLeave', 'None', 'Always', 'None', '离开\n（信标沉默，只剩静电噪声）', 'leave:离开\nstay:留下', '通用离场'],
  ['#  ===== 通用规则 =====', '', '', '', '', '', ''],
  ['remnantDefeated', 'OnBattleEnd', "$faction == 'remnant'", 're_SalvageHook', '残骸中残留着完整的\n数据核心碎片。', 'a:回收\nb:销毁', '含 "引号" 与,逗号'],
  ['', '', '', '', '', '', ''],
  ['re_beacon_ping', 'OnCustomEvent', 'Always', 're_BeaconPingScript', '坐标, 又一次出现在\n同一片空域。\n\n信号强度: 12%', 'ping:回应\nignore:无视', '引号内的换行'],
  ['re_lab_discovery', 'OnMarketEntered', '$hasOrbitalStation == false', 're_LabDiscoveryScript', '轨道上没有空间站，\n只有一座被遗弃的研究设施。', 'enter:进入', ''],
];

function pick<T>(items: readonly T[], rnd: () => number): T {
  return items[Math.floor(rnd() * items.length) % items.length];
}

/**
 * Build sample rows: hand-written hero rows first, then generated filler so the
 * grid is long enough to exercise virtual scrolling and search.
 */
function buildRows(total: number): Row[] {
  const rnd = makeRandom(20260910);
  const rows: Row[] = [];
  let line = 1;

  rows.push(makeRow([...COLUMNS], ',', line, true));
  line += 1;

  for (const hero of HERO_ROWS) {
    rows.push(makeRow(hero, ',', line, false));
    line += 1;
  }

  let n = 0;
  while (rows.length < total) {
    n += 1;
    const scope = pick(ID_SCOPES, rnd);
    const topic = pick(ID_TOPICS, rnd);
    const index = String(n).padStart(3, '0');
    const id = `${scope}_${topic}_${index}`;

    const first = pick(FRAGMENTS, rnd);
    const second = rnd() > 0.45 ? pick(FRAGMENTS, rnd) : '';
    const text = second.length > 0 ? `${first}\n${second}` : first;

    const optA = pick(OPTION_LABELS, rnd);
    const optB = rnd() > 0.5 ? pick(OPTION_LABELS, rnd) : '';
    const options = optB.length > 0 ? `a:${optA}\nb:${optB}` : `a:${optA}`;

    const notes = pick(NOTES, rnd);
    const conditions = rnd() > 0.6 ? `$re_${topic}Stage >= ${Math.floor(rnd() * 5)}` : 'Always';

    // Ragged on purpose: some rows simply stop early, exactly like the real files.
    const values = [
      id,
      pick(TRIGGERS, rnd),
      conditions,
      pick(SCRIPTS, rnd),
      text,
      options,
      notes,
    ];
    const drop = rnd();
    const trimmed = drop > 0.88 ? values.slice(0, 4) : drop > 0.82 ? values.slice(0, 5) : values;

    rows.push(makeRow(trimmed, ',', line, false));
    line += 1;

    if (n % 37 === 0) {
      rows.push(makeRow([`#  ===== 分组 ${Math.floor(n / 37)} =====`], ',', line, false));
      line += 1;
    }
    if (n % 13 === 0) {
      rows.push(makeRow([''], ',', line, false));
      line += 1;
    }
  }

  return rows;
}

/** Build the sample document used by the step-1 prototype. */
export function makeSampleDocument(totalRows = 420): CsvDocument {
  const rows = buildRows(totalRows);

  // Seed a couple of edits so the "unsaved changes" affordances are visible
  // on first load instead of only after the user touches something.
  const a = rows[3];
  if (a && a.cells[6]) {
    a.cells[6].value = '通用离场（已修改示例）';
    a.cells[6].dirty = true;
    a.dirty = true;
  }
  const b = rows[8];
  if (b && b.cells[4]) {
    b.cells[4].value = `${b.cells[4].value}\n\n[已修改示例]`;
    b.cells[4].dirty = true;
    b.dirty = true;
  }

  return {
    fileName: 'rules.csv（范例）',
    filePath: null,
    delimiter: ',',
    encoding: 'utf-8',
    eol: '\r\n',
    trailingEol: true,
    rows,
  };
}
