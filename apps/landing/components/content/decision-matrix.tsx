import type { ReactNode } from "react";
import { cx } from "@/lib/utils";

export interface DecisionMatrixRow {
  label: string;
  values: ReactNode[];
}

/**
 * A responsive comparison/decision table — real <table> markup with
 * overflow-x-auto for wide column counts, plus a stacked mobile fallback
 * (below `sm`) so nothing requires horizontal scrolling to read at 320px.
 * Both renderings exist in the DOM (CSS-toggled, not JS-toggled) so content
 * stays fully crawlable either way. Never style a specific column/row to
 * visually favor one side — column order and typography stay uniform.
 */
export function DecisionMatrix({ rowHeader, columns, rows, className }: { rowHeader: string; columns: string[]; rows: DecisionMatrixRow[]; className?: string }) {
  return (
    <div className={className}>
      <div className="hidden overflow-x-auto rounded-(--radius-panel) border border-(--color-border-default) sm:block">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-(--color-border-default) bg-(--color-bg-subtle)">
              <th scope="col" className="px-4 py-3 text-left font-semibold text-(--color-text-primary)">
                {rowHeader}
              </th>
              {columns.map((column) => (
                <th key={column} scope="col" className="px-4 py-3 text-left font-semibold text-(--color-text-primary)">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.label} className={cx("border-b border-(--color-border-default) last:border-b-0", index % 2 === 1 && "bg-(--color-bg-subtle)")}>
                <th scope="row" className="px-4 py-3 text-left font-medium text-(--color-text-primary)">
                  {row.label}
                </th>
                {row.values.map((value, columnIndex) => (
                  <td key={columnIndex} className="px-4 py-3 text-(--color-text-secondary)">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-4 sm:hidden">
        {rows.map((row) => (
          <div key={row.label} className="rounded-(--radius-panel) border border-(--color-border-default) p-4">
            <p className="text-sm font-semibold text-(--color-text-primary)">{row.label}</p>
            <dl className="mt-3 flex flex-col gap-2 border-t border-(--color-border-default) pt-3">
              {columns.map((column, columnIndex) => (
                <div key={column} className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-[0.08em] text-(--color-text-muted)">{column}</dt>
                  <dd className="text-sm text-(--color-text-secondary)">{row.values[columnIndex]}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
