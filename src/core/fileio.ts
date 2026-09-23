/**
 * Browser-side file access.
 *
 * Primary path is the File System Access API (Chromium): open a real .csv and
 * write it back in place, which is the point of this editor. Browsers without
 * it fall back to <input type="file"> for opening and a download for "saving".
 *
 * Everything here touches the browser only; the CSV core stays Node-testable.
 */

export interface LoadedFile {
  /** Null when the file came from the fallback <input> and cannot be written back. */
  handle: FileSystemFileHandle | null;
  name: string;
  bytes: Uint8Array;
  /** File.size — a real disambiguator when two open files share a name. */
  size: number;
  /** File.lastModified (epoch ms) — same purpose. */
  mtime: number;
}

const OPEN_TYPES: FilePickerAcceptType[] = [
  { description: 'CSV 文件', accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt', '.csv'] } },
];

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** True when this browser can write back to the file it opened. */
export function canWriteInPlace(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

/** True when this browser has the real file picker (not the input fallback). */
export function canPickFiles(): boolean {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

export async function readHandle(handle: FileSystemFileHandle): Promise<LoadedFile> {
  const file = await handle.getFile();
  const buffer = await file.arrayBuffer();
  return {
    handle,
    name: file.name,
    bytes: new Uint8Array(buffer),
    size: file.size,
    mtime: file.lastModified,
  };
}

/** Fallback for browsers without showOpenFilePicker: read-only open. */
export function openViaInput(): Promise<LoadedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,text/plain';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.append(input);

    const finish = (value: LoadedFile | null) => {
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => {
      const file = input.files ? input.files[0] : undefined;
      if (!file) {
        finish(null);
        return;
      }
      file.arrayBuffer().then(
        (buffer) =>
          finish({
            handle: null,
            name: file.name,
            bytes: new Uint8Array(buffer),
            size: file.size,
            mtime: file.lastModified,
          }),
        (error) => {
          input.remove();
          reject(error);
        },
      );
    });
    input.addEventListener('cancel', () => finish(null));

    input.click();
  });
}

