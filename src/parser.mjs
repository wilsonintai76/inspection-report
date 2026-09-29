/*
 * parser.mjs - shared, dependency-free parser for the JKM "Senarai Aset Belum
 * Periksa" exports and other common tabular files.
 *
 * This exact file is inlined into the browser app at build time, so the app and
 * the Node test-suite run byte-identical parsing logic.
 *
 * The real source files are NOT real .xls workbooks: they are HTML table dumps
 * saved with an .xls extension. They are also malformed - some <tr> tags are
 * never closed and extra </tr> tags appear. So we parse cells into a flat stream
 * with explicit row-break sentinels, rather than relying on <tr> nesting.
 *
 * THE LABEL IS THE IDENTITY. One asset = one label, like an identity card, so a
 * label is never expected to repeat. There is deliberately no Status field: it is
 * not identity data, and 532 of 536 assets carried the same value.
 *
 * ASCII ONLY. This file is rewritten by PowerShell scripts during development,
 * and non-ASCII characters do not survive that round-trip reliably. Keep every
 * byte in the 0x00-0x7F range: write "->" instead of an arrow, "-" instead of an
 * em dash, and use \uXXXX escapes for any non-ASCII value that is genuinely
 * needed. User-facing Malay text in this project needs no diacritics.
 */

export const FIELDS = [
  'Label',
  'Jenis Aset',
  'Pegawai Penempatan',
  'Bahagian',
  'Lokasi Terkini',
];

/** The field that identifies an asset. One asset = one label. */
export const IDENTITY_FIELD = 'Label';

/**
 * Named HTML entities we may meet, including the accented letters that appear in
 * Malaysian staff names. Values use \u escapes so this file stays ASCII.
 */
const ENTITIES = {
  nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&',
  aacute: '\u00e1', eacute: '\u00e9', iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa',
  Aacute: '\u00c1', Eacute: '\u00c9', Iacute: '\u00cd', Oacute: '\u00d3', Uacute: '\u00da',
  agrave: '\u00e0', egrave: '\u00e8', igrave: '\u00ec', ograve: '\u00f2', ugrave: '\u00f9',
  acirc: '\u00e2', ecirc: '\u00ea', icirc: '\u00ee', ocirc: '\u00f4', ucirc: '\u00fb',
  atilde: '\u00e3', ntilde: '\u00f1', otilde: '\u00f5',
  auml: '\u00e4', euml: '\u00eb', iuml: '\u00ef', ouml: '\u00f6', uuml: '\u00fc',
  ccedil: '\u00e7', oslash: '\u00f8', aring: '\u00e5',
  hellip: '\u2026', ndash: '\u2013', mdash: '\u2014',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d',
  deg: '\u00b0', times: '\u00d7', middot: '\u00b7', bull: '\u2022',
  euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', sect: '\u00a7', para: '\u00b6',
};

/** Decode numeric and named HTML entities. Unknown entities are left alone. */
export function decodeEntities(input) {
  return String(input).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try { return String.fromCodePoint(code); } catch { return whole; }
      }
      return whole;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

/**
 * Matches things that really are HTML tags: a known element name, a closing tag,
 * or a comment/PI. Deliberately does NOT match bare angle brackets, so a data
 * value such as `A & B <X>` survives intact. Tag bodies are length-bounded so
 * prose like "a < b and c > d" is not mistaken for markup.
 */
const REAL_TAG_RE = /<\/?(?:a|b|i|u|em|strong|span|div|p|br|font|small|big|sub|sup|strike|table|thead|tbody|tfoot|tr|td|th|caption|col|colgroup|ul|ol|li|dl|dt|dd|h[1-6]|pre|code|blockquote|img|hr|nobr|center|section|article|header|footer|nav|form|input|select|option|textarea|button|label|script|style|meta|link|title|head|body|html)\b[^>]{0,200}>/gi;
const COMMENT_OR_PI_RE = /<!--[\s\S]{0,2000}?-->|<\?[\s\S]{0,500}?\?>/g;

/**
 * Strip markup and normalise whitespace. Tag removal is conditional so that
 * angle brackets in real data (e.g. "A & B <X>") are not destroyed.
 */
