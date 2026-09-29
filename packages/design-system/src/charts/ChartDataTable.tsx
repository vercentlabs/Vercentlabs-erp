import { useId, useState, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "../data-display/Table.tsx";
import { cn } from "../utilities/cn.ts";
import { followLink } from "../utilities/follow-link.ts";

export interface ChartDataColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
}

export interface ChartDataTableProps<T> {
  className?: string;
  /** Read by screen readers as the table's name, e.g. "Pipeline by stage". */
  caption: string;
  rows: T[];
  rowKey: (row: T) => string;
  /** The category column (a stage, a month, a source). */
  rowHeader: { header: string; cell: (row: T) => string; href?: (row: T) => string | undefined };
  columns: ChartDataColumn<T>[];
  onNavigate?: (href: string) => void;
}

/** Every chart's data as a real table. It is always in the page for
 * assistive technology; "Show table" reveals it on screen, where each
 * category links to the records behind it — the keyboard route to what a
 * mouse user reaches by clicking a bar. */
export function ChartDataTable<T>({ className, caption, rows, rowKey, rowHeader, columns, onNavigate }: ChartDataTableProps<T>) {
  const [visible, setVisible] = useState(false);
  const tableId = useId();
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        aria-expanded={visible}
        aria-controls={tableId}
        onClick={() => setVisible((value) => !value)}
        className="self-start rounded-[var(--radius-control)] text-xs font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
      >
        {visible ? "Hide table" : "Show table"}
      </button>
      <div id={tableId} className={visible ? undefined : "sr-only"}>
        <Table caption={caption}>
          <TableHead>
            <TableRow className="border-b border-border text-left text-xs text-text-muted">
              <TableHeaderCell className="py-1.5 pr-3 font-medium">{rowHeader.header}</TableHeaderCell>
              {columns.map((column) => (
                <TableHeaderCell key={column.key} className="py-1.5 pl-3 text-right font-medium">
                  {column.header}
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const href = rowHeader.href?.(row);
              const label = rowHeader.cell(row);
              return (
                <TableRow key={rowKey(row)} className="border-b border-border last:border-b-0">
                  <TableHeaderCell scope="row" className="py-1.5 pr-3 text-left font-normal text-text">
                    {href ? (
                      <a
                        href={href}
                        tabIndex={visible ? undefined : -1}
                        onClick={(event) => followLink(event, href, onNavigate)}
                        className="rounded-[2px] text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        {label}
                      </a>
                    ) : (
                      label
                    )}
                  </TableHeaderCell>
                  {columns.map((column) => (
                    <TableCell key={column.key} className="py-1.5 pl-3 text-right tabular-nums text-text-secondary">
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
