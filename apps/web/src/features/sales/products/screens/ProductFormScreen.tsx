"use client";

// New product or service, and Edit.
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, getProduct, getProductOptions, type Product } from "../api/products-api";
import { ProductForm } from "../components/ProductForm";

export function ProductFormScreen({ productId }: { productId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const editing = Boolean(productId);
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "options"), queryFn: getProductOptions, staleTime: 60_000 });
  const productQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", productId), queryFn: () => getProduct(productId!), enabled: editing });
  const options = optionsQuery.data;

  if (optionsQuery.isLoading || (editing && productQuery.isLoading)) return <LoadingState label="Loading" rows={6} />;
  if (optionsQuery.isError && errorCode(optionsQuery.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to products" description="Ask an administrator for access." />;
  if (!options) return <ErrorState title="Could not load the form" action={{ label: "Try again", onPress: () => void optionsQuery.refetch() }} />;
  if (editing ? !options.capabilities.edit : !options.capabilities.create)
    return <PermissionState title={editing ? "You cannot edit products" : "You cannot create products"} description="Ask an administrator for access." />;
  if (editing && !productQuery.data) return <ErrorState title="Product not found" action={{ label: "Back to products", onPress: () => router.push("/sales/products") }} />;

  const saved = (product: Product) => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "options") });
    router.push(`/sales/products/${product.id}`);
  };
  const product = productQuery.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={product ? `Edit ${product.name}` : "New product or service"}
        description={product ? `${product.code}. Changes apply to new documents; issued documents keep their own copy.` : "Type, name and unit are required."} />
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-6">
        <ProductForm key={productId ?? "new"} options={options} product={product} onSaved={saved} onCancel={() => router.push(product ? `/sales/products/${product.id}` : "/sales/products")} />
      </div>
    </div>
  );
}