export function cleanText(input) {
  let s = String(input);
  REAL_TAG_RE.lastIndex = 0;
  COMMENT_OR_PI_RE.lastIndex = 0;
  if (REAL_TAG_RE.test(s) || COMMENT_OR_PI_RE.test(s)) {
    s = s.replace(COMMENT_OR_PI_RE, ' ').replace(REAL_TAG_RE, ' ');
  }
  REAL_TAG_RE.lastIndex = 0;
  COMMENT_OR_PI_RE.lastIndex = 0;
  return decodeEntities(s)
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalise a label/id for comparison: uppercase, collapse separators. */
export function normaliseLabel(input) {
  return String(input)
    .replace(/\s+/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .toUpperCase();
}

/**
 * Marker embedded in the header cells of columns that are deliberately NOT one
 * of the six asset fields, e.g. the "Sumber Fail" column this app writes.
 *
 * A zero-width space is used so the exported header still reads cleanly in Excel
 * while the marker survives both the HTML and CSV round-trips. It lets the header
 * detector keep extension columns attached instead of guessing from text alone.
 */
export const EXTRA_COLUMN_MARKER = '\u200b';

/** True when a header cell is marked as belonging to an extension column. */
function isExtensionCell(value) {
  return String(value).indexOf(EXTRA_COLUMN_MARKER) >= 0;
}

/** Remove the extension-column marker from a header cell. */
function stripExtensionMarker(value) {
  return String(value).split(EXTRA_COLUMN_MARKER).join('');
}

/** Stable key for detecting fully-identical records. */
export function recordKey(record) {
  return FIELDS.map((f) => String(record[f] ?? '').toUpperCase()).join('\u0001');
}

export function emptyRecord() {
  const record = {};
  for (const field of FIELDS) record[field] = '';
  return record;
}

/* ------------------------------------------------------------------ *
 * HTML table parsing
 * ------------------------------------------------------------------ */

/**
 * Group a flat list of cells into rows of `width` cells.
 * A `null` is a row-break sentinel, not an empty cell: it must never be written
 * into a record, so it flushes the current row and starts a new one.
 * Returns { rows, skipped }.
 */
function groupCells(cells, width) {
  const rows = [];
  let skipped = 0;
  let buffer = [];

  const flush = () => {
    if (buffer.length === 0) return;
    if (buffer.filter((v) => v !== '').length >= 2) rows.push(buffer);
    else skipped += 1;
    buffer = [];
  };

  for (const cell of cells) {
    if (cell === null) { flush(); continue; }
    if (cell === '' && buffer.length === 0) continue; // no leading blanks
    buffer.push(cell);
    if (buffer.length === width) { rows.push(buffer); buffer = []; }
  }
  flush();
  return { rows, skipped };
}

/**
 * Detect whether a row of cells is a header, and return the column order.
 * `min` scales with row length so a narrow header (e.g. just "Label",
 * "Jenis Aset") is still recognised.
 */
function matchHeaderRow(row, min) {
  const norm = (v) => cleanText(v).toLowerCase().replace(/[^a-z]/g, '');
  const map = row.map((cell) => FIELDS.findIndex((f) => norm(f) === norm(cell)));
  const matched = map.filter((i) => i >= 0).length;
  const need = min ?? Math.min(3, Math.max(2, Math.ceil(row.length / 2)));
  return matched >= need ? map : null;
}

/**
 * Pick the file's true data width by finding the most common populated cell
 * count per row bucket. This is what makes a header with the wrong number of
 * columns harmless: the DATA decides the width, never the header.
 */
function dominantRowWidth(rows, fallback) {
  const counts = new Map();
  for (const row of rows) {
    const n = row.filter((v) => v !== '').length;
    if (n > 0) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  if (counts.size === 0) return fallback;

  let best = fallback;
  let bestScore = -1;
  for (const [width, count] of counts) {
    // Prefer the most common width; break ties toward the wider row, since
    // asset tables are rectangular while stray text rows are narrow.
    const score = count * 1000 + width;
    if (score > bestScore) { bestScore = score; best = width; }
  }
  return best;
}

/** Split a flat cell stream into rows at `null` row-break sentinels. */
function groupCellsByBoundary(cells) {
  const rows = [];
  let current = [];
  for (const cell of cells) {
    if (cell === null) {
      if (current.length) rows.push(current);
      current = [];
    } else {
      current.push(cell);
    }
  }
  if (current.length) rows.push(current);
  return rows;
}

/**
 * Turn a cell stream plus an optional header into records.
 *
 * Header containment: `headerTexts` are the header's own cells in order. If the
 * stream still begins with those cells (the HTML exports, where malformed markup
 * makes the header row and the first data row share one <tr>), that prefix is
 * removed here. Removal stops at the first row-break sentinel, so a data row
 * sharing the header's <tr> is kept rather than swallowed.
 *
 * The number of columns per data row is authoritative. A header that declares a
 * different number of columns is discarded rather than allowed to shift cells.
 */
function assembleRecords(cells, headerTexts, warnings, meta) {
  const dataCells = Array.isArray(cells) ? cells : [];
  const headerCells = headerTexts && headerTexts.length ? headerTexts : null;
  const headerColumns = headerCells ? headerCells.length : 0;

  // When the header is inline, it occupies as many cells as ONE SOURCE ROW - not
  // as many cells as we map. The source exports are 6 columns wide and we track 5
  // of them, so stripping only 5 would leave "Status Aset" behind as a phantom
  // first record and shift everything by one field.
  const startsWith = (prefixLen) => {
    if (!headerCells || prefixLen > dataCells.length) return false;
    for (let i = 0; i < prefixLen; i += 1) {
      if (dataCells[i] !== headerCells[i]) return false;
    }
    return true;
  };
  const startsWithHeader = startsWith(headerCells ? headerCells.length : 0);

  let bodyCells = dataCells;
  if (startsWithHeader) {
    const firstBreak = dataCells.findIndex((c, i) => c === null && i >= headerCells.length);
    const end = firstBreak === -1 ? dataCells.length : firstBreak;

    // Work out the file's real column count from the buckets that follow the
    // header, then consume exactly one header row.
    const restBuckets = groupCellsByBoundary(
      firstBreak === -1 ? [] : dataCells.slice(firstBreak + 1),
    );
    const rowWidth = dominantRowWidth(restBuckets, 0);
    const consume = (rowWidth > 0 && startsWith(rowWidth)) ? rowWidth : headerCells.length;

    const remainder = end - consume;
    bodyCells = [
      ...dataCells.slice(consume, end),
      // Preserve the row break between the header row and the data that shared
      // its <tr>; without it the first data row would be misaligned.
      ...(remainder > 0 ? [null] : []),
      ...dataCells.slice(end),
    ];
  }

  const buckets = groupCellsByBoundary(bodyCells);
  let dataWidth = dominantRowWidth(buckets, 0);
  if (dataWidth === 0 && headerColumns) dataWidth = headerColumns;
  if (dataWidth === 0) dataWidth = FIELDS.length;

  const headerOrder = headerCells ? matchHeaderRow(headerCells) : null;

  // A header maps columns when its cells line up, position for position, with the
  // fields we track. The header does NOT have to cover every data column: the
  // source exports still carry a trailing "Status Aset" column that this app no
  // longer tracks, and it must be read past rather than allowed to shift every
  // field out of position. Cells past the header's last mapped column are dropped
  // by the record builder, because map[i] is undefined there.
  const mapsAllTrackedFields = !!headerOrder
    && headerOrder.filter((i) => i >= 0).length === FIELDS.length;
  // A header WIDER than the data would shift rows, so reject it: that means the
  // header row contains something that is not a column name.
  const headerFitsInsideData = !!headerOrder && headerColumns <= dataWidth;
  const headerUsable = mapsAllTrackedFields && headerFitsInsideData;
  const map = headerUsable ? headerOrder : FIELDS.map((_, i) => i);

  if (!headerUsable) {
    if (headerCells && headerColumns > dataWidth) {
      warnings.push(
        'Baris tajuk mempunyai lebih banyak lajur daripada baris data '
        + `(tajuk ${headerColumns}, data ${dataWidth}); ia mungkin merangkumi baris data. `
        + 'Data dibaca mengikut susunan lajur lalai.',
      );
    } else if (headerCells && !mapsAllTrackedFields) {
      const found = headerOrder ? headerOrder.filter((i) => i >= 0).length : 0;
      warnings.push(
        `Baris tajuk tidak meliputi kesemua medan yang dijejaki (${found} daripada ${FIELDS.length}). `
        + 'Data dibaca mengikut susunan lajur lalai.',
      );
    } else {
      warnings.push(
        'Baris tajuk tidak dikesan - menggunakan susunan lajur lalai '
        + '(Label, Jenis Aset, Pegawai Penempatan, Bahagian, Lokasi Terkini).',
      );
    }
  }

  const { rows, skipped } = groupCells(bodyCells, dataWidth);
  if (skipped > 0) warnings.push(`${skipped} baris tidak lengkap diabaikan.`);

  if (globalThis.__PARSER_DEBUG__) {
    console.log('[assembleRecords] dataWidth:', dataWidth, 'headerColumns:', headerColumns,
      'startsWithHeader:', startsWithHeader, 'headerUsable:', headerUsable,
      'rows:', rows.length, 'map:', JSON.stringify(map));
  }

  const records = [];
  for (const row of rows) {
    const record = emptyRecord();
    let extensionMarkerSeen = false;
    row.forEach((value, index) => {
      const text = stripExtensionMarker(value);
      if (text !== value) extensionMarkerSeen = true;
      const target = map[index];
      // Extra columns beyond the six known fields (e.g. an exported
      // "Sumber Fail") map to undefined and are dropped on purpose.
      if (target >= 0 && target < FIELDS.length) {
        record[FIELDS[target]] = text;
      }
    });
    // A row carrying the extension marker is a header we failed to recognise;
    // never emit it as an asset.
    if (extensionMarkerSeen) continue;
    if (!record.Label && !record['Jenis Aset']) continue;
    record.Label = normaliseLabel(record.Label);
    records.push(record);
  }

  return {
    records,
    warnings,
    meta: {
      columns: map.map((i) => FIELDS[i] ?? '(tidak dijejaki)'),
      width: dataWidth,
      ...meta,
    },
  };
}

/**
 * Remove script/style/comment/head markup so their contents can never be
 * mistaken for table text. The real JKM exports carry a <script> block with a
 * "yearSelect=2026&negeri=13" URL, so this matters.
 */
function stripNonTableMarkup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ');
}

/** Count table cells in a fragment; used to pick the real data table. */
function countCells(html) {
  return (html.match(/<t[dh]\b/gi) ?? []).length;
}

/**
 * Find how many leading cells form the table's header, or 0 if none does.
 *
 * A header is recognised structurally: its cells must follow the known column
 * sequence (Label, Jenis Aset, ...) from the start, optionally interleaved with
 * cells that are explicitly marked as extension columns. Scanning starts at
 * index 0 only, because the exports put the header in the first row.
 *
 * This rule is what makes the JKM exports work. They are malformed, with the
 * header row and the FIRST data row sharing a single <tr>, so the first bucket
 * holds 12 cells for a 6-column table. The run stops the moment "Label" would
 * have to be followed by "KPT/PKS/H/89/91" instead of "Jenis Aset", so the
 * header is correctly reported as 6 columns and the data row stays intact.
 */
function detectHeaderPrefix(cells) {
  const norm = (v) => cleanText(v).toLowerCase().replace(/[^a-z]/g, '');
  const fields = FIELDS.map(norm);
  const limit = Math.min(cells.length, fields.length + 4);

  let fieldIndex = 0;
  let best = 0;

  for (let i = 0; i < limit; i += 1) {
    const cell = cells[i];
    if (cell === null || cell === '') break;

    // A marked extension column is part of the header wherever it appears, once
    // the header is clearly under way.
    if (isExtensionCell(cell) && fieldIndex >= 2) {
      best = i + 1;
      continue;
    }

    if (fields.indexOf(norm(cell)) === fieldIndex) {
      fieldIndex += 1;
      best = i + 1;
      continue;
    }

    // Anything else means the run has reached real data; stop without guessing.
    if (fieldIndex >= 2) break;
    return 0; // the leading cells are not column names at all
  }

  return fieldIndex >= 2 ? best : 0;
}

/**
 * Extract table cells without a DOM, tolerating unclosed <tr> and <td> tags.
 * Emits a `null` row-break sentinel at every </tr> so downstream grouping can
 * use the document's real row boundaries. When a cell never closes, its capture
 * stops at the next cell or row boundary, mirroring browser markup repair.
 * Returns { cells, headerTexts }.
 */
function scanHtmlTableParts(text) {
  // Comments are removed BEFORE looking for <table> so that a comment which
  // merely mentions a table (as this project's own export header does) cannot
  // be mistaken for a real one.
  const source = stripNonTableMarkup(text)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ');

  // A page can hold several tables (title/body wrappers, summaries, the real
  // data). Choose the one with the most cells, which is the asset list.
  const blocks = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi;
  let tb;
  while ((tb = tableRe.exec(source)) !== null) blocks.push(tb[1]);
  const scope = blocks.length
    ? blocks.reduce((best, b) => (countCells(b) > countCells(best) ? b : best), blocks[0])
    : source;

  const cellRe = /<(t[dh])\b[^>]*?(?:\/>|>([\s\S]*?)(?=<\/t[dh]\s*>|<\/tr\s*>|<t[dh]\b|<tr\b|$))(?:<\/t[dh]\s*>)?/gi;
  const rowBreakRe = /<\/tr\s*>/gi;
  const cells = [];
  const thTexts = [];

  // Walk cells and row-closing tags together, in document order, so each cell
  // lands inside the correct row bucket.
  const events = [];
  let m;
  while ((m = cellRe.exec(scope)) !== null) {
    events.push({ at: m.index, kind: 'cell', tag: m[1].toLowerCase(), value: cleanText(m[2] ?? '') });
    if (m.index === cellRe.lastIndex) cellRe.lastIndex += 1; // zero-width guard
  }
  while ((m = rowBreakRe.exec(scope)) !== null) {
    events.push({ at: m.index, kind: 'rowbreak' });
  }
  events.sort((a, b) => a.at - b.at || (a.kind === 'rowbreak' ? -1 : 1));

  for (const ev of events) {
    if (ev.kind === 'rowbreak') {
      // Collapse runs of row breaks into a single sentinel.
      if (cells.length && cells[cells.length - 1] !== null) cells.push(null);
      continue;
    }
    cells.push(ev.value);
    if (ev.tag === 'th') thTexts.push(ev.value);
  }

  // Prefer an explicit <th> header when it maps onto known columns.
  let header = thTexts.length && matchHeaderRow(thTexts) ? thTexts : null;

  // Otherwise the exports mark the header with <td><b>...</b></td>, so look for
  // the shortest leading run of column names.
  if (!header) {
    const len = detectHeaderPrefix(cells);
    if (len > 0) header = cells.slice(0, len);
  }

  return { cells, headerTexts: header };
}

/**
 * Parse an HTML table dump into records.
 * @param {string} text raw file contents
 * @param {{label?: string, name?: string, engine?: 'auto'|'dom'|'scan'}} meta source metadata.
 *        `engine` is mainly for the self-test: it forces one of the two
 *        equivalent extraction paths so both can be proven to agree.
 */
export function parseHtmlTable(text, meta = {}) {
  const warnings = [];
  const engine = meta.engine || 'auto';
  const hasDom = engine !== 'scan' && typeof DOMParser === 'function';
  if (engine === 'dom' && typeof DOMParser !== 'function') {
    throw new Error('Enjin DOM diminta tetapi DOMParser tidak tersedia dalam persekitaran ini.');
  }

  let cells;
  let headerTexts = null;

  if (hasDom) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const nodes = Array.from(doc.querySelectorAll('td, th'));
    if (nodes.length === 0) {
      throw new Error('Tiada jadual (<td>/<th>) dijumpai dalam fail ini.');
    }
    // Rebuild the flat stream with row-break sentinels taken from real rows.
    // Prefer the table with the most cells, matching the DOM-free scanner.
    const tables = Array.from(doc.querySelectorAll('table'));
    const best = tables.length
      ? tables.reduce((b, t) => (t.querySelectorAll('td, th').length > b.querySelectorAll('td, th').length ? t : b), tables[0])
      : doc;
    cells = [];
    const thTexts = [];
    Array.from(best.querySelectorAll('tr')).forEach((tr) => {
      const rowCells = Array.from(tr.querySelectorAll('td, th'));
      if (rowCells.length === 0) return;
      rowCells.forEach((node) => {
        const value = cleanText(node.textContent);
        cells.push(value);
        if (node.tagName.toLowerCase() === 'th') thTexts.push(value);
      });
      cells.push(null);
    });
    if (thTexts.length && matchHeaderRow(thTexts)) headerTexts = thTexts;
  } else {
    const parts = scanHtmlTableParts(text);
    cells = parts.cells;
    headerTexts = parts.headerTexts;
  }

  if (!cells || cells.filter((c) => c !== null).length === 0) {
    throw new Error('Tiada jadual (<td>/<th>) dijumpai dalam fail ini.');
  }

  // Detect the header the same way for both engines, so they cannot diverge.
  if (!headerTexts) {
    const len = detectHeaderPrefix(cells);
    if (len > 0) headerTexts = cells.slice(0, len);
  }

  // The detected prefix covers only the fields we track, but the header ROW may
  // be wider - the source exports carry a trailing "Status Aset" column. Extend
  // the header to one full source row so that column is stripped with the header
  // rather than left behind as a phantom record.
  if (headerTexts) {
    const firstBreak = cells.findIndex((c) => c === null);
    const end = firstBreak === -1 ? cells.length : firstBreak;
    if (end > headerTexts.length) {
      const restBuckets = groupCellsByBoundary(
        firstBreak === -1 ? [] : cells.slice(firstBreak + 1),
      );
      const rowWidth = dominantRowWidth(restBuckets, 0);
      if (rowWidth > headerTexts.length
          && end >= rowWidth
          && cells.slice(0, headerTexts.length).every((c, i) => c === headerTexts[i])) {
        headerTexts = cells.slice(0, rowWidth);
      }
    }
  }

  const result = assembleRecords(cells, headerTexts, warnings, { format: 'Jadual HTML (.xls)' });
  if (result.records.length === 0) {
    result.warnings.push('Tiada baris data dijumpai selepas tajuk.');
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * CSV / TSV parsing
 * ------------------------------------------------------------------ */

/** Quote-aware split of delimited text into rows of fields. */
export function parseDelimited(text, delimiter) {
  const records = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) records.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((v) => v !== '')) records.push(row);
  return records;
}

export function parseCsv(text, meta = {}) {
  const warnings = [];
  const body = text.replace(/^\uFEFF/, '');
  const lines = body.split(/\r?\n/);
  const firstLine = lines[0] ?? '';

  // Pick the delimiter that yields the most fields on the first line. Splitting
  // is quote-aware so quoted delimiters do not skew the vote.
  const candidates = [',', ';', '\t', '|'];
  let delimiter = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const n = parseDelimited(firstLine, d)[0]?.length ?? 0;
    if (n > bestCount) { bestCount = n; delimiter = d; }
  }

  const rows = parseDelimited(body, delimiter);
  if (rows.length === 0) throw new Error('Fail CSV kosong.');

  const first = rows[0].map((v) => cleanText(v));
  const headerDetected = !!matchHeaderRow(first);

  // The header stays first in the stream (assembleRecords strips it when it is
  // usable) so that this path behaves exactly like the HTML one.
  const cells = [];
  for (const row of rows) {
    row.forEach((v) => cells.push(cleanText(v)));
    cells.push(null);
  }

  const result = assembleRecords(
    cells,
    headerDetected ? first : null,
    warnings,
    { format: `CSV/TSV (pemisah "${delimiter === '\t' ? '\\t' : delimiter}")`, delimiter },
  );
  result.meta = { ...result.meta, ...meta };
  return result;
}

