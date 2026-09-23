/**
 * UI i18n: Chinese / English.
 *
 * Every user-visible string in the editor comes from here. The language is
 * stored in localStorage (key below) and switching re-renders the app.
 *
 * Known limitation: parse.ts WARNINGS are still Chinese-only (they carry
 * file-level diagnostics with parameters; localizing them is on the backlog).
 * The built-in sample document's cell contents are data, not UI, and stay as
 * they are.
 */
export type Language = 'zh' | 'en';

const STORAGE_KEY = 'csv-editor.language';

const zh = {
  'app.tagline': ' 就地编辑 · 未改动的字节原样写回',
  'app.dropHint': '也可以随时把 .csv 文件直接拖进窗口',

  'welcome.open': '打开文件',
  'welcome.openDesc': ' 选择电脑上的 .csv 直接编辑；保存会写回原文件',
  'welcome.sample': '范例预览',
  'welcome.sampleDesc': ' 打开内置的 rules.csv 结构示例',
  'welcome.language': '语言 / Language',
  'welcome.languageDesc': ' 切换界面语言（中文 / English）',
  'welcome.about': '关于',
  'welcome.aboutDesc': ' 版本、创作者与许可证',
  'welcome.version': '版本 {v}',

  'toolbar.open': '打开',
  'toolbar.openTitle': '打开 CSV（Ctrl+O）',
  'toolbar.save': '保存',
  'toolbar.saveTitle': '保存（Ctrl+S）',
  'toolbar.saveAs': '另存为',
  'toolbar.backup': '保存前备份 .bak',
  'toolbar.backupTitle': '保存前先把磁盘上的当前内容另存为 .bak，便于回溯',
  'toolbar.delimiter': '分隔符',
  'toolbar.delimiterTitle': '分隔符（换一个会重新解析）',
  'toolbar.undo': '↶ 撤销',
  'toolbar.redo': '↷ 重做',
  'toolbar.themeTitle': '界面主题（浅色 / 深色 / Nord）',

  'channel.sample': '示例数据',
  'channel.writable': '可原地保存',
  'channel.readonly': '只读 · 保存会下载副本',
  'chip.unsaved': '未保存',
  'chip.saved': '已保存',
  'chip.unsavedN': '未保存 · {n} 处改动',

  'tab.closeTitle': '关闭（Alt+W）',
  'tab.addTitle': '再打开一个 CSV（也可以把文件拖进窗口）',
  'tab.title': '{detail}\n双击重命名 · 中键关闭 · Alt+W 关闭',
  'tab.dirty': '有未保存改动',
  'tab.renameToast': '标签已重命名为「{name}」（仅本次会话有效）',
  'tab.closed': '已关闭 {name}',
  'tab.detailSample': '示例数据',
  'tab.detailReadOnly': '只读',
  'tab.detailRows': '{n} 行 × {m} 列',

  'tabMenu.rename': '重命名标签',
  'tabMenu.renameHint': '双击标签',
  'tabMenu.copyInfo': '复制文件信息',
  'tabMenu.copyInfoDone': '已复制文件信息',
  'tabMenu.markSource': '标注来源目录…',
  'tabMenu.markSourceHint': '显示相对路径',
  'tabMenu.close': '关闭',
  'tabMenu.closeOthers': '关闭其它',
  'tabMenu.closeAll': '关闭全部',
  'tabMenu.saveAll': '全部保存',

  'search.placeholder': '搜索全部单元格…（Ctrl+F）',
  'filter.all': '全部行',
  'filter.data': '仅数据行',
  'filter.comment': '仅注释行 #',
  'filter.blank': '仅空行',
  'filter.dirty': '仅已修改',
  'match.all': '共 {n} 行',
  'match.some': '匹配 {a} / {b} 行',
  'search.prev': '↑ 上一处',
  'search.next': '↓ 下一处',

  'editor.title': '单元格编辑器 · R{r} · 第 {c} 列「{name}」',
  'editor.flagLines': '{n} 行',
  'editor.flagQuoted': '原文件带引号',
  'editor.flagDirty': '已修改',
  'editor.flagEmpty': '空',
  'editor.flagMissing': '此行无此字段（共 {n} 列）',
  'editor.hint': 'Enter 换行 · Ctrl+Enter 应用 · 切换单元格时自动应用',
  'editor.hintMissing': '该字段在原文件中不存在；输入内容会扩展这一行',
  'editor.apply': '应用 (Ctrl+Enter)',
  'editor.revert': '还原 (Esc)',
  'editor.placeholder': '选中一个单元格后在此编辑（支持多行）…',

  'status.line':
    '共 {rows} 行 × {cols} 列{visible}{tabs} · 已修改 {dirty} 处 · 光标 R{r}:C{c}「{name}」 · 分隔符 {delim} · {enc} · {eol} · 单元格内换行保留',
  'status.visible': ' · 当前显示 {n} 行',
  'status.tabs': ' · 标签 {i}/{n}',

  'cellMenu.edit': '编辑此格',
  'cellMenu.copy': '复制单元格内容',
  'cellMenu.copyDone': '已复制单元格内容',
  'cellMenu.clear': '清空此格',
  'cellMenu.rowAbove': '在上方插入行',
  'cellMenu.rowBelow': '在下方插入行',
  'cellMenu.dupRow': '复制此行',
  'cellMenu.delRow': '删除此行',
  'cellMenu.colRight': '在右侧插入列',
  'cellMenu.delCol': '删除此列',
  'hint.f2': 'F2',
  'hint.altW': 'Alt+W',
  'hint.ctrlShiftS': 'Ctrl+Shift+S',
  'op.rowInserted': '已插入一行',
  'op.rowDuped': '已复制该行',
  'op.rowDeleted': '已删除一行',
  'op.minOneRow': '至少保留一行',
  'op.colInserted': '已插入一列',
  'op.colDeleted': '已删除一列',

  'dialog.cancel': '取消',
  'dialog.openTitle': '打开 CSV',
  'dialog.detected': '检测到的分隔符',
  'dialog.encoding': '编码',
  'dialog.eol': '换行',
  'dialog.quoting': '引号',
  'dialog.quotingValue': 'RFC 4180（"" 转义）',
  'dialog.preview': '预览',
  'dialog.open': '打开',
  'open.noteDefault': '按「有多少条记录真的被拆成多列」打分；引号内的分隔符不计入。',
  'delim.noteOk': '{p}% 的记录可分出多列',
  'delim.noteNoHit': '未命中：整表只有 1 列',
  'delim.noteFew': '仅 {p}% 的记录为多列',
  'delim.opt.comma': '逗号  ,',
  'delim.opt.semi': '分号  ;',
  'delim.opt.tab': '制表符  Tab',
  'delim.opt.pipe': '竖线  |',
  'delim.label.comma': '逗号 comma',
  'delim.label.semi': '分号 semicolon',
  'delim.label.tab': '制表符 tab',
  'delim.label.pipe': '竖线 pipe',

  'closeTab.title': '关闭标签',
  'closeTab.msg': '「{name}」有 {n} 处未保存改动。关闭前要保存吗？',
  'closeOthers.title': '关闭其它标签',
  'closeOthers.msg': '「{name}」有 {n} 处未保存改动。',
  'closeAll.title': '关闭全部',
  'choice.saveClose': '保存并关闭',
  'choice.discardClose': '直接关闭（丢弃改动）',
  'choice.discardOther': '丢弃并关闭',
  'choice.stopOthers': '停止关闭其它',
  'choice.stop': '停止',

  'external.title': '文件在打开后被外部修改过',
  'external.msg':
    '{name} {detail}。直接保存会覆盖掉这次外部改动；如果那只是别的程序碰了一下时间戳（杀毒、同步盘都可能），覆盖是安全的。',
  'external.sizeChanged': '大小从 {a} 字节变成了 {b} 字节',
  'external.mtimeOnly': '大小没变（{size} 字节），但修改时间变成了 {stamp}',
  'choice.overwrite': '覆盖磁盘上的版本',
  'choice.saveAs': '另存为…',
  'mid.title': '保存过程中文件又被修改',
  'mid.msg':
    '{name} 在刚才的保存步骤里又发生了变化（现在 {size} 字节）。如果生成了 .bak，磁盘上的最新内容已经存进备份。要覆盖磁盘上的当前内容吗？',
  'stuck.title': '保存失败：文件状态一直在变',
  'stuck.msg':
    '{name} 的磁盘状态在写入过程中又变了，浏览器拒绝了这次写入。可以另存为一个新文件，或者再试一次。',
  'choice.retry': '再试一次',

  'reparse.title': '重新解析会丢弃未保存的改动',
  'reparse.msg': '换用「{delim}」要按新分隔符重新解析文件，当前 {n} 处未保存改动会丢失。继续吗？',
  'choice.reparse': '继续重新解析',

  'save.nothingOpen': '还没有打开任何文件',
  'save.noPermission': '没有写入权限，保存已取消（页面上重新授权后可再试）',
  'save.ok': '已保存 {name}{backup}',
  'save.asOk': '已另存为 {name}',
  'save.failed': '保存失败：{error}',
  'save.asFailed': '另存为失败：{error}',
  'save.backupNone': '（未生成 .bak：没有选择备份位置）',
  'save.backupWith': '，原内容已备份到 {name}',
  'save.backupFail': '（未生成 .bak：{error}）',
  'backup.on': '保存前会先把磁盘上的当前内容备份为 .bak',
  'backup.off': '已关闭 .bak 备份',
  'open.ok': '已打开 {name}：{rows} 行 × {cols} 列 · 分隔符「{delim}」',
  'open.readonly': '已打开 {name}（此浏览器不支持原地写回，保存会下载副本）',
  'open.failed': '打开失败：{error}',
  'sample.only': '当前是内置示例数据，请先用「打开」载入一个真实 .csv',
  'delim.switched': '分隔符切换为「{delim}」，已重新解析',
  'source.granted': '已标注来源目录「{name}」：{n} 个标签可以显示相对路径{extra}',
  'source.outside': '（其余文件不在该目录内）',
  'source.failed': '目录授权失败：{error}',
  'source.unsupported': '这个浏览器不支持目录授权',
  'drop.file': '请拖入一个 .csv 文件',
  'drop.failed': '拖入读取失败：{error}',

  'windowClose.title': '关闭程序',
  'windowClose.msg': '有 {n} 个文件还有未保存改动。关闭前要保存吗？',
  'windowClose.saveQuit': '全部保存并关闭',
  'windowClose.quit': '直接关闭（丢弃改动）',
  'saveAll.done': '全部保存：成功 {a} 个{skip}',
  'saveAll.skip': '，跳过 {n} 个',
  'saveAll.none': '没有需要保存的改动',

  'lang.title': '语言 / Language',
  'theme.auto': '跟随系统',
  'theme.light': '浅色',
  'theme.dark': '深色',
  'theme.nord': 'Nord 深色',
  'theme.nordLight': 'Nord 浅色',
  'theme.autoHint': '按操作系统的浅色/深色设置自动切换',
  'theme.lightHint': '默认浅色',
  'theme.darkHint': '中性深色，夜间不刺眼',
  'theme.nordHint': 'nordtheme.com 的 Polar Night 配色',
  'theme.nordLightHint': '同一套 Nord 调色板的浅色版',

  'about.title': '关于 Beluga CSV Editor',
  'about.body':
    '版本 0.1.1\n\n主要创作者：DeepSeek AI（deepseek-v4-pro）\n在用户LatteMint的测试与需求指导下开发\n\n许可证：MIT License\n（完整文本见项目 LICENSE 文件）\n\n为 Starsector mod 数据文件打造的 CSV 编辑器：\n保证未改动的内容逐字节写回原文件。',

  'grid.absent': '此行在原文件中只有 {n} 个字段',
  'grid.mlBadge': '{n} 行内容',
  'grid.flagQuoted': '原文件带引号',
  'grid.flagLines': '{n} 行',
  'grid.flagDirty': '已修改',
  'grid.resize': '拖动调整列宽',
  'col.placeholder': '列 {n}',
} as const;

