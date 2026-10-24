"use client";

// Form 16A details for this supplier (Procurement report Phase 2): for a quarter, what was credited, the TDS and the challans it was
// deposited under — what the certificate downloaded from TRACES shows, to answer the supplier's questions and check it.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { request } from "@/features/procurement/shared/http";
import { calendarDate, money } from "@/features/procurement/shared/format";

type Form16A = {
  fy: number; quarter: number; credited: string; total: string; problems: string[]; deductee: { name: string | null; pan: string | null };
  deductees: Array<{ id: string; documentNumber: string | null; creditedOn: string | null; sectionCode: string | null; taxable: string; tds: string;
    challan: { bsrCode: string; serial: string; date: string } | null }>;
};
const currentFy = () => { const now = new Date(); return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; };
const QUARTERS = ["Q1 Apr–Jun", "Q2 Jul–Sep", "Q3 Oct–Dec", "Q4 Jan–Mar"];

export function Form16APanel({ supplierId }: { supplierId: string }) {
  const years = useMemo(() => [0, 1, 2].map((back) => currentFy() - back), []);
  const [fy, setFy] = useState(currentFy());
  const [quarter, setQuarter] = useState(() => { const month = new Date().getMonth() + 1; return month >= 4 && month <= 6 ? 1 : month >= 7 && month <= 9 ? 2 : month >= 10 ? 3 : 4; });
  const query = useQuery({ queryKey: ["procurement", "form16a", supplierId, fy, quarter],
    queryFn: () => request<{ form16a: Form16A | null }>(`/suppliers/${supplierId}/form16a?fy=${fy}&quarter=${quarter}`).then((result) => result.form16a), retry: false });
  const data = query.data;
  return (
    <Panel title="Form 16A details" description="TDS deducted from this supplier in a quarter, and the challans it went under."
      actions={<div className="flex flex-wrap gap-2">
        <Select aria-label="Financial year" size="compact" selectedKey={String(fy)} onSelectionChange={(key) => setFy(Number(key))}
          options={years.map((year) => ({ value: String(year), label: `FY ${year}-${String(year + 1).slice(2)}` }))} />
        <Select aria-label="Quarter" size="compact" selectedKey={String(quarter)} onSelectionChange={(key) => setQuarter(Number(key))}
          options={QUARTERS.map((label, index) => ({ value: String(index + 1), label }))} />
      </div>}>
      {query.isError ? <Notice>{query.error instanceof Error ? query.error.message : "Could not load the details."}</Notice>
        : !data ? <p className="text-sm text-text-muted">Loading…</p>
          : !data.deductees.length ? <p className="text-sm text-text-muted">No TDS was deducted from this supplier in the quarter.</p> : (
            <div className="flex flex-col gap-2 text-sm">
              <p>{data.deductee.name} · PAN {data.deductee.pan ?? "not recorded"} · credited {money("INR", data.credited)} · TDS {money("INR", data.total)}</p>
              {data.problems.length > 0 && <Notice tone="warning">{data.problems.join(" ")}</Notice>}
              <ul className="flex flex-col divide-y divide-border">
                {data.deductees.map((row) => (
                  <li key={row.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
                    <span>{row.documentNumber} · {row.creditedOn ? calendarDate(row.creditedOn) : "—"} · {row.sectionCode ?? "No section"}
                      <span className="block text-xs text-text-muted">{row.challan ? `Challan ${row.challan.bsrCode}/${row.challan.serial} of ${calendarDate(row.challan.date)}` : "Not deposited yet"}</span></span>
                    <span className="tabular-nums">{money("INR", row.tds)} on {money("INR", row.taxable)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
    </Panel>
  );
}
