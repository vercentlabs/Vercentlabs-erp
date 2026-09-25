// Document defaults shared by the quotation and order forms.
// F032: the bill-to must be an invoicing address and the ship-to a delivery
// address -- the server enforces the same purposes.
export const BILLING_ADDRESS_TYPES = ["billing", "registered"];
export const SHIPPING_ADDRESS_TYPES = ["shipping", "plant", "office", "registered"];
export function defaultAddress(addresses: Array<{ id: string; address_type: string; is_primary: boolean }>, types: string[]) {
  const usable = addresses.filter((address) => types.includes(address.address_type));
  return (usable.find((address) => address.address_type === types[0] && address.is_primary) ?? usable.find((address) => address.is_primary) ?? usable[0])?.id ?? "";
}
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
