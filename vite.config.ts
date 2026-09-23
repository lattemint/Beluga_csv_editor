import { defineConfig } from 'vite';

// Standard Vite path. Requires `pnpm install` (network).
// Offline path that works without any install: `npm run build:offline` + `npm run serve`.
export default defineConfig({
  root: '.',
  server: {
    port: 5178,
    // Tauri's devUrl points at a fixed port, so the dev server must never drift.
    strictPort: true,
    watch: {
      // `tauri dev` compiles Rust into src-tauri/target while Vite is running.
      // On Windows a running .exe cannot be fs.watch'ed, so Vite's watcher
      // crashes with EBUSY unless the Rust build output is excluded. Rust-side
      // changes are rebuilt by Tauri itself, so Vite loses nothing by ignoring it.
      ignored: ['**/src-tauri/**', '**/dist/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
