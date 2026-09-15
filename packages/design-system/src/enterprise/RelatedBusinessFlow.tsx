import { Check, X, Circle } from "lucide-react";
import { cn } from "../utilities/cn.ts";

export type BusinessFlowNodeState = "completed" | "current" | "future" | "blocked";

export interface BusinessFlowNode {
  id: string;
  /** e.g. "Quotation" — the stage/document type name. */
  label: string;
  state: BusinessFlowNodeState;
  /** e.g. "QT-00142" — links into the actual record, when one exists at
   * this stage. Omit for a future stage with no record yet. */
  href?: string;
  /** Shown under the label when a record exists (a number, an amount). */
  meta?: string;
}

export interface RelatedBusinessFlowProps {
  className?: string;
  /** e.g. "Sales flow" — names which cross-module lineage this is. */
  title: string;
  nodes: BusinessFlowNode[];
}

const stateStyles: Record<BusinessFlowNodeState, string> = {
  completed: "border-success-emphasis bg-success-soft text-success",
  current: "border-brand bg-brand text-text-inverse",
  future: "border-border-strong bg-surface text-text-muted",
  blocked: "border-danger-emphasis bg-danger-soft text-danger",
};

/**
 * Cross-module business lineage strip — Lead → Opportunity → Quotation →
 * Sales Order → Delivery → Invoice → Receipt, or Requisition → RFQ → PO →
 * GRN → Supplier Invoice → Payment. Deliberately a simple linear strip, not
 * a graph library — React Flow (charts/ or a future package) is for
 * genuinely graph-shaped workflows, this is a fixed-sequence lineage.
 */
export function RelatedBusinessFlow({ className, title, nodes }: RelatedBusinessFlowProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      <ol className="flex items-start gap-1 overflow-x-auto">
        {nodes.map((node, i) => {
          const isLast = i === nodes.length - 1;
          const Content = (
            <div className="flex flex-col items-center gap-1 px-1 text-center">
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border-2", stateStyles[node.state])}>
                {node.state === "completed" ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : node.state === "blocked" ? (
                  <X className="size-3.5" aria-hidden="true" />
                ) : (
                  <Circle className={cn("size-2", node.state === "current" && "fill-current")} aria-hidden="true" />
                )}
              </span>
              <span className={cn("max-w-24 truncate text-xs font-medium", node.state === "future" ? "text-text-muted" : "text-text")}>
                {node.label}
              </span>
              {node.meta && <span className="text-[11px] tabular-nums text-text-muted">{node.meta}</span>}
            </div>
          );
          return (
            <li key={node.id} className="flex flex-1 items-start">
              {node.href ? (
                <a href={node.href} className="rounded outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand">
                  {Content}
                </a>
              ) : (
                Content
              )}
              {!isLast && <div className="mt-3.5 h-px flex-1 shrink bg-border-strong" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
