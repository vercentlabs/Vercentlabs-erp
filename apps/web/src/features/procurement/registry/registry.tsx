"use client";

import { DocumentDetail, type DetailConfig } from "@/features/procurement/shared/DocumentDetail";
import { DocumentForm, type FormConfig } from "@/features/procurement/shared/DocumentForm";
import { ResourceListPage, type ListConfig } from "@/features/procurement/shared/ResourceListPage";
import { categoriesList, categoryForm } from "@/features/procurement/configs/categories";
import { requisitionDetail, requisitionForm, requisitionsList } from "@/features/procurement/configs/requisitions";
import { supplierForm, suppliersList } from "@/features/procurement/configs/suppliers";
import { SupplierDetailScreen } from "@/features/procurement/screens/SupplierDetailScreen";

const LISTS: Record<string, ListConfig> = {
  suppliers: suppliersList,
  categories: categoriesList,
  requisitions: requisitionsList,
};
const FORMS: Record<string, FormConfig> = {
  suppliers: supplierForm,
  categories: categoryForm,
  requisitions: requisitionForm,
};
const DETAILS: Record<string, DetailConfig> = {
  requisitions: requisitionDetail,
};
// Details with bespoke sections render their own screen.
const CUSTOM_DETAILS: Record<string, (props: { id: string }) => React.ReactNode> = {
  suppliers: (props) => <SupplierDetailScreen id={props.id} />,
};

export function ListPage({ name }: { name: string }) {
  return <ResourceListPage config={LISTS[name]} />;
}
export function FormPage({ name, id }: { name: string; id?: string }) {
  return <DocumentForm config={FORMS[name]} id={id} />;
}
export function DetailPage({ name, id }: { name: string; id: string }) {
  const custom = CUSTOM_DETAILS[name];
  if (custom) return <>{custom({ id })}</>;
  return <DocumentDetail config={DETAILS[name]} id={id} />;
}
