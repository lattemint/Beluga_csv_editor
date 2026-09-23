# Beluga CSV Editor

简体中文· [English](README_EN.md)

> 就地编辑 · 未改动的字节原样写回

Beluga CSV Editor 是一个面向 Starsector mod 数据文件的桌面 CSV 编辑器——专门用来编辑
.csv文件。

## 它是什么 / 做什么

- 直接读写本地 `.csv`：自动检测分隔符（逗号 `,`、分号 `;`，也支持制表符、竖线）
- 正确识别**单元格内的换行**、引号包裹的字段、参差不齐的行、注释行（`#`）、空行
- 字节级保真写回：未编辑字段原样重放，混用 CRLF/LF 的文件也各自保留
- 多标签页、保存前自动备份 `.bak`、撤销/重做、搜索与行过滤
- 中英双语界面，深浅色 + Nord 等多套主题

## 特性速览

- **字节保真**：没碰过的单元格连引号、行尾符都原样写回
- **多标签**：同名文件用修改时间 / 大小 / 来源路径区分
- **外部改动检测**：保存前检查磁盘状态，文件被别的程序改过会提示，避免误覆盖
- **备份**：保存前把磁盘上的当前内容另存为 `.bak`
- **双形态**：既可作桌面应用（Tauri 2），也可在浏览器里当网页用（File System Access API）

## 技术栈

TypeScript + Vite 前端；
Tauri 2（Rust）桌面外壳。

## 编译 / 安装

### 需要准备的环境

| 软件 | 用途 | 版本要求 |
| --- | --- | --- |
| Node.js | 前端构建、运行脚本 | ≥ 22.6（推荐 24 LTS） |
| pnpm | 依赖管理 | ≥ 10 |
| Rust（rustup 安装） | 编译 Tauri 外壳 | stable |
| MSVC 构建工具 | Windows 下编译 Rust | Visual Studio「使用 C++ 的桌面开发」 |

> 桌面版运行需要 WebView2——Windows 10 / 11 已内置，一般无需单独安装。
> NSIS 安装器由 Tauri 在打包时自动处理，无需单独安装。

### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/lattemint/Beluga_csv_editor/.git
cd Beluga_csv_editor

# 2. 安装依赖
pnpm install

# 3a. 跑桌面开发版（热更新）
pnpm tauri dev

# 3b. 打安装包（NSIS）
pnpm tauri build
# 产物在：src-tauri/target/release/bundle/nsis/
```

### 仅当网页用

```bash
pnpm dev      # Vite 开发服务器 → http://localhost:5178
pnpm build    # 产出 dist/
pnpm preview  # 本地预览 dist/
pnpm start    # 零依赖离线构建 + 静态服务器（需 Node 24）
```

## 使用

1. 启动后是欢迎页：点**打开文件**选择 `.csv`，或直接把文件拖进窗口
2. 打开时自动检测分隔符，也可手动切换；保存前会先把当前内容备份成 `.bak`
3. 单元格支持多行：选中后在下方编辑器输入，`Ctrl+Enter` 应用
4. 右上角可切换语言（中 / 英）与主题

## 测试

```bash
pnpm typecheck 
pnpm test 
```

## 贡献

欢迎提交 issue 与 PR。项目核心不变量是**字节级保真**：任何改动请先跑 `pnpm test`，
确认语料仍逐字节一致；新增解析 / 序列化逻辑请补充 `tests/` 用例。开发自检探针见 `dev/`。

## 许可证

MIT License——完整文本见 [LICENSE.md](LICENSE.md)（安装器内随附 RTF 版）。

## 作者

- **主要创作**：DeepSeek AI（deepseek-v4-pro）
- **测试与需求指导**：LatteMint