const en: Record<keyof typeof zh, string> = {
  'app.tagline': 'Edit in place · untouched bytes written back verbatim',
  'app.dropHint': 'You can also drop a .csv onto the window at any time',

  'welcome.open': 'Open file',
  'welcome.openDesc': ' Pick a .csv on disk and edit it; saving writes back in place',
  'welcome.sample': 'Sample preview',
  'welcome.sampleDesc': " Open the built-in rules.csv-style example ",
  'welcome.language': 'Language / 语言',
  'welcome.languageDesc': ' Switch UI language (中文 / English)',
  'welcome.about': 'About',
  'welcome.aboutDesc': ' Version, credits and license',
  'welcome.version': 'Version {v}',

  'toolbar.open': 'Open',
  'toolbar.openTitle': 'Open CSV (Ctrl+O)',
  'toolbar.save': 'Save',
  'toolbar.saveTitle': 'Save (Ctrl+S)',
  'toolbar.saveAs': 'Save as',
  'toolbar.backup': 'Backup .bak before saving',
  'toolbar.backupTitle': 'Copy the current on-disk contents to a .bak before overwriting',
  'toolbar.delimiter': 'Delimiter',
  'toolbar.delimiterTitle': 'Delimiter (changing it re-parses the file)',
  'toolbar.undo': '↶ Undo',
  'toolbar.redo': '↷ Redo',
  'toolbar.themeTitle': 'UI theme (light / dark / Nord)',

  'channel.sample': 'Sample data',
  'channel.writable': 'In-place save',
  'channel.readonly': 'Read-only · save downloads a copy',
  'chip.unsaved': 'Unsaved',
  'chip.saved': 'Saved',
  'chip.unsavedN': 'Unsaved · {n} change(s)',

  'tab.closeTitle': 'Close (Alt+W)',
  'tab.addTitle': 'Open another CSV (or drop a file onto the window)',
  'tab.title': '{detail}\nDouble-click to rename · middle-click to close · Alt+W to close',
  'tab.dirty': 'Has unsaved changes',
  'tab.renameToast': 'Tab renamed to "{name}" (this session only)',
  'tab.closed': 'Closed {name}',
  'tab.detailSample': 'sample data',
  'tab.detailReadOnly': 'read-only',
  'tab.detailRows': '{n} rows × {m} cols',

  'tabMenu.rename': 'Rename tab',
  'tabMenu.renameHint': 'Double-click tab',
  'tabMenu.copyInfo': 'Copy file info',
  'tabMenu.copyInfoDone': 'File info copied',
  'tabMenu.markSource': 'Mark source directory…',
  'tabMenu.markSourceHint': 'Show relative paths',
  'tabMenu.close': 'Close',
  'tabMenu.closeOthers': 'Close others',
  'tabMenu.closeAll': 'Close all',
  'tabMenu.saveAll': 'Save all',

  'search.placeholder': 'Search all cells… (Ctrl+F)',
  'filter.all': 'All rows',
  'filter.data': 'Data rows only',
  'filter.comment': 'Comment rows (#)',
  'filter.blank': 'Blank rows only',
  'filter.dirty': 'Changed rows only',
  'match.all': '{n} rows',
  'match.some': '{a} / {b} matched',
  'search.prev': '↑ Previous',
  'search.next': '↓ Next',

  'editor.title': 'Cell editor · R{r} · column {c} "{name}"',
  'editor.flagLines': '{n} lines',
  'editor.flagQuoted': 'quoted in source',
  'editor.flagDirty': 'changed',
  'editor.flagEmpty': 'empty',
  'editor.flagMissing': 'This row has no such field ({n} columns)',
  'editor.hint': 'Enter newline · Ctrl+Enter apply · auto-applies when the selection moves',
  'editor.hintMissing': 'This field is not in the source file; typing here extends the row',
  'editor.apply': 'Apply (Ctrl+Enter)',
  'editor.revert': 'Revert (Esc)',
  'editor.placeholder': 'Select a cell to edit it here (multiline supported)…',

  'status.line':
    '{rows} rows × {cols} cols{visible}{tabs} · {dirty} changed · cursor R{r}:C{c} "{name}" · delimiter {delim} · {enc} · {eol} · embedded newlines preserved',
  'status.visible': ' · showing {n} rows',
  'status.tabs': ' · tab {i}/{n}',

  'cellMenu.edit': 'Edit cell',
  'cellMenu.copy': 'Copy cell content',
  'cellMenu.copyDone': 'Cell content copied',
  'cellMenu.clear': 'Clear cell',
  'cellMenu.rowAbove': 'Insert row above',
  'cellMenu.rowBelow': 'Insert row below',
  'cellMenu.dupRow': 'Duplicate row',
  'cellMenu.delRow': 'Delete row',
  'cellMenu.colRight': 'Insert column right',
  'cellMenu.delCol': 'Delete column',
  'hint.f2': 'F2',
  'hint.altW': 'Alt+W',
  'hint.ctrlShiftS': 'Ctrl+Shift+S',
  'op.rowInserted': 'Row inserted',
  'op.rowDuped': 'Row duplicated',
  'op.rowDeleted': 'Row deleted',
  'op.minOneRow': 'At least one row must remain',
  'op.colInserted': 'Column inserted',
  'op.colDeleted': 'Column deleted',

  'dialog.cancel': 'Cancel',
  'dialog.openTitle': 'Open CSV',
  'dialog.detected': 'Detected delimiter',
  'dialog.encoding': 'Encoding',
  'dialog.eol': 'Line ending',
  'dialog.quoting': 'Quoting',
  'dialog.quotingValue': 'RFC 4180 ("" escapes)',
  'dialog.preview': 'Preview',
  'dialog.open': 'Open',
  'open.noteDefault':
    'Scored by how many records actually split into multiple columns; delimiters inside quotes are ignored.',
  'delim.noteOk': '{p}% of records split into multiple columns',
  'delim.noteNoHit': 'No hit: the whole table is one column',
  'delim.noteFew': 'Only {p}% of records are multi-column',
  'delim.opt.comma': 'comma  ,',
  'delim.opt.semi': 'semicolon  ;',
  'delim.opt.tab': 'tab  Tab',
  'delim.opt.pipe': 'pipe  |',
  'delim.label.comma': 'comma',
  'delim.label.semi': 'semicolon',
  'delim.label.tab': 'tab',
  'delim.label.pipe': 'pipe',

  'closeTab.title': 'Close tab',
  'closeTab.msg': '"{name}" has {n} unsaved change(s). Save before closing?',
  'closeOthers.title': 'Close other tabs',
  'closeOthers.msg': '"{name}" has {n} unsaved change(s).',
  'closeAll.title': 'Close all',
  'choice.saveClose': 'Save and close',
  'choice.discardClose': 'Close without saving',
  'choice.discardOther': 'Discard and close',
  'choice.stopOthers': 'Stop closing others',
  'choice.stop': 'Stop',

  'external.title': 'File changed on disk after opening',
  'external.msg':
    '{name} {detail} Saving now would overwrite that outside change. If another program merely touched the timestamp (antivirus, sync tools), overwriting is safe.',
  'external.sizeChanged': 'its size changed from {a} to {b} bytes',
  'external.mtimeOnly': 'its size is unchanged ({size} bytes) but the timestamp is now {stamp}',
  'choice.overwrite': 'Overwrite the on-disk version',
  'choice.saveAs': 'Save as…',
  'mid.title': 'File changed again while saving',
  'mid.msg':
    '{name} changed again during the save steps (now {size} bytes). If a .bak was written, the latest on-disk content is in it. Overwrite the current on-disk content?',
  'stuck.title': 'Save failed: the file keeps changing',
  'stuck.msg':
    '{name} changed on disk again during the write, so the browser refused it. Save as a new file, or try again.',
  'choice.retry': 'Try again',

  'reparse.title': 'Re-parsing discards unsaved changes',
  'reparse.msg': 'Switching to "{delim}" re-parses the file; the {n} unsaved change(s) would be lost. Continue?',
  'choice.reparse': 'Continue and re-parse',

  'save.nothingOpen': 'No file is open yet',
  'save.noPermission': 'No write permission; save cancelled (re-grant permission on the page and retry)',
  'save.ok': 'Saved {name}{backup}',
  'save.asOk': 'Saved as {name}',
  'save.failed': 'Save failed: {error}',
  'save.asFailed': 'Save as failed: {error}',
  'save.backupNone': ' (no .bak: no backup location was chosen)',
  'save.backupWith': ', previous contents backed up to {name}',
  'save.backupFail': ' (no .bak: {error})',
  'backup.on': 'The current on-disk contents will be backed up to .bak before saving',
  'backup.off': '.bak backup disabled',
  'open.ok': 'Opened {name}: {rows} rows × {cols} columns · delimiter "{delim}"',
  'open.readonly': 'Opened {name} (this browser cannot write in place; saving downloads a copy)',
  'open.failed': 'Open failed: {error}',
  'sample.only': 'This is the built-in sample; open a real .csv first',
  'delim.switched': 'Delimiter switched to "{delim}"; file re-parsed',
  'source.granted': 'Source directory "{name}" marked: {n} tab(s) can show relative paths{extra}',
  'source.outside': ' (the rest are outside that directory)',
  'source.failed': 'Directory grant failed: {error}',
  'source.unsupported': 'This browser does not support directory grants',
  'drop.file': 'Drop a .csv file',
  'drop.failed': 'Drop read failed: {error}',

  'windowClose.title': 'Close app',
  'windowClose.msg': '{n} file(s) still have unsaved changes. Save before closing?',
  'windowClose.saveQuit': 'Save all and close',
  'windowClose.quit': 'Close without saving',
  'saveAll.done': 'Save all: {a} saved{skip}',
  'saveAll.skip': ', {n} skipped',
  'saveAll.none': 'Nothing to save',

  'lang.title': 'Language / 语言',
  'theme.auto': 'Follow system',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.nord': 'Nord dark',
  'theme.nordLight': 'Nord light',
  'theme.autoHint': 'Follow the OS light/dark setting',
  'theme.lightHint': 'Default light',
  'theme.darkHint': 'Neutral dark, easy at night',
  'theme.nordHint': 'Polar Night palette from nordtheme.com',
  'theme.nordLightHint': 'Light variant of the Nord palette',

  'about.title': 'About Beluga CSV Editor',
  'about.body':
    "Version 0.1.1\n\nMain author: DeepSeek AI (deepseek-v4-pro)\nDeveloped with the LatteMint's testing and direction\n\nLicense: MIT License\n(full text in the project's LICENSE file)\n\nA CSV editor for Starsector mod data files that\nguarantees untouched content is written back byte for byte.",

  'grid.absent': 'This row has only {n} field(s) in the source file',
  'grid.mlBadge': '{n} lines',
  'grid.flagQuoted': 'quoted in source',
  'grid.flagLines': '{n} lines',
  'grid.flagDirty': 'changed',
  'grid.resize': 'Drag to resize',
  'col.placeholder': 'Column {n}',
};

export type MessageKey = keyof typeof zh;
export type Params = Record<string, string | number>;

let current: Language = 'zh';

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  current = language;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* persistence is best-effort */
  }
  for (const listener of listeners) listener(language);
}

const listeners = new Set<(language: Language) => void>();

/** App re-renders UI text when the language changes. */
export function onLanguageChange(listener: (language: Language) => void): void {
  listeners.add(listener);
}

export function initLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') {
      current = stored;
      return current;
    }
  } catch {
    /* fall through to the default */
  }
  return current;
}

export function t(key: MessageKey, params?: Params): string {
  const template = (current === 'en' ? en[key] : zh[key]) ?? zh[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_whole, name: string) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}
