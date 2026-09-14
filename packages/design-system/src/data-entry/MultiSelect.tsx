import {
  Button,
  Popover,
  ListBox,
  ListBoxItem,
  DialogTrigger,
  type Selection,
} from "react-aria-components";
import { ChevronDown, Check } from "lucide-react";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { popoverChrome, listBoxItemChrome } from "../utilities/overlay-chrome.ts";
import { cn } from "../utilities/cn.ts";

export interface MultiSelectOption<T extends string = string> {
  value: T;
  label: string;
  isDisabled?: boolean;
}

export interface MultiSelectProps<T extends string = string>
  extends Pick<FieldChromeProps, "label" | "description" | "errorMessage" | "isRequired"> {
  className?: string;
  size?: "compact" | "standard";
  placeholder?: string;
  options: MultiSelectOption<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  isDisabled?: boolean;
}

/**
 * Multi-value selection from a fixed option list, e.g. tags, roles, saved
 * filters. Selected items render as chips in the closed trigger; selection
 * is changed via the checkable list in the popover, not per-chip remove
 * buttons — a remove button nested inside the trigger button is invalid
 * HTML (button-in-button) and breaks hydration, so this deliberately keeps
 * one interactive element (the trigger) rather than nesting a second.
 * React Aria has no built-in MultiSelect primitive — this composes
 * ListBox(selectionMode="multiple") inside a popover, per RAC's documented
 * pattern for that combination.
 */
export function MultiSelect<T extends string = string>({
  className,
  label,
  description,
  errorMessage,
  isRequired,
  size,
  placeholder = "Select…",
  options,
  value,
  onChange,
  isDisabled,
}: MultiSelectProps<T>) {
  const selected = new Set(value);
  const selectedOptions = options.filter((o) => selected.has(o.value));

  function handleSelectionChange(keys: Selection) {
    if (keys === "all") {
      onChange(options.map((o) => o.value));
      return;
    }
    onChange(Array.from(keys) as T[]);
  }

  return (
    <div className={cn("group flex flex-col gap-1.5", className)} data-invalid={errorMessage ? true : undefined}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <DialogTrigger>
          <Button
            isDisabled={isDisabled}
            className={cn(
              inputChrome({ size }),
              "flex min-h-[var(--control-height-standard)] h-auto items-center justify-between gap-2 py-1.5 text-left",
            )}
          >
            <span className="flex flex-1 flex-wrap items-center gap-1">
              {selectedOptions.length === 0 && <span className="text-text-muted">{placeholder}</span>}
              {selectedOptions.map((o) => (
                <span
                  key={o.value}
                  className="rounded-[var(--radius-control)] bg-brand-soft px-1.5 py-0.5 text-xs text-text"
                >
                  {o.label}
                </span>
              ))}
            </span>
            <ChevronDown className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
          </Button>
          <Popover className={cn(popoverChrome, "w-[var(--trigger-width)] p-1")}>
            <ListBox
              items={options}
              selectionMode="multiple"
              selectedKeys={selected}
              onSelectionChange={handleSelectionChange}
              className="flex max-h-72 flex-col gap-0.5 overflow-auto outline-none"
            >
              {(option) => (
                <ListBoxItem id={option.value} isDisabled={option.isDisabled} textValue={option.label} className={listBoxItemChrome}>
                  {({ isSelected }) => (
                    <>
                      <span className="flex-1 truncate">{option.label}</span>
                      {isSelected && <Check className="size-4 shrink-0" aria-hidden="true" />}
                    </>
                  )}
                </ListBoxItem>
              )}
            </ListBox>
          </Popover>
        </DialogTrigger>
      </FieldChrome>
    </div>
  );
}
