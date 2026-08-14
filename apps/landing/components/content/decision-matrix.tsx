import type { ReactNode } from "react";
import { cx } from "@/lib/utils";

export interface DecisionMatrixRow { label: string; values: ReactNode[]; }

export function DecisionMatrix({ rowHeader, columns, rows, className }: { rowHeader: string; columns: string[]; rows: DecisionMatrixRow[]; className?: string }) {
  return (
    <div className={className}>
      <div className="hidden overflow-x-auto border-y border-(--color-border-strong) sm:block">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr className="bg-(--color-bg-subtle)">
              <th scope="col" className="border-b border-r border-(--color-border-strong) px-4 py-4 text-left text-[0.66rem] font-bold uppercase tracking-[0.12em] text-(--color-text-muted)">{rowHeader}</th>
              {columns.map((column, index) => (
                <th key={column} scope="col" className="border-b border-r border-(--color-border-strong) px-4 py-4 text-left font-semibold text-(--color-text-primary) last:border-r-0">
                  <span className="vl-index mr-3 text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>{column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.label} className={cx("border-b border-(--color-border-default) last:border-b-0", rowIndex % 2 === 1 && "bg-[rgba(251,250,247,.5)]")}>
                <th scope="row" className="border-r border-(--color-border-default) px-4 py-4 text-left font-semibold text-(--color-text-primary)">{row.label}</th>
                {row.values.map((value, columnIndex) => (
                  <td key={columnIndex} className="border-r border-(--color-border-default) px-4 py-4 leading-relaxed text-(--color-text-secondary) last:border-r-0">{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-(--color-border-strong) sm:hidden">
        {rows.map((row, rowIndex) => (
          <section key={row.label} className="border-b border-(--color-border-strong) py-5">
            <div className="flex items-center gap-3"><span className="vl-index text-(--color-text-brand)">{String(rowIndex + 1).padStart(2, "0")}</span><p className="text-sm font-semibold text-(--color-text-primary)">{row.label}</p></div>
            <dl className="mt-4 grid grid-cols-1 border-l border-t border-(--color-border-default)">
              {columns.map((column, columnIndex) => (
                <div key={column} className="border-b border-r border-(--color-border-default) p-3.5">
                  <dt className="text-[0.62rem] font-bold uppercase tracking-[0.1em] text-(--color-text-muted)">{column}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{row.values[columnIndex]}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
