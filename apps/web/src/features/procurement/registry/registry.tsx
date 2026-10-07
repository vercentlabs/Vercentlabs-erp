"use client";

import { DocumentForm, type FormConfig } from "@/features/procurement/shared/DocumentForm";
import { ResourceListPage, type ListConfig } from "@/features/procurement/shared/ResourceListPage";
import { categoriesList, categoryForm } from "@/features/procurement/configs/categories";

// Procurement's configuration records that use the generic list and form.
const LISTS: Record<string, ListConfig> = { categories: categoriesList };
const FORMS: Record<string, FormConfig> = { categories: categoryForm };

export function ListPage({ name }: { name: string }) {
  return <ResourceListPage config={LISTS[name]} />;
}

export function FormPage({ name, id }: { name: string; id?: string }) {
  return <DocumentForm config={FORMS[name]} id={id} />;
}
