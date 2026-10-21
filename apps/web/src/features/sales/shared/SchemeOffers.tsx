"use client";

// The free-goods schemes a document earns (Sales audit M3), from the server's preview: what each gives, what is already on the document, and
// a button that adds the rest as a free line.
import { Button } from "@vercentlabs/design-system";

import type { SalesDocumentScheme } from "@/features/sales/quotations/api/quotations-api";
import { Panel } from "@/shared/ui/Panel";

export function SchemeOffers({ schemes, onAdd }: { schemes: SalesDocumentScheme[] | undefined; onAdd: (scheme: SalesDocumentScheme) => void }) {
  if (!schemes?.length) return null;
  return (
    <Panel title="Schemes" description="Free goods this document earns. A free line is delivered and invoiced at no price.">
      <ul className="flex flex-col gap-2 text-sm">
        {schemes.map((scheme) => {
          const left = Math.max(0, scheme.earned - scheme.claimed);
          return (
            <li key={scheme.ruleId} className="flex flex-col gap-1">
              <span className="font-medium">{scheme.name}</span>
              <span className="text-xs text-text-muted">
                Buy {scheme.buyQuantity}, get {scheme.freeQuantity} {scheme.freeItemName} free · bought {scheme.bought} · earned {scheme.earned} · on the document {scheme.claimed}
              </span>
              {left > 0 && (
                <Button size="compact" variant="secondary" onPress={() => onAdd({ ...scheme, earned: left })}>Add {left} free {scheme.freeItemName}</Button>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