/* ------------------------------------------------------------------ *
 * JSON parsing (accepts our own exports)
 * ------------------------------------------------------------------ */

/**
 * Locate the record array inside a decoded JSON document. Accepts a bare array
 * and the common wrapper keys, including the Malay keys this app writes
 * (`rekod`) and the English synonyms other tools emit.
 */
function findRecordArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;

  const preferred = ['rekod', 'records', 'aset', 'data', 'senarai', 'items', 'rows'];
  for (const key of preferred) {
    if (Array.isArray(data[key])) return data[key];
  }
  // Fall back to the first array-valued property that looks like records.
  for (const value of Object.values(data)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') return value;
  }
  return null;
}

export function parseJson(text, meta = {}) {
  const warnings = [];
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('Fail JSON tidak sah: ' + err.message);
  }
  const list = findRecordArray(data);
  if (!list) throw new Error('Struktur JSON tidak dikenali (tiada tatasusunan rekod).');

  const records = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = emptyRecord();
    for (const field of FIELDS) {
      const want = field.toLowerCase().replace(/[^a-z]/g, '');
      const hit = Object.keys(item).find((k) => k.toLowerCase().replace(/[^a-z]/g, '') === want);
      record[field] = cleanText(hit ? item[hit] : '');
    }
    if (!record.Label && !record['Jenis Aset']) continue;
    record.Label = normaliseLabel(record.Label);
    records.push(record);
  }
  if (records.length === 0) warnings.push('Tiada rekod sah dalam fail JSON.');
  return { records, warnings, meta: { format: 'JSON', ...meta } };
}

