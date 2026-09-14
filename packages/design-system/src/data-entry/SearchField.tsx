import { forwardRef } from "react";
import {
  SearchField as AriaSearchField,
  Input,
  Button,
  type SearchFieldProps as AriaSearchFieldProps,
} from "react-aria-components";
import { Search, X } from "lucide-react";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { cn } from "../utilities/cn.ts";

export interface SearchFieldProps
  extends Omit<AriaSearchFieldProps, "className">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage"> {
  className?: string;
  size?: "compact" | "standard";
  placeholder?: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className, label, description, errorMessage, size, placeholder = "Search…", ...props },
  ref,
) {
  return (
    <AriaSearchField className={cn("group", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage}>
        <div className={cn(inputChrome({ size }), "flex items-center gap-2 px-3")}>
          <Search className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
          <Input ref={ref} placeholder={placeholder} className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-muted" />
          <Button className="flex shrink-0 text-text-muted hover:text-text group-data-[empty]:hidden">
            <X className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Clear search</span>
          </Button>
        </div>
      </FieldChrome>
    </AriaSearchField>
  );
});
