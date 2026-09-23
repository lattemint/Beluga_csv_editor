# Beluga CSV Editor

浏览器里直接读写 Starsector mod 的 `.csv`（procgen、`rules.csv` 等）的编辑器。
目标是取代桌面版 Ron's CSV Editor，同时把**字节级保真**作为硬约束：没动过的内容，
写回时与原文件逐字节一致。

方案讨论稿见工作区根目录 `update_2026-09-10_09-35.log`，
实施日志见 `update_2026-09-10_09-52.log`。

---

## 当前进度

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 第 1 步 | 可点击界面原型（网格 / 多行单元格编辑 / 分隔符弹窗） | ✅ 完成，用无头浏览器截图验证 |
| 第 2 步 | 字节级保真解析 + 序列化核心 + 真实文件 round-trip 测试 | ✅ 完成，16/16 通过 |
| 第 3 步 | 接真实文件：File System Access 打开 / 原地保存 / `.bak` 备份 / 拖入 | ✅ 完成，probe-e 端到端 19/19 通过 |

启动时显示内置**示例数据**（`src/core/mock.ts`），这样界面不会是空的；点「打开」或把
`.csv` 拖进窗口就会换成真实文件。工具栏右侧徽章显示当前模式：
`示例数据` / `可原地保存` / `只读 · 保存会下载副本`。

## 用法

| 操作 | 方式 |
| --- | --- |
| 打开 | 工具栏「打开」（Ctrl+O），或把 `.csv` **直接拖进窗口** |
| 保存 | Ctrl+S 或「保存」——**原地写回同一个文件** |
| 另存为 | 「另存为」；浏览器不支持原地写回时自动改为下载副本 |
| 备份 | 勾选「保存前备份 .bak」（默认开）。首次保存问你 `.bak` 放哪（选择器已定位到该文件所在目录），之后静默复用 |
| 编辑 | 双击或 F2 就地编辑；底部面板始终显示选中单元格的完整内容（多行友好） |
| 导航 | 方向键 / Tab / PageUp·PageDown / Home·End；Ctrl+F 搜索；Ctrl+Z / Ctrl+Y 撤销重做 |
| 主题 | 工具栏右侧下拉：跟随系统 / 浅色 / 深色 / Nord 深色 / Nord 浅色。选择记在 localStorage，刷新与重开都保持 |
| 多标签 | 标签栏的 `+` 再开一个文件；中键或 `Alt+W` 关闭。同名文件自动加 `· 修改时间 · 大小` 后缀并配一个色点；**双击标签可自己改名**，改名后后缀与色点自动消失 |
| 标签快捷键 | `Alt+PgDn` / `Alt+PgUp` 切换，`Alt+1..9` 跳转，`Ctrl+Shift+S` 全部保存 |

> `Ctrl+W`、`Ctrl+Tab`、`Ctrl+1..9` 被浏览器保留，网页无法拦截，所以标签快捷键是 Alt 系。
>
> 标签改名只存在内存里（不写进文件、关掉即消失）。想按真实路径区分，用标签右键的
> 「标注来源目录」授权一次 mod 目录，标签就会显示 `procgen/rules.csv` 这样的相对路径。

保存时的写入顺序是「读当前文件 → 写 `.bak` → 覆盖原文件」，所以 `.bak` 里一定是
**这次保存之前**的磁盘内容。

> 原地写回依赖 File System Access API，需要 Chromium 内核（Chrome / Edge）并通过
> `localhost` 或 `https` 打开。其它浏览器仍能打开和编辑，保存会退化为下载副本。

---

## 怎么跑

### 离线通路（零依赖，现在就能用）

不需要联网、不需要 `node_modules`，也不依赖全局安装的任何东西：

```bash
cd csv-editor
node scripts/build-offline.mjs     # src/**.ts -> dist/**.js（用 Node 内置类型擦除）
node scripts/serve.mjs             # 起静态服务，默认 http://127.0.0.1:5178/
```

或者一步到位：`npm start`（= 构建 + 起服务）。

然后打开 <http://127.0.0.1:5178/>。

端口被占用时不会再抛 `EADDRINUSE` 栈：

| 情况 | 行为 |
| --- | --- |
| 端口空闲 | 直接启动 |
| 端口上跑着**本项目**的服务 | 提示"已经在运行"并打印地址，退出码 0 |
| 端口被**别的程序**占用 | 自动改用下一个空闲端口并说明原因 |
| 5178–5188 都不可用 | 提示用 `PORT=xxxx` 指定一个空闲端口 |

```bash
node scripts/serve.mjs 5199          # 指定端口
PORT=5199 node scripts/serve.mjs     # 或环境变量
HOST=0.0.0.0 node scripts/serve.mjs  # 需要局域网访问时
```

> 需要 `localhost` 而不是 `file://`：将来接 File System Access API 时它要求安全上下文。

### 标准通路（联网后）

```bash
pnpm install
pnpm dev          # Vite dev server
pnpm build        # 产物
pnpm typecheck    # tsc --noEmit
```

两条通路共用同一份 `src/`，切换时不需要改代码。

### 测试与诊断

```bash
node tests/roundtrip.test.ts                       # 保真测试套件
node dev/diagnose-roundtrip.ts <某个.csv>           # 看某个文件在第几个字节对不上
```

> 为什么不用 `node --test`：测试运行器会给每个文件起子进程，而当前沙箱禁止管道 stdio
> （`spawn EPERM`）。直接执行文件即可让 `node:test` 在**同进程内**运行，报告格式一样。

