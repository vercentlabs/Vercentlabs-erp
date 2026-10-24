"use client";

// The delivery method on a quotation or order (Sales report Phase 3): its freight replaces any freight typed below. Hidden until a method
// is set up, unless the document already names one.
import { useQuery } from "@tanstack/react-query";
import { Select } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { request } from "@/features/sales/shared/http";

type Method = { id: string; name: string; active: boolean };

export function DeliveryMethodSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "delivery-methods", "active"),
    queryFn: () => request<{ methods: Method[] }>("/delivery-methods").then((result) => result.methods) });
  const methods = query.data ?? [];
  if (!methods.length && !value) return null;
  const options = [{ value: "", label: "None — type the freight" }, ...methods.map((method) => ({ value: method.id, label: method.name }))];
  if (value && !methods.some((method) => method.id === value)) options.push({ value, label: "A method now switched off" });
  return (
    <div className="max-w-full sm:max-w-sm">
      <Select label="Delivery method" selectedKey={value} onSelectionChange={(key) => onChange(String(key ?? ""))} options={options}
        description={value ? "Its freight replaces any freight typed below." : undefined} />
    </div>
  );
}
