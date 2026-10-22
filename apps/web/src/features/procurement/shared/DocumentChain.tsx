"use client";

// The document chain strip (Procurement plan Phase 1): where this document sits in Indent → RFQ → Quotation → PO → GRN → Bill → Payment, each step with
// its documents (click to open) or greyed out when not reached yet. Shown under the header of every Procurement document.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { cn } from "@vercentlabs/design-system";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { request } from "@/features/procurement/shared/http";

export type ChainType = "purchase_indent" | "purchase_rfq" | "purchase_order" | "goods_receipt" | "supplier_bill" | "supplier_payment" | "purchase_return" | "supplier_quotation";
type ChainDocument = { id: string; number: string; status: string; statusLabel: string; href: string | null };
type Chain = { current: { type: ChainType; id: string }; direct: boolean; steps: Array<{ key: string; label: string; reached: boolean; documents: ChainDocument[] }> };

const SHOWN = 2;

export function DocumentChain({ type, id, className }: { type: ChainType; id: string; className?: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "chain", type, id), queryFn: () => request<Chain>(`/chain/${type}/${id}`), staleTime: 30_000 });
  if (!query.data) return null;
  const { steps } = query.data;
  return (
    <nav aria-label="Document chain" className={cn("overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      <ol className="flex min-w-max items-stretch gap-1 rounded-[var(--radius-card)] border border-border bg-surface px-2 py-1.5 text-sm">
        {steps.map((step, index) => (
          <li key={step.key} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="size-3.5 shrink-0 text-text-muted" aria-hidden="true" />}
            <span className={cn("flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1", !step.reached && "text-text-muted")}>
              <span className={cn("text-xs font-medium uppercase tracking-wide", step.reached ? "text-text-secondary" : "text-text-muted")}>{step.label}</span>
              {!step.reached ? <span aria-label="Not yet">—</span> : (
                <>
                  {step.documents.slice(0, SHOWN).map((document) => {
                    const current = document.id === id;
                    const label = <span className="tabular-nums">{document.number}</span>;
                    return (
                      <span key={document.id} title={document.statusLabel} className={cn("flex items-center gap-1", current && "font-semibold text-text-primary")}>
                        {document.href && !current ? <Link className="text-brand hover:underline" href={document.href}>{label}</Link> : label}
                        <span className="text-xs text-text-muted">{document.statusLabel}</span>
                      </span>
                    );
                  })}
                  {step.documents.length > SHOWN && <span className="text-xs text-text-muted">+{step.documents.length - SHOWN}</span>}
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
