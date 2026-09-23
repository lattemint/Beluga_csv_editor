# Beluga CSV Editor

English · [简体中文](README.md)

> Edit in place · untouched bytes written back verbatim

Beluga CSV Editor is a desktop CSV editor for Starsector mod data files — built for editing `.csv` files.

## What it is / what it does

- Read and write local `.csv` directly: auto-detect delimiters (comma `,`, semicolon `;`, plus tab and pipe)
- Correctly handle **newlines inside cells**, quoted fields, ragged rows, comment rows (`#`) and blank rows
- Byte-faithful writes: untouched fields are replayed verbatim; files mixing CRLF/LF keep each line ending
- Multi-tab, automatic `.bak` backup before saving, undo/redo, search and row filtering
- Bilingual UI (Chinese / English), multiple themes including light, dark and Nord

## Highlights

- **Byte fidelity**: cells you don't touch are written back exactly, quotes and line endings included (131 real mod files verified byte-for-byte)
- **Multi-tab**: same-named files are disambiguated by mtime / size / source path
- **External-change detection**: disk state is checked before saving; if another program changed the file, you get a prompt instead of a silent overwrite
- **Backup**: the current on-disk contents are saved to `.bak` before saving
- **Two shapes**: desktop app (Tauri 2), or in-browser web app (File System Access API)

## Tech stack

TypeScript + Vite frontend; Tauri 2 (Rust) desktop shell; no backend — all data stays local.

## Build / install

### Prerequisites

| Software | Purpose | Version |
| --- | --- | --- |
| Node.js | Frontend build & scripts | ≥ 22.6 (24 LTS recommended) |
| pnpm | Dependency management | ≥ 10 |
| Rust (via rustup) | Build the Tauri shell | stable |
| MSVC build tools | Compile Rust on Windows | Visual Studio "Desktop development with C++" |

> The desktop app needs WebView2 — preinstalled on Windows 10 / 11, no separate install required.
> The NSIS installer is handled automatically by Tauri at bundle time.

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/lattemint/Beluga_csv_editor.git
cd Beluga_csv_editor

# 2. Install dependencies
pnpm install

# 3a. Run the desktop dev build (hot reload)
pnpm tauri dev

# 3b. Build the installer (NSIS)
pnpm tauri build
# output at: src-tauri/target/release/bundle/nsis/
```

### Web-only usage

```bash
pnpm dev      # Vite dev server → http://localhost:5178
pnpm build    # output to dist/
pnpm preview  # preview dist/ locally
pnpm start    # zero-dependency offline build + static server (requires Node 24)
```

## Usage

1. Start on the welcome screen: click **Open file** and pick a `.csv`, or just drop a file into the window
2. The delimiter is auto-detected on open (switchable); saving first backs up the current contents to `.bak`
3. Cells support multiple lines: select one and edit in the panel below, then `Ctrl+Enter` to apply
4. Switch language (Chinese / English) and theme from the top-right

## Testing

```bash
pnpm typecheck   # type check
pnpm test        # byte-fidelity regression (131 real files compared byte-for-byte)
```

## Contributing

Issues and PRs are welcome. The core invariant is **byte fidelity**: run `pnpm test` before submitting to confirm the corpus stays byte-identical; add `tests/` cases for new parsing / serialization logic. Self-check probes live in `dev/`.

## License

MIT License — see [LICENSE.md](LICENSE.md) for the full text (an RTF copy ships with the installer).

## Author

- **Main author**: DeepSeek AI (deepseek-v4-pro)
- **Testing & direction**: LatteMint
