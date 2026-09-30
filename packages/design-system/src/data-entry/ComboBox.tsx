import {
  ComboBox as AriaComboBox,
  Input,
  Button,
  Popover,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Header,
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

export interface ComboBoxSection<T extends string = string> {
  id: string;
  label: string;
  options: ComboBoxOption<T>[];
}

export interface ComboBoxProps<T extends string = string>
  extends Omit<AriaComboBoxProps<{ id: T }>, "className" | "children">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage" | "isRequired"> {
  className?: string;
  size?: "compact" | "standard";
  placeholder?: string;
  options?: ComboBoxOption<T>[];
  /** Grouped options (each group gets a heading); used instead of `options`.
   * Typing still filters across every group. */
  sections?: ComboBoxSection<T>[];
  /** Shown in the listbox while an async `options` source is loading —
   * ComboBox itself doesn't fetch; the caller owns that via onInputChange. */
  isLoading?: boolean;
  emptyMessage?: string;
}

function renderOption<T extends string>(option: ComboBoxOption<T>) {
  return (
    <ListBoxItem key={option.value} id={option.value} isDisabled={option.isDisabled} textValue={option.label} className={listBoxItemChrome}>
      {({ isSelected }) => (
        <>
          <span className="flex-1 truncate">{option.label}</span>
          {isSelected && <Check className="size-4 shrink-0" aria-hidden="true" />}
        </>
      )}
    </ListBoxItem>
  );
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
  options = [],
  sections,
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
        {sections ? (
          <ListBox renderEmptyState={() => <div className="px-2.5 py-4 text-center text-sm text-text-muted">{isLoading ? "Loading…" : emptyMessage}</div>} className="flex max-h-80 flex-col gap-0.5 overflow-auto outline-none">
            {sections.map((section) => (
              <ListBoxSection key={section.id} id={section.id} className="flex flex-col gap-0.5 [&:not(:first-child)]:mt-1.5">
                <Header className="px-2.5 pt-1 pb-0.5 text-xs font-semibold tracking-wide text-text-secondary uppercase">{section.label}</Header>
                {section.options.map((option) => renderOption(option))}
              </ListBoxSection>
            ))}
          </ListBox>
        ) : (
          <ListBox items={options} renderEmptyState={() => <div className="px-2.5 py-4 text-center text-sm text-text-muted">{isLoading ? "Loading…" : emptyMessage}</div>} className="flex max-h-72 flex-col gap-0.5 overflow-auto outline-none">
            {(option) => renderOption(option)}
          </ListBox>
        )}
      </Popover>
    </AriaComboBox>
  );
}
