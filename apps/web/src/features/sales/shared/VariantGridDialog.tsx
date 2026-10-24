"use client";

// The variant grid for Sales (Sales report Phase 3): the shared grid (shared/ui/VariantGridDialog) with the products that are sold.
import { VariantGridDialog as SharedVariantGridDialog } from "@/shared/ui/VariantGridDialog";

export function VariantGridDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (lines: Array<{ itemId: string; quantity: number }>) => void }) {
  return <SharedVariantGridDialog basePath="/api/sales" scope="sales" emptyText="No product with sellable variants matches." onClose={onClose} onAdd={onAdd} />;
}