/* ------------------------------------------------------------------ *
 * Format dispatch
 * ------------------------------------------------------------------ */

export function detectFormat(text, fileName = '') {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const head = text.slice(0, 8192);
  const trimmed = head.replace(/^\uFEFF/, '').trimStart();

  // Order matters. The real JKM exports begin with whitespace followed by a
  // <script> block, so markup must be sniffed before JSON: file extensions lie
  // and so do declared content types.
  const looksJson = ext === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[');
  const looksHtml = /<(table|td|th|tr|html|body|head|script)\b/i.test(head);

  if (looksHtml) return 'html';
  if (looksJson) return 'json';

  // Real binary Excel workbooks (OLE2 / ZIP sniff).
  if (head.includes('\u0000') || trimmed.startsWith('PK') || trimmed.startsWith('\u00d0\u00cf\u0011\u00e0')) {
    return 'binary-excel';
  }
  if (['csv', 'tsv', 'txt'].includes(ext)) return 'csv';
  if (ext === 'xls' || ext === 'xlsx') return 'binary-excel';
  return 'csv';
}

/**
 * Parse one file's text into records. Throws only when nothing could be read.
 */
export function parseFile(text, fileName, meta = {}) {
  const format = detectFormat(text, fileName);
  if (format === 'binary-excel') {
    const err = new Error(
      'Fail ini ialah buku kerja Excel sebenar (format binari .xls/.xlsx), bukan jadual HTML. '
      + 'Sila eksport sebagai "Web Page (.html)" atau "CSV UTF-8" daripada sistem, atau simpan sebagai .html.',
    );
    err.kind = 'binary-excel';
    throw err;
  }
  if (format === 'html') return parseHtmlTable(text, meta);
  if (format === 'json') return parseJson(text, meta);
  return parseCsv(text, meta);
}

/* ------------------------------------------------------------------ *
 * Merge engine
 * ------------------------------------------------------------------ */

/**
 * Merge parsed sources into one de-duplicated list.
 *
 * @param {Array<{fileName: string, label: string, records: Array, warnings: string[]}>} sources
 * @param {{keyStrategy?: 'label'|'full'|'labelAndType'}} options
 */
export function mergeSources(sources, options = {}) {
  const keyStrategy = options.keyStrategy ?? 'label';

  const keyOf = (record) => {
    if (keyStrategy === 'full') return recordKey(record);
    if (keyStrategy === 'labelAndType') {
      return `${normaliseLabel(record.Label)}\u0001${record['Jenis Aset'].toUpperCase()}`;
    }
    return normaliseLabel(record.Label) || recordKey(record);
  };

  /** @type {Map<string, any>} */
  const byKey = new Map();
  const duplicates = [];
  const conflicts = [];
  const sourceStats = [];

  for (const source of sources) {
    let added = 0;
    let duplicate = 0;
    /** @type {Map<string, number>} */
    const seenInFile = new Map();

    source.records.forEach((record) => {
      const key = keyOf(record);
      if (!key) return;
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, {
          record: { ...record },
          sources: [source.label],
          count: 1,
        });
        added += 1;
      } else {
        duplicate += 1;
        existing.count += 1;
        if (!existing.sources.includes(source.label)) existing.sources.push(source.label);

        // Same key but differing details => flag for human review.
        const differing = FIELDS.filter(
          (f) => String(existing.record[f] ?? '').toUpperCase() !== String(record[f] ?? '').toUpperCase(),
        );
        if (differing.length > 0) {
          conflicts.push({
            key,
            label: record.Label,
            fileName: source.fileName,
            differing,
            existing: { ...existing.record },
            incoming: { ...record },
          });
        }
      }
      seenInFile.set(key, (seenInFile.get(key) ?? 0) + 1);
    });

    const internalDuplicates = Array.from(seenInFile.values()).filter((n) => n > 1).length;
    sourceStats.push({
      fileName: source.fileName,
      label: source.label,
      format: source.meta?.format ?? 'tidak diketahui',
      rows: source.records.length,
      unique: seenInFile.size,
      added,
      duplicate,
      internalDuplicates,
      warnings: source.warnings ?? [],
    });
  }

  for (const entry of byKey.values()) {
    if (entry.count > 1) {
      duplicates.push({
        label: entry.record.Label,
        jenisAset: entry.record['Jenis Aset'],
        count: entry.count,
        sources: entry.sources,
      });
    }
  }

  // The merged records carry ONLY the tracked asset fields, plus the copy count
  // used by the overlap view. Which file each record came from is deliberately
  // NOT attached: it is provenance, not asset data. It is still tracked
  // internally (entry.sources), which is what the conflict report and the
  // per-file statistics use.
  const merged = Array.from(byKey.values()).map((entry) => ({
    ...entry.record,
    '_Bilangan Salinan': entry.count,
  }));

  merged.sort((a, b) => {
    const byType = String(a['Jenis Aset']).localeCompare(String(b['Jenis Aset']), 'ms');
    if (byType !== 0) return byType;
    return String(a.Label).localeCompare(String(b.Label), 'ms', { numeric: true });
  });

  // Deterministic order makes the review tabs and exported reports stable.
  duplicates.sort((a, b) => String(a.label).localeCompare(String(b.label), 'ms', { numeric: true }));
  conflicts.sort((a, b) => String(a.label).localeCompare(String(b.label), 'ms', { numeric: true }));

  return { merged, duplicates, conflicts, sourceStats };
}

