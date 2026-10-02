/*
 * ui.jsx - the primitives every screen is built from.
 *
 * The old page had six places that each assembled a <table class="data-grid"> by hand, with
 * their own header strings, their own row loops and their own empty states. They are one
 * component here, which is most of why this file exists: a column definition is now data,
 * and adding one cannot forget the empty state or the numeric alignment.
 *
 * The class names are deliberate - `.notice.warn`, `.card .k`, `table.data-grid`, `.pill`,
 * `.note`, `.spacer` - because the verification suites select on them and because they
 * say more in the markup than the utilities they are built from.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, Key, ReactNode } from 'react';
import { PAGE_SIZE } from '../lib/compute';
import type { CardSpec, Notice as NoticeModel, NoticePart } from '../types';

/** A bordered section with a numbered step and a hint on the right. */
export interface PanelProps {
  id: string;
  title: ReactNode;
  /** Step number, or undefined for a panel that is not part of a numbered sequence. */
  step?: string;
  hint?: ReactNode;
  hintId?: string;
  hidden?: boolean;
  bodyId?: string;
  bodyStyle?: CSSProperties;
  children?: ReactNode;
}

export function Panel({ id, step, title, hint, hintId, hidden, children, bodyId, bodyStyle }: PanelProps) {
  return (
    <section className="panel" id={id} hidden={hidden}>
      <h2>
        {step !== undefined && <span className="step">{step}</span>}
        {title}
        {hint !== undefined && <span className="hint" id={hintId}>{hint}</span>}
      </h2>
      <div className="body" id={bodyId} style={bodyStyle}>{children}</div>
    </section>
  );
}

/** Props shared by the small layout elements below. */
export interface BoxProps {
  children?: ReactNode;
  id?: string;
  style?: CSSProperties;
  className?: string;
}

export function Toolbar({ children, plain, id, style }: BoxProps & { plain?: boolean }) {
  return (
    <div className={plain ? 'toolbar plain' : 'toolbar'} id={id} style={style}>{children}</div>
  );
}

export const Spacer = () => <div className="spacer" />;

export function Field({ label, htmlFor, children, style }: BoxProps & { label: ReactNode; htmlFor?: string }) {
  return (
    <div className="field" style={style}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export const Pill = ({ kind, children }: { kind?: string; children?: ReactNode }) => (
  <span className={kind ? `pill ${kind}` : 'pill'}>{children}</span>
);

export const Empty = ({ children }: { children?: ReactNode }) => <div className="empty">{children}</div>;

/* --------------------------------------------------------------- notices ---- */

/**
 * Render one fragment tree. Values arrive from uploaded files, so React escapes them;
 * the old implementation built HTML strings and escaped by hand, which is the kind of
 * thing that is correct until the day it is not.
 */
function Fragment({ part }: { part: NoticePart }) {
  if (typeof part === 'string' || typeof part === 'number') return <>{part}</>;
  if (part === null || part === undefined) return null;
  if (Array.isArray(part)) return <>{part.map((p, i) => <Fragment key={i} part={p} />)}</>;
  switch (part.t) {
    case 'b':
      return <b>{part.v}</b>;
    case 'mono':
      return <span className="mono">{part.v}</span>;
    case 'ul':
      return (
        <ul>
          {part.items.map((item, i) => (
            <li key={i}><Fragment part={item} /></li>
          ))}
        </ul>
      );
    case 'text':
    default:
      return <>{part.v}</>;
  }
}

/** A message on screen. `id` is optional and only used to anchor one notice. */
export const Notice = ({ item }: { item: NoticeModel & { id?: string } }) => (
  <div className={`notice ${item.kind}`} id={item.id}>
    <strong>{item.title}</strong>
    <Fragment part={item.parts} />
  </div>
);

export const NoticeList = ({ items, id }: { items?: NoticeModel[]; id?: string }) => (
  <div id={id}>
    {(items || []).map((n, i) => <Notice key={`${n.kind}-${i}`} item={n} />)}
  </div>
);

/* ----------------------------------------------------------------- cards ---- */

export const Cards = ({ items, id, style, className = 'cards' }: {
  items: CardSpec[];
  id?: string;
  style?: CSSProperties;
  className?: string;
}) => (
  <div className={className} id={id} style={style}>
    {items.map((c, i) => (c.onClick ? (
      /*
       * A pressable card is a real <button>, not a div with a click handler: it is
       * reachable by Tab and pressed with Enter or Space, and a reader is told it can be
       * pressed. The box keeps the card's own colour (amber "still outstanding", green at
       * zero), so the button inside it is a HIT AREA (.card-btn) and not a second look.
       */
      <div className={`card clickable ${c.cls || ''}`} key={i}>
        <button type="button" className="card-btn" id={c.id} title={c.title} onClick={c.onClick}>
          <span className="k block">{c.k}</span>
          <span className="v block">{c.v}</span>
          {c.sub ? <span className="sub block">{c.sub}</span> : null}
        </button>
      </div>
    ) : (
      <div className={`card ${c.cls || ''}`} key={i} id={c.id}>
        <div className="k">{c.k}</div>
        <div className="v">{c.v}</div>
        {c.sub ? <div className="sub">{c.sub}</div> : null}
      </div>
    )))}
  </div>
);

/* ----------------------------------------------------------------- table ---- */

/** One column of a grid. A column is data, so the empty state and alignment cannot be forgotten. */
export interface GridColumn<T> {
  key?: string;
  label?: ReactNode;
  num?: boolean;
  sortable?: boolean;
  /** Value written to `data-sort`, which the suites and the click handler read. */
  sort?: string;
  onSort?: () => void;
  cls?: string;
  render?: (row: T, index: number) => ReactNode;
}

export interface DataGridProps<T> {
  columns: GridColumn<T>[];
  rows: T[];
  rowKey?: (row: T, index: number) => Key;
  rowClass?: (row: T, index: number) => string | undefined;
  onRowClick?: (row: T) => void;
  rowDept?: (row: T) => string | undefined;
  rowTitle?: string;
  footer?: ReactNode;
  empty?: ReactNode;
}

export function DataGrid<T extends object>({
  columns, rows, rowKey, rowClass, onRowClick, rowDept, rowTitle, footer, empty,
}: DataGridProps<T>) {
  if (!rows.length && empty) return <Empty>{empty}</Empty>;
  return (
    <table className="data-grid">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th
              key={c.key || i}
              className={[c.num ? 'num' : '', c.sortable ? 'sortable' : ''].filter(Boolean).join(' ') || undefined}
              data-sort={c.sort}
              onClick={c.onSort}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={rowKey ? rowKey(row, i) : i}
            className={rowClass ? rowClass(row, i) : undefined}
            data-dept={rowDept ? rowDept(row) : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            title={onRowClick ? rowTitle : undefined}
          >
            {columns.map((c, j) => (
              <td key={c.key || j} className={c.num ? 'num' : (c.cls || undefined)}>
                {/* A cell is either a renderer or the named field; the cast is the price of
                    a column list that works for records of any shape. */}
                {c.render
                  ? c.render(row, i)
                  : ((row as Record<string, unknown>)[c.key as string] as ReactNode)}
              </td>
            ))}
          </tr>
        ))}
        {footer}
      </tbody>
    </table>
  );
}

