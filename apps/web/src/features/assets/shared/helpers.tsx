"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { StatusBadge } from "@vercentlabs/design-system";

import { type Row } from "@/features/assets/shared/client";
import { calendarDate, dateTime, label, money, quantity, tone } from "@/features/assets/shared/format";

type Col = ColumnDef<Row, unknown>;
// `cell` is only set when given: an explicit undefined would replace the grid's default renderer with nothing.
export const col = (id: string, header: string, accessorFn: (row: Row) => string, cell?: Col["cell"]): Col => (cell ? { id, header, accessorFn, cell } : { id, header, accessorFn }) as Col;
export const badge = (id: string, header: string, value: (row: Row) => unknown): Col => ({ id, header, accessorFn: (row) => label(value(row)), cell: ({ row }) => <StatusBadge tone={tone(value(row.original))}>{label(value(row.original))}</StatusBadge> }) as Col;
export const strong = (id: string, header: string, value: (row: Row) => string): Col => col(id, header, value, ({ row }) => <span className="font-medium text-text">{value(row.original)}</span>);
export const link = (id: string, header: string, value: (row: Row) => string, href: (row: Row) => string): Col => col(id, header, value, ({ row }) => <Link className="font-medium text-brand hover:underline" href={href(row.original)}>{value(row.original)}</Link>);
export const text = (row: Row, keys: string[]) => keys.map((key) => String(row[key] ?? "")).join(" ");
export const opts = (...values: string[]) => values.map((value) => ({ value, label: label(value) }));
export { calendarDate, dateTime, label, money, quantity };
