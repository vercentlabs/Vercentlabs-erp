import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

export function Switch({ className, ...props }: ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        "relative flex h-5 w-9 items-center rounded-[var(--radius-pill)] bg-[var(--color-border-strong)] transition-colors",
        "data-[checked]:bg-[var(--color-action-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-[var(--color-surface)] shadow-sm transition-transform data-[checked]:translate-x-[18px]" />
    </BaseSwitch.Root>
  );
}