/* ------------------------------------------------------------------ *
 * Change tracking across uploads
 *
 * The source report lists assets that have NOT yet been inspected. It carries no
 * date and no inspection status, so the ONLY evidence that an asset was inspected
 * is that it disappears from a later export. Everything below follows from that.
 *
 * A run is one upload: when it happened, how many assets it listed, and which
 * labels. Deltas are computed against the immediately preceding run.
 * ------------------------------------------------------------------ */

/** Status values a label can hold in the timeline. */
export const LABEL_STATUS = {
  OUTSTANDING: 'belum',      // listed in the most recent run
  INSPECTED: 'diperiksa',    // listed before, absent from the most recent run
  REAPPEARED: 'muncul_semula', // absent at least once, then listed again
};

/**
 * Diff two runs.
 * @param {string[]} previousLabels labels listed by the earlier run ([] if first)
 * @param {string[]} currentLabels labels listed by the later run
 * @returns {{inspected: string[], still: string[], added: string[], reappeared: string[]}}
 *          `inspected` = present before, absent now  -> presumed inspected
 *          `reappeared` = was marked inspected earlier, listed again now
 */
export function diffLabels(previousLabels, currentLabels, alreadyInspected) {
  const prev = new Set(previousLabels || []);
  const cur = new Set(currentLabels || []);
  const gone = new Set(alreadyInspected || []);

  const inspected = [];
  const still = [];
  const added = [];
  const reappeared = [];

  for (const label of prev) {
    if (cur.has(label)) still.push(label);
    else inspected.push(label);
  }
  for (const label of cur) {
    if (prev.has(label)) continue;
    // Not in the previous run. If it had been marked inspected before, it is
    // back; otherwise this is the first time it has been seen.
    if (gone.has(label)) reappeared.push(label);
    else added.push(label);
  }

  return { inspected, still, added, reappeared };
}

