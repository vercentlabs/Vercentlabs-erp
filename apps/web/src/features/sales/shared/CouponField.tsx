"use client";

// A coupon on a quotation or order (Sales report Phase 3): type the code and apply it; the server checks it and works out what it takes
// off. A code that does not apply shows its reason here, with a way to remove it.
import { useState } from "react";
import { Button, TextField } from "@vercentlabs/design-system";

import { money } from "@/features/sales/shared/format";
import { SalesApiError } from "@/features/sales/shared/http";
import type { SalesDocumentPreview } from "@/features/sales/quotations/api/quotations-api";
import { Notice, Panel } from "@/shared/ui/Panel";

export function CouponField({ value, onChange, preview, previewError, currencyCode }: {
  value: string; onChange: (code: string) => void; preview: SalesDocumentPreview | undefined; previewError: unknown; currencyCode: string;
}) {
  const [typed, setTyped] = useState(value);
  const refused = value && previewError instanceof SalesApiError && previewError.code === "SALES_COUPON_NOT_VALID" ? previewError.message : null;
  const amount = Number(preview?.totals.couponAmount ?? 0);
  const apply = () => onChange(typed.trim().toUpperCase().replace(/\s+/g, ""));
  return (
    <Panel title="Coupon" description="A code from a campaign or an offer."
      actions={value ? <Button variant="ghost" size="compact" onPress={() => { setTyped(""); onChange(""); }}>Remove coupon</Button> : undefined}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="sm:w-64">
          <TextField label="Coupon code" value={typed} onChange={setTyped} placeholder="For example: DIWALI10"
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); apply(); } }} />
        </div>
        <Button variant="secondary" className="w-full sm:w-auto" isDisabled={!typed.trim() || typed.trim().toUpperCase() === value} onPress={apply}>Apply coupon</Button>
      </div>
      {refused ? <Notice tone="danger">{refused}</Notice>
        : value && amount > 0 ? <p className="text-sm text-text-secondary">{`${value}: ${money(currencyCode, amount)} off, shared across the lines before tax.`}</p> : null}
    </Panel>
  );
}
