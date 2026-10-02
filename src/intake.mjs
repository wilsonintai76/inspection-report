/*
 * intake.mjs - turning a drop (or a folder pick) into a list of files to parse.
 *
 * WHY FOLDERS NEED THEIR OWN CODE
 * -------------------------------
 * `dataTransfer.files` only ever holds the TOP LEVEL of what was dropped. Drop a folder
 * and the browser hands you one 0-byte entry named after the directory; nothing can read
 * it, so the upload reported "gagal dibaca" for a folder that held thirty good exports.
 * Folders only expand through `DataTransferItem.webkitGetAsEntry()`.
 *
 * Three browser behaviours this file is built around, none of them optional:
 *
 *   1. `webkitGetAsEntry()` must be called SYNCHRONOUSLY inside the drop handler - the
 *      DataTransferItem stops being usable the moment the handler returns. `collectDrop`
 *      is therefore the entry point, and it takes the entries before its first await.
 *   2. `FileSystemDirectoryReader.readEntries()` returns AT MOST 100 entries per call and
 *      signals the end with an EMPTY array. Taking one batch for the whole folder is
 *      silent data loss: on a real export folder that is most of the files.
 *   3. A file's path only exists in the drop payload. The folder picker gives it as
 *      `webkitRelativePath`; a dropped folder contributes its own name as the first
 *      segment, so both routes produce the same label ("2026-09/ABR.xls").
 *
 * The path is the point, not decoration. The file NAME is not unique: three month-folders
 * of the same export all contain `Senarai_Aset.xls`, and the per-file report, the
 * duplicate tab and the conflict tab cannot tell them apart without it. They used to be
 * three rows that read exactly alike, under one React key.
 *
 * Everything here is duck-typed on the FileSystemEntry shape and takes its reader through
 * `opts`, so tests/run-tests.mjs drives whole trees in Node with fabricated entries - no
 * browser, no real directory, and the 100-entry batch limit is testable.
 */

/** Extensions the parser can read. Mirrors the accept="" list on the file input. */
export const SUPPORTED_EXT = ['xls', 'xlsx', 'html', 'htm', 'csv', 'tsv', 'txt', 'json'];

/**
 * What an export folder carries that is never a table: Office lock files (~$...), the
 * macOS and Windows metadata files, and anything hidden.
 */
const JUNK_RE = /^(?:\.|~\$|desktop\.ini$|thumbs\.db$)/i;

/** Ceilings, so a mis-drop (a whole drive, a Downloads folder) cannot hang the page. */
export const LIMITS = {
  /** Files read from one drop. Past this, this page is the wrong tool for the job. */
  maxFiles: 400,
  /** Folder levels followed. Deeper than any real export layout. */
  maxDepth: 8,
  /** Total entries looked at, so a huge tree cannot be crawled entry by entry. */
  maxVisited: 2000,
  /** One file. Larger than any export this app has met. */
  maxFileBytes: 32 * 1024 * 1024,
};

