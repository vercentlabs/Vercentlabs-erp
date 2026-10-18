"use client";

// The state of an address or a person: chosen from the list for India (the server accepts only a real state there), typed elsewhere.
import { Select, TextField } from "@vercentlabs/design-system";

import { GST_STATES, findIndianState } from "@/features/crm/shared/gst-states";

const NONE = "";

export function StateField({ countryCode, value, onChange, errorMessage, isRequired, className }: {
  countryCode: string | null | undefined; value: string; onChange: (value: string) => void; errorMessage?: string; isRequired?: boolean; className?: string;
}) {
  if ((countryCode ?? "").toUpperCase() !== "IN")
    return <TextField label="State" className={className} isRequired={isRequired} value={value} onChange={onChange} errorMessage={errorMessage} />;
  // A stored spelling the list does not use (an old record) is shown as the state it means.
  const selected = value ? (findIndianState({ name: value })?.name ?? value) : NONE;
  return (
    <Select label="State" className={className} isRequired={isRequired} selectedKey={selected} errorMessage={errorMessage} isInvalid={Boolean(errorMessage)}
      onSelectionChange={(key) => onChange(String(key ?? NONE))}
      options={[...(isRequired ? [] : [{ value: NONE, label: "Not set" }]), ...GST_STATES.map((state) => ({ value: state.name, label: `${state.name} (${state.code})` }))]} />
  );
}
