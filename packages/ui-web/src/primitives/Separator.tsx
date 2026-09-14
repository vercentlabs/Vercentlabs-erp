import { Separator as BaseSeparator } from "@base-ui-components/react/separator";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

export function Separator({ className, orientation = "horizontal", ...props }: ComponentProps<typeof BaseSeparator>) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={cn(
        "shrink-0 bg-[var(--color-border-default)]",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}
