import { boldCol, col, statusCol } from "@/features/procurement/configs/common";
import type { FormConfig } from "@/features/procurement/shared/DocumentForm";
import type { ListConfig } from "@/features/procurement/shared/ResourceListPage";

export const categoriesList: ListConfig = {
  resource: "categories",
  title: "Supplier categories",
  description: "How suppliers and spend are grouped.",
  searchLabel: "Search categories",
  statuses: ["active"],
  columns: () => [col("code", "Code", (r) => String(r.code ?? "—")), boldCol("name", "Category", (r) => String(r.name ?? "—")), col("desc", "Description", (r) => String(r.description ?? "—")), statusCol()],
  newHref: "/procurement/categories/new",
  newLabel: "New category",
  createPermission: "procurement.settings.manage",
  emptyTitle: "No categories yet",
  emptyDescription: "Create categories such as Raw materials, Packaging or Services.",
};

export const categoryForm: FormConfig = {
  resource: "categories",
  noun: "category",
  backHref: "/procurement/categories",
  detailHref: () => "/procurement/categories",
  fields: [
    { name: "code", label: "Code", kind: "text", required: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "description", label: "Description", kind: "textarea" },
  ],
};
