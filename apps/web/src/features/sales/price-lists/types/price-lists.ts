export type SalesPriceList = {
  id: string;
  code: string;
  name: string;
  currency_code: string;
  tax_inclusive: boolean;
  valid_from: string | null;
  valid_to: string | null;
  status: string;
  item_count: number;
  assigned_store_count: number;
};

export type SalesPriceListItem = {
  id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  variant_id: string | null;
  variant_sku: string | null;
  uom_id: string | null;
  minimum_quantity: string;
  rate: string;
  valid_from: string | null;
  valid_to: string | null;
  status: string;
};

export type SalesCustomerPrice = {
  id: string;
  party_id: string;
  party_name: string;
  item_id: string;
  item_code: string;
  item_name: string;
  price_list_id: string | null;
  minimum_quantity: string;
  fixed_rate: string;
  valid_from: string | null;
  valid_to: string | null;
  reason: string | null;
};

export type SalesPricingOptions = {
  items: { id: string; code: string; name: string; uom_id: string | null }[];
  customers: { id: string; code: string; display_name: string }[];
  uoms: { id: string; code: string; name: string }[];
  variants: { id: string; item_id: string; sku: string; name: string }[];
};
