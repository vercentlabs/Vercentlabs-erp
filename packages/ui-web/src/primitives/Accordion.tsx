import { Accordion as BaseAccordion } from "@base-ui-components/react/accordion";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

export const AccordionRoot = BaseAccordion.Root;
export const AccordionItem = BaseAccordion.Item;

export function AccordionTrigger({ className, children, ...props }: ComponentProps<typeof BaseAccordion.Trigger>) {
  return (
    <BaseAccordion.Header>
      <BaseAccordion.Trigger
        className={cn(
          "flex w-full items-center justify-between gap-2 py-3 text-left text-[length:var(--text-sm)] font-medium text-[var(--color-text-primary)] outline-none",
          "focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] rounded",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown className="size-4 shrink-0 text-[var(--color-text-muted)] transition-transform data-[panel-open]:rotate-180" aria-hidden="true" />
      </BaseAccordion.Trigger>
    </BaseAccordion.Header>
  );
}

export function AccordionPanel({ className, ...props }: ComponentProps<typeof BaseAccordion.Panel>) {
  return <BaseAccordion.Panel className={cn("overflow-hidden pb-3 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]", className)} {...props} />;
}
