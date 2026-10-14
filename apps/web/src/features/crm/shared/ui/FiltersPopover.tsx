"use client";

// One "Filters" button for a CRM list: every filter in one popover, each applying the moment it changes. The active ones show as removable
// chips under the toolbar (the list's filter bar).
import type { ReactNode } from "react";
import { Filter } from "lucide-react";
import { Button, Popover, PopoverTrigger } from "@vercentlabs/design-system";

export function FiltersPopover({ active = 0, onClear, children }: { active?: number; onClear?: () => void; children: ReactNode }) {
  return (
    <PopoverTrigger>
      <Button variant="outline" size="compact"><Filter className="size-4" aria-hidden="true" />Filters{active ? ` (${active})` : ""}</Button>
      <Popover placement="bottom start">
        <div className="flex w-[min(34rem,calc(100vw-4rem))] flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">{children}</div>
          {onClear && active > 0 && <div className="flex justify-end"><Button variant="ghost" size="compact" onPress={onClear}>Clear all</Button></div>}
        </div>
      </Popover>
    </PopoverTrigger>
  );
}
