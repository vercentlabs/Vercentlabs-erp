import {
  ComboBox as AriaComboBox,
  Input,
  Button,
  Popover,
  ListBox,
  ListBoxItem,
  type ComboBoxProps as AriaComboBoxProps,
} from "react-aria-components";
import { ChevronDown, Check } from "lucide-react";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { popoverChrome, listBoxItemChrome } from "../utilities/overlay-chrome.ts";
import { cn } from "../utilities/cn.ts";

export interface ComboBoxOption<T extends string = string> {
  value: T;
  label: string;
  isDisabled?: boolean;
}

export interface ComboBoxProps<T extends string = string>
  extends Omit<AriaComboBoxProps<{ id: T }>, "className" | "children">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage" | "isRequired"> {
  className?: string;
  size?: "compact" | "standard";
  placeholder?: string;
  options: ComboBoxOption<T>[];
  /** Shown in the listbox while an async `options` source is loading —
   * ComboBox itself doesn't fetch; the caller owns that via onInputChange. */
  isLoading?: boolean;
  emptyMessage?: string;
}

/**
 * Filterable single-select combobox — the ERP-standard control for
 * "pick one record from a large/async set" (customer, item, account…).
 * For a fixed small option list, prefer Select (no typing required).
 */
export function ComboBox<T extends string = string>({
  className,
  label,
  description,
  errorMessage,
  isRequired,
  size,
  placeholder,
  options,
  isLoading,
  emptyMessage = "No matches",
  ...props
}: ComboBoxProps<T>) {
  return (
    <AriaComboBox isRequired={isRequired} isInvalid={props.isInvalid ?? (errorMessage ? true : undefined)} className={cn("group flex flex-col gap-1.5", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <div className={cn(inputChrome({ size }), "flex items-center gap-1 px-0")}>
          <Input placeholder={placeholder} className="h-full min-w-0 flex-1 bg-transparent px-3 outline-none placeholder:text-text-muted" />
          <Button className="flex h-full shrink-0 items-center px-2 text-text-muted hover:text-text">
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </FieldChrome>
      <Popover className={cn(popoverChrome, "w-[var(--trigger-width)] p-1")}>
        <ListBox items={options} renderEmptyState={() => <div className="px-2.5 py-4 text-center text-sm text-text-muted">{isLoading ? "Loading…" : emptyMessage}</div>} className="flex max-h-72 flex-col gap-0.5 overflow-auto outline-none">
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
    </AriaComboBox>
  );
}
