"use client";

import { useMemo } from "react";
import { ComboBox } from "@vercentlabs/design-system";

import { COUNTRY_CODES, countryName } from "@/shared/format/human";

// Countries and currencies by name; the two-letter code is what is stored.
export function CountrySelect({ label = "Country", value, onChange, className, isRequired }: { label?: string; value: string; onChange: (code: string) => void; className?: string; isRequired?: boolean }) {
  const options = useMemo(() => {
    const codes = value && !COUNTRY_CODES.includes(value) ? [value, ...COUNTRY_CODES] : COUNTRY_CODES;
    return codes.map((code) => ({ value: code, label: countryName(code) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [value]);
  return <ComboBox label={label} placeholder="Search countries" options={options} selectedKey={value || null} onSelectionChange={(key) => onChange(key ? String(key) : "")} className={className} isRequired={isRequired} />;
}
