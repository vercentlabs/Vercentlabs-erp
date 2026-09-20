"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Button, PageHeader, Select } from "@vercentlabs/design-system";

import { MfgApiError, readView, useMfgOptions, type Row } from "@/features/manufacturing/shared/client";
import { MfgAlert, MfgPanel } from "@/features/manufacturing/shared/MfgUi";
import { quantity } from "@/features/manufacturing/shared/format";

// Every product whose active structure uses an item, directly or through sub-assemblies (F146).
export function WhereUsedScreen() {
  const options = useMfgOptions();
  const [itemId, setItemId] = useState("");
  const find = useMutation({ mutationFn: () => readView("where-used", { itemId }).then((r) => r.rows) });
  const rows: Row[] | undefined = find.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Where used" description="Which products use an item, directly and through sub-assemblies." />
      <MfgPanel>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[280px]">
            <Select label="Item" options={(options.data?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }))} selectedKey={itemId || null} onSelectionChange={(k) => setItemId(String(k ?? ""))} placeholder="Select item" />
          </div>
          <Button variant="primary" onPress={() => find.mutate()} isLoading={find.isPending} isDisabled={!itemId}>Find</Button>
        </div>
        {find.error && <MfgAlert>{find.error instanceof MfgApiError ? find.error.message : "Search failed."}</MfgAlert>}
      </MfgPanel>
      {rows && (
        <MfgPanel title={rows.length ? `Used in ${rows.length} structure(s)` : "Not used in any active structure"}>
          <ul className="text-sm" aria-label="Where used results">
            {rows.map((row) => (
              <li key={row.id} style={{ paddingLeft: `${(Number(row.level) - 1) * 16}px` }}>
                <Link className="text-brand hover:underline" href={`/manufacturing/bom/${row.bomId}`}>{row.itemName} ({row.itemCode})</Link> — BOM {row.bomCode}, {quantity(row.quantityPer)} per{Number(row.level) > 1 ? ` (level ${row.level})` : ""}
              </li>
            ))}
          </ul>
        </MfgPanel>
      )}
    </div>
  );
}
