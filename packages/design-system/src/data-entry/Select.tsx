import {
  Select as AriaSelect,
  SelectValue,
  Button,
  Popover,
  ListBox,
  ListBoxItem,
  type SelectProps as AriaSelectProps,
} from "react-aria-components";
import { ChevronDown, Check } from "lucide-react";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { popoverChrome, listBoxItemChrome } from "../utilities/overlay-chrome.ts";
import { cn } from "../utilities/cn.ts";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  isDisabled?: boolean;
}

export interface SelectProps<T extends string = string>
  extends Omit<AriaSelectProps<{ id: T }>, "className" | "children">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage" | "isRequired"> {
  className?: string;
  size?: "compact" | "standard";
  placeholder?: string;
  options: SelectOption<T>[];
}

export function Select<T extends string = string>({
  className,
  label,
  description,
  errorMessage,
  isRequired,
  size,
  placeholder = "Select…",
  options,
  ...props
}: SelectProps<T>) {
  return (
    <AriaSelect isRequired={isRequired} className={cn("group flex flex-col gap-1.5", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <Button className={cn(inputChrome({ size }), "flex items-center justify-between gap-2 text-left")}>
          <SelectValue className="truncate data-[placeholder]:text-text-subtle">
            {({ selectedText }) => selectedText || placeholder}
          </SelectValue>
          <ChevronDown className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
        </Button>
      </FieldChrome>
      <Popover className={cn(popoverChrome, "w-[var(--trigger-width)] p-1")}>
        <ListBox items={options} className="flex max-h-72 flex-col gap-0.5 overflow-auto outline-none">
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
    </AriaSelect>
  );
}
