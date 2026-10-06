"use client";

import {
  DocumentDetail,
  type DetailConfig,
} from "@/features/procurement/shared/DocumentDetail";
import {
  DocumentForm,
  type FormConfig,
} from "@/features/procurement/shared/DocumentForm";
import {
  ResourceListPage,
  type ListConfig,
} from "@/features/procurement/shared/ResourceListPage";
import {
  categoriesList,
  categoryForm,
} from "@/features/procurement/configs/categories";
import { orderForm, ordersList } from "@/features/procurement/configs/orders";
import { OrderDetailScreen } from "@/features/procurement/screens/OrderDetailScreen";
import {
  exceptionDetail,
  exceptionsList,
  receiptDetail,
  receiptForm,
  receiptsList,
  rejectionsList,
} from "@/features/procurement/configs/receiving";
import { invoicesRegister } from "@/features/procurement/configs/operations";
import { InvoiceMatchScreen } from "@/features/procurement/screens/InvoiceMatchScreen";
import {
  OperationRegister,
  type OperationConfig,
} from "@/features/procurement/shared/OperationRegister";

const LISTS: Record<string, ListConfig> = {
  categories: categoriesList,
  orders: ordersList,
  receipts: receiptsList,
  rejections: rejectionsList,
  exceptions: exceptionsList,
};
const FORMS: Record<string, FormConfig> = {
  categories: categoryForm,
  orders: orderForm,
  receipts: receiptForm,
};
const DETAILS: Record<string, DetailConfig> = {
  receipts: receiptDetail,
  exceptions: exceptionDetail,
};
// Details with bespoke sections render their own screen.
const CUSTOM_DETAILS: Record<
  string,
  (props: { id: string }) => React.ReactNode
> = {
  orders: (props) => <OrderDetailScreen id={props.id} />,
};

const REGISTERS: Record<string, OperationConfig> = {
  invoices: invoicesRegister,
};
export function RegisterPage({ name }: { name: string }) {
  return <OperationRegister config={REGISTERS[name]} />;
}
export function InvoiceFormPage({ orderId }: { orderId?: string }) {
  return <InvoiceMatchScreen orderId={orderId} />;
}

export function ListPage({ name }: { name: string }) {
  return <ResourceListPage config={LISTS[name]} />;
}
export function FormPage({
  name,
  id,
  sourceKind,
  sourceId,
  amend,
  initial,
}: {
  name: string;
  id?: string;
  sourceKind?: string;
  sourceId?: string;
  amend?: boolean;
  // Pre-filled values for a new document (a purchase order started from a supplier).
  initial?: Record<string, string>;
}) {
  return (
    <DocumentForm
      config={initial ? { ...FORMS[name], initial } : FORMS[name]}
      id={id}
      sourceKind={sourceKind}
      sourceId={sourceId}
      amend={amend}
    />
  );
}
export function DetailPage({ name, id }: { name: string; id: string }) {
  const custom = CUSTOM_DETAILS[name];
  if (custom) return <>{custom({ id })}</>;
  return <DocumentDetail config={DETAILS[name]} id={id} />;
}