/** Returns null when the user cancelled the picker. */
export async function pickFileToOpen(): Promise<LoadedFile | null> {
  const picker = window.showOpenFilePicker;
  if (typeof picker !== 'function') return openViaInput();

  try {
    const handles = await picker.call(window, { multiple: false, types: OPEN_TYPES });
    const handle = handles[0];
    if (!handle) return null;
    return await readHandle(handle);
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

interface PermissionCapable {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

/**
 * Make sure we may write to a handle we got earlier. Permission can lapse when
 * the page is reloaded, and a lapsed permission must be re-requested from a user
 * gesture rather than failing with a confusing NotAllowedError.
 */
export async function ensureWritable(handle: FileSystemFileHandle): Promise<boolean> {
  const capable = handle as FileSystemFileHandle & PermissionCapable;
  if (typeof capable.queryPermission !== 'function') return true;

  try {
    if ((await capable.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  } catch {
    return true; // let createWritable() be the judge
  }
  if (typeof capable.requestPermission !== 'function') return true;

  try {
    return (await capable.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

export async function writeBytes(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(toBlob(bytes));
  } finally {
    await writable.close();
  }
}

export async function readBytes(handle: FileSystemFileHandle): Promise<Uint8Array> {
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

export interface FileStat {
  size: number;
  mtime: number;
}

/**
 * Refresh a handle's cached state and report the current on-disk stat.
 *
 * Chromium snapshots a file's size and modification time per handle. Once that
 * snapshot no longer matches the file on disk — because another program wrote
 * it, a sync client touched it, or the page itself wrote it through a different
 * stream — operations that depend on the snapshot are refused with
 * InvalidStateError: "An operation that depends on state cached in an interface
 * object was made but the state had changed since it was read from disk".
 *
 * `getFile()` is what re-reads the file and refreshes that snapshot, so calling
 * it immediately before a write is both the fix and the way to find out whether
 * somebody else changed the file behind our back.
 */
export async function statFile(handle: FileSystemFileHandle): Promise<FileStat> {
  const file = await handle.getFile();
  return { size: file.size, mtime: file.lastModified };
}

const STALE_STATE = /state had changed since it was read from disk/i;

/** True for the stale-handle error described on statFile(). */
export function isStaleHandleError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (STALE_STATE.test(error.message)) return true;
  return error.name === 'InvalidStateError' && /state cached/i.test(error.message);
}

/**
 * Write bytes, refreshing the snapshot and retrying once if it went stale in the
 * window between our read and our write. A change landing in that window is a
 * race, not a mistake, so one retry is the right response.
 */
export async function writeBytesResilient(
  handle: FileSystemFileHandle,
  bytes: Uint8Array,
): Promise<void> {
  try {
    await writeBytes(handle, bytes);
  } catch (error) {
    if (!isStaleHandleError(error)) throw error;
    await statFile(handle);
    await writeBytes(handle, bytes);
  }
}

/** Returns null when the user cancelled. */
export async function pickSaveTarget(
  suggestedName: string,
  startIn?: FileSystemFileHandle,
): Promise<FileSystemFileHandle | null> {
  const picker = window.showSaveFilePicker;
  if (typeof picker !== 'function') return null;

  const base: SaveFilePickerOptions = { suggestedName, types: OPEN_TYPES };
  try {
    return startIn
      ? await picker.call(window, { ...base, startIn })
      : await picker.call(window, base);
  } catch (error) {
    if (isAbort(error)) return null;
    // A few Chromium builds reject `startIn` given a file handle; retry plainly.
    if (!startIn) throw error;
    try {
      return await picker.call(window, base);
    } catch (retry) {
      if (isAbort(retry)) return null;
      throw retry;
    }
  }
}

/**
 * Ask where the .bak should live, once per file. `startIn` opens the picker in
 * the same folder as the CSV, so the usual flow is a single extra click.
 */
export async function pickBackupTarget(
  suggestedName: string,
  startIn?: FileSystemFileHandle,
): Promise<FileSystemFileHandle | null> {
  const picker = window.showSaveFilePicker;
  if (typeof picker !== 'function') return null;

  const base: SaveFilePickerOptions = {
    suggestedName,
    types: [{ description: 'CSV 备份', accept: { 'text/csv': ['.bak', '.csv'] } }],
  };
  try {
    return startIn
      ? await picker.call(window, { ...base, startIn })
      : await picker.call(window, base);
  } catch (error) {
    if (isAbort(error)) return null;
    if (!startIn) throw error;
    try {
      return await picker.call(window, base);
    } catch (retry) {
      if (isAbort(retry)) return null;
      throw retry;
    }
  }
}

/** Fallback "save": the browser downloads a copy. Not in-place. */
export function downloadBytes(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(toBlob(bytes));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Ask for a source directory, once, so tabs can show real relative paths.
 *
 * This is the only way to recover a path: a file handle exposes just its name,
 * and `resolve()` on a directory handle is the one API that maps a child handle
 * back to a path. Read-only — it never browses or writes anything.
 */
export async function pickSourceDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const picker = window.showDirectoryPicker;
  if (typeof picker !== 'function') return null;
  try {
    return await picker.call(window, { id: 'csv-editor-source', mode: 'read' });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** Path of `handle` relative to a granted directory, or null when it is outside. */
export async function resolveWithin(
  directory: FileSystemDirectoryHandle,
  handle: FileSystemFileHandle,
): Promise<string | null> {
  const capable = directory as FileSystemDirectoryHandle & {
    resolve?: (child: FileSystemHandle) => Promise<string[] | null>;
  };
  if (typeof capable.resolve !== 'function') return null;
  try {
    const parts = await capable.resolve.call(directory, handle);
    return parts !== null && parts.length > 0 ? parts.join('/') : null;
  } catch {
    return null;
  }
}

/**
 * Wrap bytes in a Blob before handing them to the FS API. Going through Blob
 * keeps the call sites free of the ArrayBuffer-vs-SharedArrayBuffer generic
 * mismatch that Uint8Array picked up in recent TypeScript versions.
 */
function toBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy], { type: 'text/csv;charset=utf-8' });
}
