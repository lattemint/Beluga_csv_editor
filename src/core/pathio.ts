/**
 * Path-based file access through Tauri's Rust side.
 *
 * A file association starts the app with a path, not a FileSystemFileHandle, so
 * the browser APIs cannot read or write it. These thin wrappers call the Rust
 * commands registered in `src-tauri/src/lib.rs`. Outside the desktop app they
 * report "not available" so plain browser use keeps working unchanged.
 */

interface TauriCore {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriWindow {
  __TAURI__?: { core?: TauriCore };
}

function core(): TauriCore | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as TauriWindow).__TAURI__;
  return bridge?.core ?? null;
}

/** True in the desktop app, where a .csv can be opened by path. */
export function hasPathAccess(): boolean {
  return core() !== null;
}

/** Paths the OS handed us on launch (file association / "Open with"). */
export async function takeStartupFiles(): Promise<string[]> {
  const api = core();
  if (!api) return [];
  try {
    const files = await api.invoke<string[]>('take_startup_files');
    return Array.isArray(files) ? files : [];
  } catch {
    return [];
  }
}

export async function readPathBytes(path: string): Promise<Uint8Array> {
  const api = core();
  if (!api) throw new Error('path access is only available in the desktop app');
  const data = await api.invoke<number[]>('read_file_bytes', { path });
  return new Uint8Array(data);
}

export async function writePathBytes(path: string, bytes: Uint8Array): Promise<void> {
  const api = core();
  if (!api) throw new Error('path access is only available in the desktop app');
  // Tauri serialises command arguments as JSON; an explicit number array is the
  // predictable form (a Uint8Array would serialise as an object).
  await api.invoke('write_file_bytes', { path, contents: Array.from(bytes) });
}

export interface PathStat {
  size: number;
  /** Epoch milliseconds, matching File.lastModified. */
  mtime: number;
}

export async function statPath(path: string): Promise<PathStat> {
  const api = core();
  if (!api) throw new Error('path access is only available in the desktop app');
  return api.invoke<PathStat>('stat_file', { path });
}

export async function copyPath(from: string, to: string): Promise<void> {
  const api = core();
  if (!api) throw new Error('path access is only available in the desktop app');
  await api.invoke('copy_file', { from, to });
}

/** Last path segment, used for tab labels and the dialog title. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
