import { useState, type KeyboardEvent } from "react";
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
import { ChevronDown, Check, Plus } from "lucide-react";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { popoverChrome, listBoxItemChrome } from "../utilities/overlay-chrome.ts";
import { cn } from "../utilities/cn.ts";

export interface ComboBoxOption<T extends string = string> {
  value: T;
  label: string;
  /** A second line in the list: GSTIN, mobile, city, code, last price… */
  description?: string;
  isDisabled?: boolean;
}

export interface ComboBoxSection<T extends string = string> {
  id: string;
  label: string;
  options: ComboBoxOption<T>[];
}

/** The id of the "+ Create '…'" row; never a record's id. */
export const COMBOBOX_CREATE_KEY = "__create__";

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
  /** Create where you are: adds "+ Create '…'" as the last row of the list (and Alt+C in the box). It gets what was typed; the
   * caller opens its quick-create form and selects the new record. */
  onCreate?: (text: string) => void;
  /** The create row's words for what was typed (default: Create "Ravi"; with nothing typed, "Create new"). */
  createLabel?: (text: string) => string;
}

function renderOption<T extends string>(option: ComboBoxOption<T>) {
  return (
    <ListBoxItem key={option.value} id={option.value} isDisabled={option.isDisabled} textValue={option.label} className={listBoxItemChrome}>
      {({ isSelected }) => (
        <>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{option.label}</span>
            {option.description && <span className="truncate text-xs text-text-muted">{option.description}</span>}
          </span>
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
 * With onCreate it also offers to create what was typed (create where you are).
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
  onCreate,
  createLabel,
  ...props
}: ComboBoxProps<T>) {
  const [typed, setTyped] = useState("");
  const text = typed.trim();
  const createText = createLabel ? createLabel(text) : text ? `Create "${text}"` : "Create new";
  // The create row keeps what was typed as its text, so the list's own filter never hides it.
  const createRow = onCreate ? (
    <ListBoxItem key={COMBOBOX_CREATE_KEY} id={COMBOBOX_CREATE_KEY} textValue={typed || createText}
      className={cn(listBoxItemChrome, "mt-0.5 border-t border-border font-medium text-brand data-[focused]:text-brand")}>
      <Plus className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">{createText}</span>
      <kbd className="hidden shrink-0 rounded border border-border px-1 text-[10px] font-medium text-text-muted sm:inline">Alt+C</kbd>
    </ListBoxItem>
  ) : null;
  const empty = () => (
    <div className="px-2.5 py-4 text-center text-sm text-text-muted">{isLoading ? "Loading…" : emptyMessage}</div>
  );
  const onSelectionChange: AriaComboBoxProps<{ id: T }>["onSelectionChange"] = (key) => {
    if (key === COMBOBOX_CREATE_KEY) { onCreate?.(text); return; }
    props.onSelectionChange?.(key);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (onCreate && event.altKey && (event.key === "c" || event.key === "C")) { event.preventDefault(); onCreate(text); }
  };
  return (
    <AriaComboBox isRequired={isRequired} isInvalid={props.isInvalid ?? (errorMessage ? true : undefined)} className={cn("group flex flex-col gap-1.5", className)}
      {...props}
      onSelectionChange={onSelectionChange}
      onInputChange={(value) => { setTyped(value); props.onInputChange?.(value); }}
      // With a create row the list never closes as empty: the row is the way forward.
      allowsEmptyCollection={props.allowsEmptyCollection ?? Boolean(onCreate)}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <div className={cn(inputChrome({ size }), "flex items-center gap-1 px-0")}>
          <Input placeholder={placeholder} onKeyDown={onKeyDown} className="h-full min-w-0 flex-1 bg-transparent px-3 outline-none placeholder:text-text-muted" />
          <Button className="flex h-full shrink-0 items-center px-2 text-text-muted hover:text-text">
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </FieldChrome>
      <Popover className={cn(popoverChrome, "w-[var(--trigger-width)] p-1")}>
        {sections ? (
          <ListBox renderEmptyState={empty} className="flex max-h-80 flex-col gap-0.5 overflow-auto outline-none">
            {sections.map((section) => (
              <ListBoxSection key={section.id} id={section.id} className="flex flex-col gap-0.5 [&:not(:first-child)]:mt-1.5">
                <Header className="px-2.5 pt-1 pb-0.5 text-xs font-semibold tracking-wide text-text-secondary uppercase">{section.label}</Header>
                {section.options.map((option) => renderOption(option))}
              </ListBoxSection>
            ))}
            {createRow}
          </ListBox>
        ) : onCreate ? (
          <ListBox renderEmptyState={empty} className="flex max-h-72 flex-col gap-0.5 overflow-auto outline-none">
            {options.map((option) => renderOption(option))}
            {createRow}
          </ListBox>
        ) : (
          <ListBox items={options} renderEmptyState={empty} className="flex max-h-72 flex-col gap-0.5 overflow-auto outline-none">
            {(option) => renderOption(option)}
          </ListBox>
        )}
      </Popover>
    </AriaComboBox>
  );
}
