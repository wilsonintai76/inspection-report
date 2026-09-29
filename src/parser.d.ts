/*
 * parser.d.ts - the declared shape of src/parser.mjs.
 *
 * The parser stays JavaScript on purpose: `tools/*.mjs` and `tests/run-tests.mjs` import that
 * exact file and run it under Node, so converting it would drag the Node side of the project
 * into the TypeScript build for no benefit to the browser.
 *
 * Declaring it here means the consumers ARE checked - the application cannot pass a file name
 * where a text is expected, or read a field the parser never returns, without a compile error.
 * The runtime behaviour is unchanged and still covered by its 187 tests.
 *
 * Only what the application actually imports is declared. If the parser is ever converted,
 * delete this file: TypeScript will then use the real implementation, and any disagreement
 * becomes a compile error rather than a silent difference.
 */

/** The five asset fields the application reads and exports. */
export declare const FIELDS: readonly string[];

export declare const EXPORT_COLUMNS: readonly string[];
export declare const EXPORT_HEADERS: readonly string[];

export interface ParsedFile {
  records: AssetRecord[];
  warnings: string[];
  meta: { format?: string; [key: string]: unknown };
}

export interface MergeSource {
  fileName: string;
  label: string;
  records: AssetRecord[];
  warnings: string[];
  meta?: Record<string, unknown>;
}

export interface MergeOptions {
  /** 'label' (the default), 'labelAndType', or 'full'. */
  keyStrategy?: string;
}

/** A merged record always carries its copy count. */
export type MergedRow = AssetRecord & { '_Bilangan Salinan': number };

export type { AssetRecord, ConflictGroup, DuplicateGroup, MergeResult, SourceStat };

/** Parse one uploaded file. Throws with a human-readable message if it cannot. */
export declare function parseFile(text: string, fileName: string, meta?: { name?: string }): ParsedFile;

/** Merge parsed sources into unique records, reporting overlaps and conflicts. */
export declare function mergeSources(sources: MergeSource[], options?: MergeOptions): MergeResult;

export declare function toCsv(
  rows: Record<string, unknown>[],
  columns?: readonly string[],
  headers?: readonly string[],
): string;

export declare function toHtmlWorkbook(
  rows: Record<string, unknown>[],
  options?: { generatedAt?: string; title?: string },
): string;

export declare function toJson(
  rows: Record<string, unknown>[],
  options?: { generatedAt?: string; summary?: unknown },
): string;