/**
 * Build the history from a list of runs (oldest first) and derive a per-label
 * timeline.
 *
 * @param {Array<{at: string, labels: string[], records?: Object, note?: string}>} runs
 * @returns {{runs: Array, labels: Object, summary: Object}}
 */
export function buildHistory(runs) {
  const ordered = (runs || [])
    .filter((r) => r && Array.isArray(r.labels))
    .slice()
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  /** @type {Record<string, any>} */
  const timeline = {};
  const detail = [];
  const inspectedSoFar = new Set();

  ordered.forEach((run, index) => {
    const prev = index > 0 ? ordered[index - 1] : null;
    const prevLabels = prev ? prev.labels : [];
    const d = diffLabels(prevLabels, run.labels, inspectedSoFar);

    // Record first appearance and status transitions.
    run.labels.forEach((label) => {
      if (!timeline[label]) {
        timeline[label] = {
          label,
          firstSeen: run.at,
          lastSeen: run.at,
          timesSeen: 0,
          timesAbsent: 0,
          status: LABEL_STATUS.OUTSTANDING,
          reappearances: 0,
          bahagian: '',
        };
      }
      const t = timeline[label];
      t.lastSeen = run.at;
      t.timesSeen += 1;
      t.status = LABEL_STATUS.OUTSTANDING;
    });

    d.inspected.forEach((label) => {
      const t = timeline[label];
      if (!t) return;
      t.timesAbsent += 1;
      t.status = LABEL_STATUS.INSPECTED;
      inspectedSoFar.add(label);
    });

    d.reappeared.forEach((label) => {
      const t = timeline[label];
      if (!t) return;
      t.reappearances += 1;
      t.status = LABEL_STATUS.REAPPEARED;
      inspectedSoFar.delete(label);
    });

    // Enrich from the run's records when they are available.
    if (run.records && Array.isArray(run.records)) {
      run.records.forEach((r) => {
        if (timeline[r.Label]) {
          timeline[r.Label].bahagian = r.Bahagian || '';
          timeline[r.Label]['Jenis Aset'] = r['Jenis Aset'] || '';
          timeline[r.Label]['Lokasi Terkini'] = r['Lokasi Terkini'] || '';
        }
      });
    }

    detail.push({
      at: run.at,
      note: run.note || '',
      total: run.labels.length,
      inspected: d.inspected.length,
      still: d.still.length,
      added: d.added.length,
      reappeared: d.reappeared.length,
      labels: d,
      // The labels listed by THIS run, kept so membership can be exported.
      present: run.labels.slice(),
    });
  });

  // Effective chain: an asset inspected and never seen again is resolved; one
  // seen in the newest run is outstanding.
  const newest = ordered.length ? ordered[ordered.length - 1] : null;
  const currentSet = newest ? new Set(newest.labels) : new Set();

  Object.keys(timeline).forEach((label) => {
    const t = timeline[label];
    t.outstanding = currentSet.has(label);
    t.runsOutstanding = t.timesSeen;
  });

  const labelList = Object.values(timeline);
  const summary = {
    runs: ordered.length,
    first: ordered.length ? ordered[0].at : null,
    last: newest ? newest.at : null,
    everSeen: labelList.length,
    outstanding: labelList.filter((t) => t.outstanding).length,
    resolved: labelList.filter((t) => !t.outstanding).length,
    reappeared: labelList.filter((t) => t.reappearances > 0).length,
    neverInspectedSince: (() => {
      if (!newest || ordered.length < 2) return null;
      const first = timeline;
      // How many of the newest run's labels have been outstanding since the start?
      return newest.labels.filter((l) => first[l] && first[l].timesSeen === ordered.length).length;
    })(),
  };

  return { runs: detail, labels: timeline, labelList, summary };
}

