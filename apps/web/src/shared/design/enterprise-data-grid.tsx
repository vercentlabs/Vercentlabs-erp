import type { Key, ReactNode } from "react";

import { cx } from "./cx";
import styles from "./experience-kernel.module.css";

export type DataGridAlign = "start" | "center" | "end";

export type DataGridColumn<Row> = {
  id: string;
  header: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  align?: DataGridAlign;
  className?: string;
  /** CSS width (e.g. "12%", "160px") applied to both the header and body cell. */
  width?: string;
};

function resolveKey<Row>(
  row: Row,
  index: number,
  rowKey: keyof Row | ((row: Row, index: number) => Key),
): Key {
  if (typeof rowKey === "function") return rowKey(row, index);
  const value = row[rowKey];
  if (typeof value === "string" || typeof value === "number") return value;
  return index;
}

export function EnterpriseDataGrid<Row>({
  columns,
  rows,
  rowKey,
  caption,
  emptyState,
  renderMobileCard,
  className,
  fixedLayout,
}: {
  columns: Array<DataGridColumn<Row>>;
  rows: Row[];
  rowKey: keyof Row | ((row: Row, index: number) => Key);
  caption: string;
  emptyState?: ReactNode;
  renderMobileCard?: (row: Row, index: number) => ReactNode;
  className?: string;
  /** Sets table-layout: fixed so column `width`s are respected instead of content-fit. */
  fixedLayout?: boolean;
}) {
  if (!rows.length && emptyState) return <>{emptyState}</>;

  return (
    <div
      className={cx(
        styles.dataGrid,
        renderMobileCard ? styles.dataGridWithMobileCards : undefined,
        className,
      )}
      data-erp-ui="enterprise-data-grid"
    >
      <div className={styles.dataGridViewport} tabIndex={0} role="region" aria-label={caption}>
        <table
          className={styles.dataGridTable}
          style={fixedLayout ? { tableLayout: "fixed" } : undefined}
        >
          <caption className={styles.visuallyHidden}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cx(
                    styles.dataGridHeader,
                    styles[`align_${column.align ?? "start"}`],
                    column.className,
                  )}
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={resolveKey(row, rowIndex, rowKey)} className={styles.dataGridRow}>
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cx(
                      styles.dataGridCell,
                      styles[`align_${column.align ?? "start"}`],
                      column.className,
                    )}
                    style={column.width ? { width: column.width } : undefined}
                  >
                    {column.cell(row, rowIndex)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {renderMobileCard ? (
        <div className={styles.mobileCardList} aria-label={`${caption} mobile list`}>
          {rows.map((row, index) => (
            <div key={resolveKey(row, index, rowKey)} className={styles.mobileCardItem}>
              {renderMobileCard(row, index)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
