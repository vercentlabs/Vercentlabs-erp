"use client";

import { DocumentDetail, type DetailConfig } from "@/features/procurement/shared/DocumentDetail";
import { DocumentForm, type FormConfig } from "@/features/procurement/shared/DocumentForm";
import { ResourceListPage, type ListConfig } from "@/features/procurement/shared/ResourceListPage";
import { categoriesList, categoryForm } from "@/features/procurement/configs/categories";
import { requisitionDetail, requisitionForm, requisitionsList } from "@/features/procurement/configs/requisitions";
import { supplierForm, suppliersList } from "@/features/procurement/configs/suppliers";
import { SupplierDetailScreen } from "@/features/procurement/screens/SupplierDetailScreen";
import { agreementForm, agreementsList } from "@/features/procurement/configs/agreements";
import { orderForm, ordersList } from "@/features/procurement/configs/orders";
import { rfqForm, rfqsList } from "@/features/procurement/configs/rfqs";
import { awardsList, quotationsList } from "@/features/procurement/configs/sourcing-lists";
import { AgreementDetailScreen } from "@/features/procurement/screens/AgreementDetailScreen";
import { OrderDetailScreen } from "@/features/procurement/screens/OrderDetailScreen";
import { RfqDetailScreen } from "@/features/procurement/screens/RfqDetailScreen";

const LISTS: Record<string, ListConfig> = {
  suppliers: suppliersList,
  categories: categoriesList,
  requisitions: requisitionsList,
  orders: ordersList,
  agreements: agreementsList,
  rfqs: rfqsList,
  quotations: quotationsList,
  awards: awardsList,
};
const FORMS: Record<string, FormConfig> = {
  suppliers: supplierForm,
  categories: categoryForm,
  requisitions: requisitionForm,
  orders: orderForm,
  agreements: agreementForm,
  rfqs: rfqForm,
};
const DETAILS: Record<string, DetailConfig> = {
  requisitions: requisitionDetail,
};
// Details with bespoke sections render their own screen.
const CUSTOM_DETAILS: Record<string, (props: { id: string }) => React.ReactNode> = {
  suppliers: (props) => <SupplierDetailScreen id={props.id} />,
  orders: (props) => <OrderDetailScreen id={props.id} />,
  agreements: (props) => <AgreementDetailScreen id={props.id} />,
  rfqs: (props) => <RfqDetailScreen id={props.id} />,
};

export function ListPage({ name }: { name: string }) {
  return <ResourceListPage config={LISTS[name]} />;
}
export function FormPage({ name, id, sourceKind, sourceId, amend }: { name: string; id?: string; sourceKind?: string; sourceId?: string; amend?: boolean }) {
  return <DocumentForm config={FORMS[name]} id={id} sourceKind={sourceKind} sourceId={sourceId} amend={amend} />;
}
export function DetailPage({ name, id }: { name: string; id: string }) {
  const custom = CUSTOM_DETAILS[name];
  if (custom) return <>{custom({ id })}</>;
  return <DocumentDetail config={DETAILS[name]} id={id} />;
}
