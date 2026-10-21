// The channels a customer buys through; a price list can be for one (Sales audit: price lists by channel). Codes match the server's.
export const SALES_CHANNELS = [
  { value: "general_trade", label: "General trade (kirana, wholesale)" }, { value: "modern_trade", label: "Modern trade (supermarkets, chains)" },
  { value: "horeca", label: "HoReCa (hotels, restaurants, caterers)" }, { value: "institutional", label: "Institutional" }, { value: "ecommerce", label: "E-commerce" },
  { value: "distributor", label: "Distributor / stockist" }, { value: "export", label: "Export" }, { value: "other", label: "Other" },
] as const;