/** The extension of a name or path, lowercase, without the dot. */
export function extOf(name) {
  const base = String(name || '').replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** The last segment of a path - what the rules are actually about. */
export const baseNameOf = (value) => String(value || '').replace(/\\/g, '/').split('/').pop() || '';

/** True for a lock file, a metadata file, or anything hidden. */
export const isJunkName = (name) => JUNK_RE.test(baseNameOf(name));

/** True when the parser has a chance with this file. */
export const isSupportedName = (name) => SUPPORTED_EXT.indexOf(extOf(name)) >= 0;

/**
 * What to do with one file found inside a folder: 'ok', or the reason to leave it.
 *
 * `size` is optional - 0 means "not known", which is never a reason to skip.
 */
export function classifyFile(name, size = 0) {
  if (isJunkName(name)) return 'junk';
  if (!isSupportedName(name)) return 'unsupported';
  if (size > LIMITS.maxFileBytes) return 'big';
  return 'ok';
}

/** Join a folder path and a child name the way a file browser writes it. */
export const joinPath = (dir, name) => (dir ? `${dir}/${name}` : String(name));

/** True for the { file, path } shape this module hands to the intake. */
export const isPicked = (value) => !!value && typeof value === 'object' && 'file' in value;

/* ---------------------------------------------------------------- readers ---- */

/**
 * Read one folder, completely.
 *
 * The loop is the whole point: `readEntries` hands back at most 100 entries, and an empty
 * batch - not a short one - is the end of the folder.
 */
const defaultReadDir = (dir) => new Promise((resolve, reject) => {
  const reader = dir.createReader();
  const found = [];
  const next = () => {
    reader.readEntries((batch) => {
      if (!batch || !batch.length) {
        resolve(found);
        return;
      }
      for (let i = 0; i < batch.length; i += 1) found.push(batch[i]);
      next();
    }, reject);
  };
  next();
});

const defaultFileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

/* ------------------------------------------------------------ walking ------ */

/**
 * Expand dropped entries into a flat list of files.
 *
 * @param {Array} roots entries already extracted from the drop (see `collectDrop`).
 * @param {{ readDir?: Function, fileOf?: Function, maxFiles?: number, maxDepth?: number,
 *           maxVisited?: number }} [opts] reader seams, so the tests drive fake trees.
 * @returns {Promise<{ files: Array<{ file: any, path: string }>,
 *                     skipped: Array<{ path: string, reason: string }>,
 *                     truncated: boolean }>}
 */
export async function walkEntries(roots, opts = {}) {
  const readDir = opts.readDir || defaultReadDir;
  const fileOf = opts.fileOf || defaultFileOf;
  const maxFiles = opts.maxFiles || LIMITS.maxFiles;
  const maxDepth = opts.maxDepth || LIMITS.maxDepth;
  const maxVisited = opts.maxVisited || LIMITS.maxVisited;

  const files = [];
  const skipped = [];
  let visited = 0;
  let full = false;

  const visit = async (entry, dir, depth) => {
    if (full || !entry) return;
    const path = joinPath(dir, entry.name);
    if (visited >= maxVisited) {
      full = true;
      skipped.push({ path, reason: 'limit' });
      return;
    }
    visited += 1;

    if (entry.isDirectory) {
      if (isJunkName(entry.name)) {
        skipped.push({ path, reason: 'junk' });
        return;
      }
      if (depth >= maxDepth) {
        skipped.push({ path, reason: 'deep' });
        return;
      }
      const children = await readDir(entry);
      for (let i = 0; i < children.length && !full; i += 1) {
        await visit(children[i], path, depth + 1);
      }
      return;
    }

    if (!entry.isFile) return; // neither file nor folder: nothing here can be read

    if (files.length >= maxFiles) {
      full = true;
      skipped.push({ path, reason: 'limit' });
      return;
    }

    const file = await fileOf(entry);
    const size = file && typeof file.size === 'number' ? file.size : 0;

    /*
     * A file dropped straight onto the page was chosen by hand, so only the size ceiling
     * may refuse it: the user hears the parser's own complaint instead of silence. Inside
     * a folder the rules are the folder's, because nobody hand-picked the forty
     * shortcuts, images and lock files that an export folder also contains.
     *
     * A hand-picked file has no folder, so it has no path - the same shape the flat
     * `dataTransfer.files` route and the file picker produce.
     */
    const handpicked = depth === 1 && !dir;
    const verdict = handpicked
      ? (size > LIMITS.maxFileBytes ? 'big' : 'ok')
      : classifyFile(path, size);
    if (verdict !== 'ok') {
      skipped.push({ path, reason: verdict });
      return;
    }

    files.push({ file, path: handpicked ? '' : path });
  };

  for (let i = 0; i < roots.length; i += 1) {
    if (full) break;
    await visit(roots[i], '', 1);
  }

  return { files, skipped, truncated: full };
}

/* ------------------------------------------------------------- the drop ---- */

/**
 * Snapshot a drop, then expand it.
 *
 * The snapshot is synchronous by necessity (fact 1 at the top of this file), which is why
 * this is a function and not something the caller may do itself: by the time an awaited
 * call is reached, the items are gone.
 *
 * @returns {Promise<{ files: Array<{ file: any, path: string }>, skipped: Array<object>,
 *                     truncated: boolean, usedEntries: boolean }>}
 */
export async function collectDrop(dataTransfer, opts = {}) {
  const roots = [];
  let plain = [];

  if (dataTransfer) {
    const items = dataTransfer.items ? Array.prototype.slice.call(dataTransfer.items) : [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry) roots.push(entry);
    }
    plain = dataTransfer.files ? Array.prototype.slice.call(dataTransfer.files) : [];
  }

  // No entries to walk (an older browser, or a drag from inside the page): the flat list
  // is all there is, which is exactly what the page did before folders were supported.
  if (!roots.length) {
    return { files: plain.map((file) => ({ file, path: '' })), skipped: [], truncated: false, usedEntries: false };
  }

  const walked = await walkEntries(roots, opts);
  return { ...walked, usedEntries: true };
}

/* -------------------------------------------------------- folder picker ---- */

/** The path the browser gives a picked file, or its name when there is none. */
export function relativePathOf(file) {
  const rel = file && file.webkitRelativePath ? String(file.webkitRelativePath) : '';
  return rel || (file && file.name ? String(file.name) : '');
}

/**
 * Files from an `<input type="file" webkitdirectory>` pick.
 *
 * The browser already walked the folder and the relative path is on every File, so this
 * only has to filter what the folder happened to contain. The rules match the folder-drop
 * rules on purpose: the same folder must give the same list whichever way it arrives.
 */
export function pickFromFolderInput(fileList, opts = {}) {
  const maxFiles = opts.maxFiles || LIMITS.maxFiles;
  const files = [];
  const skipped = [];
  const all = Array.prototype.slice.call(fileList || []);

  for (let i = 0; i < all.length; i += 1) {
    const file = all[i];
    const path = relativePathOf(file);
    if (files.length >= maxFiles) {
      skipped.push({ path, reason: 'limit' });
      continue;
    }
    const verdict = classifyFile(path, file && typeof file.size === 'number' ? file.size : 0);
    if (verdict !== 'ok') {
      skipped.push({ path, reason: verdict });
      continue;
    }
    files.push({ file, path });
  }

  return { files, skipped, truncated: skipped.some((s) => s.reason === 'limit') };
}
