import { Separator, type SeparatorProps } from "react-aria-components";
import { cn } from "../utilities/cn.ts";

export interface DividerProps extends Omit<SeparatorProps, "className"> {
  className?: string;
}

export function Divider({ className, orientation = "horizontal", ...props }: DividerProps) {
  return (
    <Separator
      orientation={orientation}
      className={cn("bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
      {...props}
    />
  );
}
