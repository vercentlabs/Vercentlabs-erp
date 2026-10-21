"use client";

// Repeat order (Sales audit): a new draft order with the same customer, products and quantities as this order or invoice, priced today.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@vercentlabs/design-system";

import { post, SalesApiError } from "@/features/sales/shared/http";

export function RepeatOrderButton({ orderId, invoiceId }: { orderId?: string; invoiceId?: string }) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const repeat = useMutation({
    mutationFn: () => post<{ result: { id: string } }>("/orders/repeat", { orderId, invoiceId, idempotencyKey }),
    onSuccess: ({ result }) => router.push(`/sales/orders/${result.id}`),
  });
  return (
    <span className="inline-flex flex-col">
      <Button variant="secondary" isLoading={repeat.isPending} onPress={() => repeat.mutate()}>Repeat order</Button>
      {repeat.isError && <span role="alert" className="text-xs text-danger">{repeat.error instanceof SalesApiError ? repeat.error.message : "The order could not be repeated."}</span>}
    </span>
  );
}