/**
 * A search box that reports its value 160 ms after the last keystroke.
 *
 * Every keystroke would otherwise re-filter 536 records and re-render the table. The
 * delay is short enough that the browser suites - which wait 300 ms after typing - see
 * the result, and the value is resynced when something else clears the filter, so the
 * box and the list can never disagree.
 */
export function DebouncedSearch({ id, label, placeholder, value, apply, style }: {
  id: string;
  label: ReactNode;
  placeholder?: string;
  value: string;
  apply: (value: string) => void;
  style?: CSSProperties;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  useEffect(() => {
    const t = setTimeout(() => apply(local), 160);
    return () => clearTimeout(t);
  }, [local, apply]);
  return (
    <div className="field" style={style}>
      <label htmlFor={id}>{label}</label>
      <input
        type="search"
        id={id}
        placeholder={placeholder}
        value={local}
        /*
         * onInput, not onChange. React implements onChange for text inputs by comparing
         * the node's value against a tracker it installs on the element, and it SKIPS the
         * event when the value was set programmatically - which is exactly how the
         * verification suites type. A native input listener has no such opinion: whatever
         * the field now contains is what gets reported.
         */
        onInput={(e) => setLocal((e.target as HTMLInputElement).value)}
      />
    </div>
  );
}

/**
 * The pager. Rendering every filtered row is what printing does, so it is suppressed
 * there - a department list on paper is useless if 34 of its 60 rows are on a second
 * sheet nobody turns over.
 */
export function Pager({ total, page, onPage }: {
  total: number;
  page: number;
  onPage: (page: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;
  const pages = Math.ceil(total / PAGE_SIZE);
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <Toolbar style={{ borderTop: '1px solid var(--color-line)', borderBottom: 'none' }}>
      <span className="note">{`Menunjukkan ${from}\u2013${to} daripada ${total} rekod`}</span>
      <Spacer />
      <button type="button" className="tiny" data-page={page - 1} disabled={page <= 1}
        onClick={() => onPage(page - 1)}>
        {'\u2190 Sebelum'}
      </button>
      <span className="note">{`Halaman ${page} / ${pages}`}</span>
      <button type="button" className="tiny" data-page={page + 1} disabled={page >= pages}
        onClick={() => onPage(page + 1)}>
        {'Seterusnya \u2192'}
      </button>
    </Toolbar>
  );
}
