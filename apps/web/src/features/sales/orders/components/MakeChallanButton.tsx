"use client";

// Without the Stock app an order has no deliveries: its goods go out on a delivery challan (Sales audit).
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@vercentlabs/design-system";

import { SalesApiError } from "@/features/sales/shared/http";
import { createChallan } from "@/features/sales/challans/challans-api";

export function MakeChallanButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const make = useMutation({ mutationFn: () => createChallan({ salesOrderId: orderId, purpose: "sale_dispatch" }), onSuccess: (challan) => router.push(`/sales/challans/${challan.id}`) });
  return (
    <span className="inline-flex flex-col">
      <Button variant="secondary" isLoading={make.isPending} onPress={() => make.mutate()}>Make challan</Button>
      {make.isError && <span role="alert" className="text-xs text-danger">{make.error instanceof SalesApiError ? make.error.message : "The challan could not be made."}</span>}
    </span>
  );
}
