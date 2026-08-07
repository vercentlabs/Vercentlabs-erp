import { BorderedPanel } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

/** A visually distinct definition callout — used for glossary standalone pages and any term-first section. */
export function DefinitionBlock({ term, definition, className }: { term: string; definition: string; className?: string }) {
  return (
    <BorderedPanel className={className}>
      <Text variant="eyebrow" as="p">
        {term}
      </Text>
      <Text variant="bodyLarge" className="mt-2 font-medium">
        {definition}
      </Text>
    </BorderedPanel>
  );
}
