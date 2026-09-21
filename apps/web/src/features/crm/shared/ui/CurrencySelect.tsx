"use client";

import { useMemo } from "react";
import { Select } from "@vercentlabs/design-system";

import { CURRENCY_CODES, currencyName } from "../human";

export function CurrencySelect({ label = "Currency", value, onChange, className }: { label?: string; value: string; onChange: (code: string) => void; className?: string }) {
  const options = useMemo(() => {
    const codes = value && !CURRENCY_CODES.includes(value) ? [value, ...CURRENCY_CODES] : CURRENCY_CODES;
    return codes.map((code) => ({ value: code, label: `${code} · ${currencyName(code)}` }));
  }, [value]);
  return <Select label={label} options={options} selectedKey={value || "INR"} onSelectionChange={(key) => onChange(String(key))} className={className} />;
}
