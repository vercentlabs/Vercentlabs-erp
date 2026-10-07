"use client";

// New item and Edit item, from Inventory (Items) or Sales (Products & Services): the same record either way.
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, getItem, getItemOptions, type Item } from "../api/items-api";
import { ItemForm } from "../components/ItemForm";
import { LENS, type ItemLens } from "../item-format";

export function ItemFormScreen({ itemId, lens = "inventory" }: { itemId?: string; lens?: ItemLens }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const base = LENS[lens].base;
  const editing = Boolean(itemId);
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "options"), queryFn: getItemOptions, staleTime: 60_000 });
  const itemQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", itemId), queryFn: () => getItem(itemId!), enabled: editing });
  const options = optionsQuery.data;

  if (optionsQuery.isLoading || (editing && itemQuery.isLoading)) return <LoadingState label="Loading" rows={6} />;
  if (optionsQuery.isError && errorCode(optionsQuery.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to items" description="Ask an administrator for access." />;
  if (!options) return <ErrorState title="Could not load the form" action={{ label: "Try again", onPress: () => void optionsQuery.refetch() }} />;
  if (editing ? !options.capabilities.edit : !options.capabilities.create)
    return <PermissionState title={editing ? "You cannot edit items" : "You cannot create items"} description="Ask an administrator for access." />;
  if (editing && !itemQuery.data) return <ErrorState title="Item not found" action={{ label: `Back to ${LENS[lens].title}`, onPress: () => router.push(base) }} />;

  const saved = (item: Item) => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "options") });
    router.push(`${base}/${item.id}`);
  };
  const item = itemQuery.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={item ? `Edit ${item.name}` : LENS[lens].newLabel}
        description={item ? `${item.code}. Changes apply to new documents; issued documents keep their own copy.` : "Name, type and base unit are required; a stock item also needs a category to be activated."} />
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-6">
        <ItemForm key={itemId ?? "new"} options={options} item={item} onSaved={saved} onCancel={() => router.push(item ? `${base}/${item.id}` : base)} />
      </div>
    </div>
  );
}
