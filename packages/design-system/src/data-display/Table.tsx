import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../utilities/cn.ts";

// The one owner of plain table markup for small, static tables (a report's rows, a preview, a list of lines). Larger
// interactive lists use EnterpriseDataGrid. Keeping the elements here means every table shares the same semantics:
// header cells are column headers by default, and a wide table scrolls inside its own region instead of stretching the
// page.
export type TableProps = ComponentPropsWithoutRef<"table"> & {
  /** A short description read by screen readers; not shown. */
  caption?: string;
};

export function Table({ className, caption, children, ...props }: TableProps) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className={cn("w-full text-sm", className)} {...props}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function TableHead(props: ComponentPropsWithoutRef<"thead">) {
  return <thead {...props} />;
}

export function TableBody(props: ComponentPropsWithoutRef<"tbody">) {
  return <tbody {...props} />;
}

export function TableFoot(props: ComponentPropsWithoutRef<"tfoot">) {
  return <tfoot {...props} />;
}

export function TableRow(props: ComponentPropsWithoutRef<"tr">) {
  return <tr {...props} />;
}

export function TableHeaderCell({ scope = "col", ...props }: ComponentPropsWithoutRef<"th">) {
  return <th scope={scope} {...props} />;
}

export function TableCell(props: ComponentPropsWithoutRef<"td">) {
  return <td {...props} />;
}