/**
 * Per-department progress between the newest run and the run before it.
 * @param {Array} detailRuns output of buildHistory().runs
 * @param {Object} runRecords records of the newest run, keyed access by Label
 */
export function departmentProgress(detailRuns, newestRecords, allLabels) {
  const last = detailRuns.length ? detailRuns[detailRuns.length - 1] : null;
  if (!last) return [];

  const deptOf = {};
  (newestRecords || []).forEach((r) => { deptOf[r.Label] = r.Bahagian || ''; });
  // Fall back to any historical record for labels no longer listed.
  Object.keys(allLabels || {}).forEach((label) => {
    if (!deptOf[label]) deptOf[label] = allLabels[label].bahagian || '';
  });

  const rows = {};
  const bump = (dept, field, n) => {
    const d = dept || '(TIADA BAHAGIAN)';
    rows[d] = rows[d] || { bahagian: d, awal: 0, inspected: 0, added: 0, akhir: 0, reappeared: 0 };
    rows[d][field] += n;
  };

  last.labels.still.forEach((l) => bump(deptOf[l], 'awal', 1));
  last.labels.inspected.forEach((l) => {
    bump(deptOf[l], 'awal', 1);
    bump(deptOf[l], 'inspected', 1);
  });
  last.labels.added.forEach((l) => {
    bump(deptOf[l], 'added', 1);
    bump(deptOf[l], 'akhir', 1);
  });
  last.labels.reappeared.forEach((l) => {
    bump(deptOf[l], 'akhir', 1);
    bump(deptOf[l], 'reappeared', 1);
  });
  last.labels.still.forEach((l) => bump(deptOf[l], 'akhir', 1));

  return Object.values(rows)
    .map((r) => ({
      ...r,
      peratus: r.awal ? Number(((r.inspected * 100) / r.awal).toFixed(1)) : 0,
    }))
    .sort((a, b) => {
      if (a.bahagian === '(TIADA BAHAGIAN)') return 1;
      if (b.bahagian === '(TIADA BAHAGIAN)') return -1;
      return b.awal - a.awal;
    });
}

/* ------------------------------------------------------------------ *
 * Serialisers
 * ------------------------------------------------------------------ */

// History columns, shared by the app's CSV exports and the Worker's CSV export so
// the two can never disagree about the shape of the file.
export const HISTORY_COLUMNS = [
  'Label',
  'Jenis Aset',
  'Bahagian',
  'Lokasi Terkini',
  'Pertama Dilihat',
  'Terakhir Dilihat',
  'Kali Dilihat',
  'Kali Hilang',
  'Muncul Semula',
  'Status',
];

