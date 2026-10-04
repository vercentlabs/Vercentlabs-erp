// Document defaults shared by the quotation and order forms.
// F032: the bill-to must be an invoicing address and the ship-to a delivery
// address -- the server enforces the same purposes. The address the Customer
// Master marks as the default for a purpose is always usable for it.
export const BILLING_ADDRESS_TYPES = ["billing", "registered"];
export const SHIPPING_ADDRESS_TYPES = [
  "shipping",
  "plant",
  "office",
  "registered",
];
type DocumentAddress = {
  id: string;
  address_type: string;
  is_primary: boolean;
  is_default_billing?: boolean;
  is_default_shipping?: boolean;
};
const isDefaultFor = (address: DocumentAddress, types: string[]) =>
  Boolean(
    types === BILLING_ADDRESS_TYPES
      ? address.is_default_billing
      : address.is_default_shipping,
  );
// The addresses that can serve a purpose: the right type, or the customer's
// default for it.
export function usableAddresses<T extends DocumentAddress>(
  addresses: T[],
  types: string[],
) {
  return addresses.filter(
    (address) =>
      types.includes(address.address_type) || isDefaultFor(address, types),
  );
}
export function defaultAddress(addresses: DocumentAddress[], types: string[]) {
  const usable = usableAddresses(addresses, types);
  return (
    (
      usable.find((address) => isDefaultFor(address, types)) ??
      usable.find(
        (address) => address.address_type === types[0] && address.is_primary,
      ) ??
      usable.find((address) => address.is_primary) ??
      usable[0]
    )?.id ?? ""
  );
}
// "Rahul Sharma — Procurement (primary)": who the person is at this customer.
export function contactLabel(contact: {
  first_name: string;
  last_name: string | null;
  designation?: string | null;
  role?: string | null;
  is_primary: boolean;
}) {
  const name = `${contact.first_name} ${contact.last_name ?? ""}`.trim();
  const role =
    contact.designation ||
    (contact.role
      ? contact.role.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase())
      : "");
  return `${name}${role ? ` — ${role}` : ""}${contact.is_primary ? " (primary)" : ""}`;
}
// The unit a new line starts in: the product's sales unit when it converts
// to the base unit, else the base unit.
export function defaultLineUom(
  item: { id: string; uom_id: string | null; sales_uom_id?: string | null } | undefined,
  conversions: Array<{ item_id: string; from_uom_id: string; to_uom_id: string }>,
) {
  if (!item) return "";
  const sales = item.sales_uom_id;
  if (sales && sales !== item.uom_id && conversions.some((entry) => entry.item_id === item.id && (entry.from_uom_id === sales || entry.to_uom_id === sales)))
    return sales;
  return item.uom_id ?? "";
}
// The text a new line starts with.
export const defaultLineDescription = (item: { sales_description?: string | null; description?: string | null } | undefined) =>
  item?.sales_description || item?.description || "";
// F031/F040: the customer's GST treatment sets the starting supply type.
export function supplyTypeFor(taxTreatment: string | null | undefined) {
  if (taxTreatment === "overseas") return "export";
  if (taxTreatment === "sez") return "sez";
  return "domestic";
}
export const SUPPLY_TYPE_OPTIONS = [
  { value: "domestic", label: "Domestic (GST applies)" },
  { value: "export", label: "Export" },
  { value: "sez", label: "Supply to SEZ" },
  { value: "exempt", label: "Exempt supply" },
  { value: "non_gst", label: "Non-GST supply" },
];
