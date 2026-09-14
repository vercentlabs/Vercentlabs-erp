import {
  Breadcrumbs as AriaBreadcrumbs,
  Breadcrumb as AriaBreadcrumb,
  Link,
  type BreadcrumbsProps as AriaBreadcrumbsProps,
  type BreadcrumbProps as AriaBreadcrumbProps,
} from "react-aria-components";
import { ChevronRight } from "lucide-react";
import { cn } from "../utilities/cn.ts";

export function Breadcrumbs<T extends object>({ className, ...props }: AriaBreadcrumbsProps<T>) {
  return <AriaBreadcrumbs className={cn("flex items-center gap-1.5 text-sm", className)} {...props} />;
}

export interface BreadcrumbProps extends Omit<AriaBreadcrumbProps, "className" | "children"> {
  className?: string;
  href?: string;
  children: string;
  /** The current page — rendered as plain text, not a link, and marked
   * aria-current="page". */
  isCurrent?: boolean;
}

export function Breadcrumb({ className, href, children, isCurrent, ...props }: BreadcrumbProps) {
  return (
    <AriaBreadcrumb className={cn("flex items-center gap-1.5", className)} {...props}>
      {isCurrent || !href ? (
        <span className="max-w-48 truncate font-medium text-text" aria-current={isCurrent ? "page" : undefined}>
          {children}
        </span>
      ) : (
        <Link href={href} className="max-w-48 truncate text-text-muted outline-none hover:text-text data-[focus-visible]:underline">
          {children}
        </Link>
      )}
      {!isCurrent && <ChevronRight className="size-3.5 shrink-0 text-text-subtle" aria-hidden="true" />}
    </AriaBreadcrumb>
  );
}
