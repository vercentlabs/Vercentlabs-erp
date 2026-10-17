"use client";

// One "Filters" button for a CRM list: every filter in one popover, each applying the moment it changes. The active ones show as removable
// chips under the toolbar (the list's filter bar).
import type { ReactNode } from "react";
import { Filter } from "lucide-react";
import { Button, Popover, PopoverTrigger } from "@vercentlabs/design-system";

export function FiltersPopover({ active = 0, onClear, children }: { active?: number; onClear?: () => void; children: ReactNode }) {
  return (
    <PopoverTrigger>
      <Button variant={active ? "secondary" : "outline"} size="compact">
        <Filter className="size-4" aria-hidden="true" />
        <span className="max-sm:sr-only">Filters</span>
        {active > 0 && <span className="rounded-full bg-brand px-1.5 text-xs tabular-nums text-white">{active}</span>}
      </Button>
      <Popover placement="bottom start">
        {/* One column on a phone, two from a tablet; the panel scrolls inside itself, and Clear all stays reachable at the bottom. */}
        <div className="flex max-h-[min(32rem,calc(100dvh-8rem))] w-[min(34rem,calc(100vw-2rem))] flex-col gap-3">
          <div className="grid min-h-0 grid-cols-1 items-start gap-3 overflow-y-auto pr-1 sm:grid-cols-2">{children}</div>
          {onClear && active > 0 && (
            <div className="flex justify-end border-t border-border pt-2"><Button variant="ghost" size="compact" onPress={onClear}>Clear all</Button></div>
          )}
        </div>
      </Popover>
    </PopoverTrigger>
  );
}
// The list toolbar gathers unknown controls into its own Filters menu; this one is that menu, so it stays in the row.
FiltersPopover.toolbarInline = true;