/** One row per label, describing its whole observed lifecycle. */
export function historyRows(history) {
  const list = history && history.labels ? history.labels : {};
  return Object.keys(list).map((label) => {
    const t = list[label];
    return {
      Label: t.label,
      'Jenis Aset': t['Jenis Aset'] || '',
      Bahagian: t.bahagian || '',
      'Lokasi Terkini': t['Lokasi Terkini'] || '',
      'Pertama Dilihat': String(t.firstSeen || '').slice(0, 10),
      'Terakhir Dilihat': String(t.lastSeen || '').slice(0, 10),
      'Kali Dilihat': t.timesSeen || 0,
      'Kali Hilang': t.timesAbsent || 0,
      'Muncul Semula': t.reappearances || 0,
      Status: t.outstanding ? 'Belum diperiksa' : 'Sudah diperiksa',
    };
  }).sort((a, b) => {
    if (a.Status !== b.Status) return a.Status === 'Belum diperiksa' ? -1 : 1;
    return String(a.Label).localeCompare(String(b.Label), 'ms', { numeric: true });
  });
}

/**
 * One row per run, for loading into a database. `inspected`/`added`/
 * `reappeared` are the deltas against the immediately preceding run.
 */
export function historyRunRows(history) {
  const runs = (history && history.runs) || [];
  return runs.map((r, i) => ({
    'Bilangan Titik Masa': i + 1,
    Tarikh: String(r.at).slice(0, 16).replace('T', ' '),
    Nota: r.note || '',
    'Jumlah Dalam Senarai': r.total,
    Diperiksa: r.inspected,
    'Masih Belum': r.still,
    Baharu: r.added,
    'Muncul Semula': r.reappeared,
  }));
}

export const HISTORY_RUN_COLUMNS = [
  'Bilangan Titik Masa',
  'Tarikh',
  'Nota',
  'Jumlah Dalam Senarai',
  'Diperiksa',
  'Masih Belum',
  'Baharu',
  'Muncul Semula',
];

/**
 * One row per (run, label): the raw membership fact.
 *
 * This exists because the timeline export is CUMULATIVE - it holds every label
 * ever seen, with a derived status. It does not say which labels were listed in
 * which run, and that is exactly what a database needs in order to rebuild
 * observations and compare them. A database imported from the timeline alone
 * would think every observation contained every label.
 */
export function historyMembershipRows(history) {
  const outcome = [];
  (history && history.runs ? history.runs : []).forEach((run) => {
    const at = String(run.at).slice(0, 10);
    (run.present || []).forEach((label) => {
      outcome.push({ Tarikh: at, Label: label });
    });
  });
  return outcome;
}

export const MEMBERSHIP_COLUMNS = ['Tarikh', 'Label'];

// Exports contain the asset fields only. Provenance ("which file did this come
// from") is not asset data, so it is not written out. The copy count is kept
// because it is the visible result of de-duplication and is useful for spotting
// an overlapping export; it is marked as an extension column so a re-import
// recognises and drops it.
export const EXPORT_COLUMNS = [...FIELDS, '_Bilangan Salinan'];

export const EXPORT_HEADERS = [
  ...FIELDS,
  'Bilangan Salinan',
];

/**
 * Header text actually written to a file: the tracked asset fields verbatim, plus
 * the extension-column marker on any column that is not one of them. The marker
 * is a zero-width space, so it is invisible in Excel but lets this app recognise
 * its own extension columns when the file is read back.
 */
function headerFor(column, index) {
  const label = EXPORT_HEADERS[index] ?? column;
  return index < FIELDS.length ? label : EXTRA_COLUMN_MARKER + label;
}

export function toCsv(rows, columns = EXPORT_COLUMNS, headers = EXPORT_HEADERS) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Quote standard CSV hazards plus angle brackets: a bare "<" would make the
    // field look like an HTML tag to the format sniffer on re-import.
    const needsQuotes = /[",\r\n]/.test(s)
      || /^[ \t]|[ \t]$/.test(s)
      || /[<>]/.test(s);
    return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Mark extension columns only for the default layout, so a caller supplying
  // custom headers gets exactly those headers.
  const markExtensions = headers === EXPORT_HEADERS;
  const headerCells = headers.map((h, i) => (markExtensions ? headerFor(columns[i], i) : h));
  const lines = [headerCells.map(esc).join(',')];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function toHtmlWorkbook(rows, options = {}) {
  const columns = options.columns ?? EXPORT_COLUMNS;
  const headers = options.headers ?? EXPORT_HEADERS;
  const title = options.title ?? 'Gabungan Senarai Aset Belum Periksa';
  const esc = (v) => decodeEntities(String(v ?? ''))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const markExtensions = headers === EXPORT_HEADERS;
  const head = headers
    .map((h, i) => `<td><b>${esc(markExtensions ? headerFor(columns[i], i) : h)}</b></td>`)
    .join('\n');
  const body = rows.map((row) => {
    const cells = columns
      .map((c) => `<td style="mso-number-format:\\@">${esc(row[c])}</td>`)
      .join('\n');
    return `<tr>\n${cells}\n</tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
.test { mso-number-format:\\@; }
td { vertical-align: top; font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
</style>
</head>
<body>
<h3>${esc(title)}</h3>
<p>Dijana pada ${esc(options.generatedAt ?? '')} - ${rows.length} rekod</p>
<table width="100%" cellpadding="2" cellspacing="0" border="1">
<tr>
${head}
</tr>
${body}
</table>
</body>
</html>
`;
}

export function toJson(rows, options = {}) {
  return JSON.stringify(
    {
      tajuk: options.title ?? 'Gabungan Senarai Aset Belum Periksa',
      dijanaPada: options.generatedAt ?? new Date().toISOString(),
      jumlahRekod: rows.length,
      ringkasan: options.summary ?? null,
      rekod: rows,
    },
    null,
    2,
  );
}