---

## 保真契约（核心设计）

"没动过的东西必须原样写回"。实现方式不是"解析得很仔细"，而是**根本不重新推导**：

- **`Cell.raw`** —— 字段在源文件里的逐字切片（含引号）。未改动的字段直接回放这串字符。
- **`Row.eol`** —— 该行自己的换行符。真实文件会**逐行**混用 CRLF / LF。
- **编辑才重写** —— 只有被改过的字段才按 RFC 4180 规范重新加引号（`needsQuoting`）。
- **撤销即还原** —— 撤销回到基线值时，连 `raw` 一起恢复，所以"改了又撤销"仍是原文。
- **换分隔符要清缓存** —— `clearRawForms()`，因为切片是按旧分隔符取的。

这样即使遇到畸形文件（实测 `LunaSettings.csv` 里有未转义的引号），也不会被写坏。

同时保证：从不 trim（引号内尾部空格是数据）、从不把 ragged 行的字段补齐、
从不统一换行风格、从不给"本来没加引号"的字段加引号。

---

## 代码结构

```
src/core/
  model.ts       数据模型：Cell（含 raw 原文切片）/ Row（含逐行 eol）/ CsvDocument
  bytes.ts       字节层：BOM 与编码探测（UTF-8 / UTF-8-BOM / UTF-16LE / BE）及回写
  parse.ts       RFC 4180 词法分析 + 编码/EOL/分隔符探测
  serialize.ts   字节级保真序列化（回放优先，规范形态兜底）
  fileio.ts      浏览器侧文件访问：打开 / 原地写回 / 选备份位置 / 目录授权 / 下载兜底
  session.ts     每个标签的状态（文档、句柄、撤销栈、选区、搜索、滚动）+ 标签命名逻辑
  mock.ts        界面启动时用的示例数据

src/types/
  file-system-access.d.ts   File System Access 三个选择器入口的环境声明

src/ui/
  app.ts         应用外壳：工具栏、搜索过滤、单元格编辑器、右键菜单、撤销重做、文件读写编排
  grid.ts        虚拟滚动网格（冻结表头行与 #/id 列、列宽可拖、多行单元格折叠显示）
  dialogs.ts     分隔符检测弹窗、右键菜单、确认框、toast
  theme.ts       主题：跟随系统 / 浅色 / 深色 / Nord 深色 / Nord 浅色，存 localStorage
  dom.ts         极小的 DOM 工具

src/styles.css   全部颜色收敛成主题令牌（4 套主题），组件规则里不出现字面色值

dev/probes/      无头浏览器自检页（见下）
dev/fixtures/    自检页用的样本 CSV
dev/diagnose-roundtrip.ts
scripts/build-offline.mjs
scripts/serve.mjs
tests/roundtrip.test.ts
```

---

## 自检截图

`dev/probes/*.html` 会被离线构建复制到 `dist/.probe/`，用无头浏览器截图即可验证界面，
不需要起 dev server：

```bash
msedge --headless=new --disable-gpu --screenshot=out.png --window-size=1680,1000 \
       --virtual-time-budget=8000 http://127.0.0.1:5178/.probe/probe-c.html
```

| 探针 | 覆盖内容 |
| --- | --- |
| probe-a | ragged 行（斜纹"字段不存在"）、`#` 注释行、全空行、带引号单元格、右键菜单 |
| probe-b | 分隔符检测弹窗与实时预览 |
| probe-c | 经界面编辑单元格 → 脏标记 / 状态栏 / 撤销按钮 |
| probe-d | 编辑后撤销 → 回到原文、`已保存` |
| probe-e | **端到端**：桩住 File System Access，走真实的打开 → 解析 → 编辑 → 保存 → `.bak`，并把断言结果打在页面上 |
| probe-f | 主题自检：`?theme=light|dark|nord|nord-light` 直接看任意主题 |
| probe-g | 多标签：两个同名文件的后缀与色点、每标签状态隔离、关闭脏标签的询问、`Alt+W`、双击重命名 |

`probe-e` 是这套东西最有价值的一张截图：它验证了"未改动保存 = 与原文件逐字节一致"、
"`.bak` 里是保存前的磁盘内容"、"改一个格子后其余单元格零变化"，全部在浏览器里跑出来。

截图留在 `.shot/`（自检产物，可删）。

---

## 已知限制

- **非 UTF-8 文件**：无 BOM 且不是合法 UTF-8 时会给警告，写回不保证逐字节一致。
- **保存会整文件重写**：没实现"只写改动区域"，大文件保存是全量写一遍。
- **`.bak` 只保留一份**：每次保存覆盖同一个 `.bak`，不做多版本轮转。
- **增删列会破坏原样回放**：被移动过的字段按规范重新引号，值不变但引号形态可能与原文件
  不同。测试已确认"只改单元格值"这条路径是逐字节安全的。
- **标签快捷键只能用 Alt 系**：`Ctrl+W` / `Ctrl+Tab` / `Ctrl+1..9` 被浏览器保留，网页拦不住。
- **标签别名只存在内存里**：关闭标签即消失，不写进文件，也不持久化。
- **无法显示真实路径**：File System Access 的文件句柄只有文件名，没有路径。
  要显示相对路径，得用标签右键的「标注来源目录」授权一次目录（只读，不浏览、不写入）。
- **`pnpm build` 和离线构建都写 `dist/`**：跑 Vite 构建会覆盖掉自检探针，需要时用
  `npm run build:offline` 重新生成。
