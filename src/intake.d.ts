/*
 * intake.d.ts - the declared shape of src/intake.mjs.
 *
 * Same reasoning as parser.d.ts: the module stays JavaScript so tests/run-tests.mjs can
 * import that exact file and run it under Node. Declaring the shape here means the
 * application side is still checked - the drop handler cannot pass a DataTransfer where a
 * FileList is expected, or read a field the walk never returns.
 */

/** One file, with the path it had inside the folder it came from ('' when picked alone). */
export interface PickedFile {
  file: File;
  path: string;
}

/** Why a file that was in the drop is not being read. */
export type SkipReason = 'junk' | 'unsupported' | 'big' | 'deep' | 'limit';

export interface SkippedFile {
  path: string;
  reason: SkipReason;
}

export interface IntakeResult {
  files: PickedFile[];
  skipped: SkippedFile[];
  /** True when a ceiling stopped the walk, so the list in hand is not the whole tree. */
  truncated: boolean;
}

/** The duck-typed shape of a FileSystemEntry, as far as this module uses it. */
export interface EntryLike {
  name: string;
  isFile?: boolean;
  isDirectory?: boolean;
  file?: (ok: (file: File) => void, fail?: (err: unknown) => void) => void;
  createReader?: () => unknown;
}

/** Reader seams, so Node tests can drive fake trees. */
export interface WalkOptions {
  readDir?: (dir: EntryLike) => Promise<EntryLike[]>;
  fileOf?: (entry: EntryLike) => Promise<File>;
  maxFiles?: number;
  maxDepth?: number;
  maxVisited?: number;
}

export declare const SUPPORTED_EXT: string[];
export declare const LIMITS: {
  maxFiles: number; maxDepth: number; maxVisited: number; maxFileBytes: number;
};

export declare function extOf(name: string): string;
export declare function baseNameOf(value: string): string;
export declare function isJunkName(name: string): boolean;
export declare function isSupportedName(name: string): boolean;
export declare function classifyFile(name: string, size?: number): SkipReason | 'ok';
export declare function joinPath(dir: string, name: string): string;
export declare function isPicked(value: unknown): value is PickedFile;

export declare function walkEntries(roots: EntryLike[], opts?: WalkOptions): Promise<IntakeResult>;

/** The drop payload, expanded. `usedEntries` says which route produced the list. */
export declare function collectDrop(
  dataTransfer: DataTransfer | null | undefined,
  opts?: WalkOptions,
): Promise<IntakeResult & { usedEntries: boolean }>;

export declare function relativePathOf(file: File): string;

export declare function pickFromFolderInput(
  fileList: FileList | File[] | null | undefined,
  opts?: { maxFiles?: number },
): IntakeResult;
