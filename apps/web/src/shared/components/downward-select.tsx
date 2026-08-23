"use client";

import { useEffect, useRef, useState } from "react";

import AppIcon from "@/shared/components/app-icon";

export type DownwardSelectOption = { value: string; label: string };

export default function DownwardSelect({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  label,
  ariaLabel,
}: {
  options: DownwardSelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  label?: string;
  ariaLabel?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [internalValue, setInternalValue] = useState(
    defaultValue || options[0]?.value || "",
  );
  const selectedValue = value ?? internalValue;
  const selectedLabel =
    options.find((option) => option.value === selectedValue)?.label ||
    options[0]?.label ||
    "Select";

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node))
        detailsRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  const select = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
    detailsRef.current?.removeAttribute("open");
  };

  return (
    <div className="downward-select-field">
      {label ? <span className="downward-select-label">{label}</span> : null}
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <details
        className="downward-select"
        ref={detailsRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            detailsRef.current?.removeAttribute("open");
            detailsRef.current?.querySelector("summary")?.focus();
          }
        }}
      >
        <summary aria-label={ariaLabel || label || selectedLabel}>
          <span>{selectedLabel}</span>
          <AppIcon name="chevron-down" size={17} />
        </summary>
        <div className="downward-select-options" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={selectedValue === option.value}
              onClick={() => select(option.value)}
            >
              <span>{option.label}</span>
              {selectedValue === option.value ? (
                <AppIcon name="check" size={15} />
              ) : null}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
