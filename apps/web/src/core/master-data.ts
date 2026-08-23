import { BusinessDataError, type BusinessDataContext } from "@vercentlabs/api";
import type { BusinessDataResourceKey } from "@vercentlabs/shared-types";

import type { SessionContext } from "@/core/auth";
import { PERMISSIONS } from "@/core/authorization";
import { HttpError } from "@/core/http";

export type BusinessDataOptionKey =
  | "companies"
  | "branches"
  | "parties"
  | "uoms"
  | "itemGroups"
  | "taxCategories"
  | "warehouses"
  | "warehouseLocations"
  | "paymentTerms"
  | "currencies"
  | "items"
  | "priceLists";

export type BusinessDataField = {
  name: string;
  label: string;
  type:
    "text" | "email" | "number" | "date" | "select" | "checkbox" | "textarea";
  required?: boolean;
  optionsKey?: BusinessDataOptionKey;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  step?: string;
};

export type BusinessDataColumn = {
  key: string;
  label: string;
  optionsKey?: BusinessDataOptionKey;
  format?: "boolean" | "currency" | "date" | "status";
};

export type BusinessDataDefinition = {
  key: BusinessDataResourceKey;
  title: string;
  singular: string;
  eyebrow: string;
  description: string;
  group: "Partners" | "Products" | "Inventory" | "Finance";
  managePermission: string;
  fields: BusinessDataField[];
  columns: BusinessDataColumn[];
};

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export const businessDataDefinitions: Record<
  BusinessDataResourceKey,
  BusinessDataDefinition
> = {
  parties: {
    key: "parties",
    title: "Business partners",
    singular: "business partner",
    eyebrow: "Customers and suppliers",
    description:
      "Maintain governed customer, supplier, prospect and dual-role party records.",
    group: "Partners",
    managePermission: PERMISSIONS.partiesManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "displayName", label: "Display name" },
      { key: "partyType", label: "Type" },
      { key: "gstin", label: "GSTIN" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      {
        name: "companyId",
        label: "Company scope",
        type: "select",
        optionsKey: "companies",
      },
      { name: "code", label: "Partner code", type: "text", required: true },
      {
        name: "partyType",
        label: "Partner type",
        type: "select",
        required: true,
        options: [
          { value: "customer", label: "Customer" },
          { value: "supplier", label: "Supplier" },
          { value: "both", label: "Customer and supplier" },
          { value: "prospect", label: "Prospect" },
        ],
      },
      {
        name: "displayName",
        label: "Display name",
        type: "text",
        required: true,
      },
      { name: "legalName", label: "Legal name", type: "text" },
      { name: "gstin", label: "GSTIN", type: "text" },
      { name: "pan", label: "PAN", type: "text" },
      { name: "msmeNumber", label: "MSME / Udyam number", type: "text" },
      {
        name: "currencyCode",
        label: "Transaction currency",
        type: "select",
        optionsKey: "currencies",
        required: true,
      },
      {
        name: "creditLimit",
        label: "Credit limit",
        type: "number",
        step: "0.01",
      },
      {
        name: "paymentTermId",
        label: "Payment term",
        type: "select",
        optionsKey: "paymentTerms",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  contacts: {
    key: "contacts",
    title: "Contacts",
    singular: "contact",
    eyebrow: "Business relationships",
    description:
      "Maintain named contacts, communication channels and primary contact ownership.",
    group: "Partners",
    managePermission: PERMISSIONS.partiesManage,
    columns: [
      { key: "partyId", label: "Partner", optionsKey: "parties" },
      { key: "firstName", label: "First name" },
      { key: "lastName", label: "Last name" },
      { key: "email", label: "Email" },
      { key: "mobile", label: "Mobile" },
      { key: "isPrimary", label: "Primary", format: "boolean" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      {
        name: "partyId",
        label: "Business partner",
        type: "select",
        optionsKey: "parties",
        required: true,
      },
      {
        name: "firstName",
        label: "First name",
        type: "text",
        required: true,
      },
      { name: "lastName", label: "Last name", type: "text" },
      { name: "designation", label: "Designation", type: "text" },
      { name: "email", label: "Email", type: "email" },
      { name: "phone", label: "Phone", type: "text" },
      { name: "mobile", label: "Mobile", type: "text" },
      { name: "isPrimary", label: "Primary contact", type: "checkbox" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  addresses: {
    key: "addresses",
    title: "Addresses",
    singular: "address",
    eyebrow: "Registered and operating addresses",
    description:
      "Maintain registered, billing, shipping, office and plant addresses.",
    group: "Partners",
    managePermission: PERMISSIONS.partiesManage,
    columns: [
      { key: "partyId", label: "Partner", optionsKey: "parties" },
      { key: "addressType", label: "Type" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "postalCode", label: "Postal code" },
      { key: "isPrimary", label: "Primary", format: "boolean" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      {
        name: "partyId",
        label: "Business partner",
        type: "select",
        optionsKey: "parties",
        required: true,
      },
      {
        name: "addressType",
        label: "Address type",
        type: "select",
        required: true,
        options: [
          { value: "registered", label: "Registered" },
          { value: "billing", label: "Billing" },
          { value: "shipping", label: "Shipping" },
          { value: "office", label: "Office" },
          { value: "plant", label: "Plant" },
          { value: "other", label: "Other" },
        ],
      },
      { name: "line1", label: "Address line 1", type: "text", required: true },
      { name: "line2", label: "Address line 2", type: "text" },
      { name: "city", label: "City", type: "text", required: true },
      { name: "district", label: "District", type: "text" },
      { name: "state", label: "State", type: "text", required: true },
      { name: "stateCode", label: "State code", type: "text" },
      {
        name: "postalCode",
        label: "Postal code",
        type: "text",
        required: true,
      },
      {
        name: "countryCode",
        label: "Country code",
        type: "text",
        required: true,
      },
      { name: "gstin", label: "Address GSTIN", type: "text" },
      { name: "isPrimary", label: "Primary for this type", type: "checkbox" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  "units-of-measure": {
    key: "units-of-measure",
    title: "Units of measure",
    singular: "unit of measure",
    eyebrow: "Product measurement",
    description:
      "Maintain reusable units for quantity, weight, volume, length, time and packaging.",
    group: "Products",
    managePermission: PERMISSIONS.itemsManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "category", label: "Category" },
      { key: "decimalPlaces", label: "Decimals" },
      { key: "isBase", label: "Base unit", format: "boolean" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      {
        name: "category",
        label: "Category",
        type: "select",
        required: true,
        options: [
          { value: "quantity", label: "Quantity" },
          { value: "weight", label: "Weight" },
          { value: "volume", label: "Volume" },
          { value: "length", label: "Length" },
          { value: "area", label: "Area" },
          { value: "time", label: "Time" },
          { value: "packaging", label: "Packaging" },
          { value: "other", label: "Other" },
        ],
      },
      {
        name: "decimalPlaces",
        label: "Decimal places",
        type: "number",
        step: "1",
      },
      { name: "isBase", label: "Base unit for category", type: "checkbox" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  "item-groups": {
    key: "item-groups",
    title: "Item groups",
    singular: "item group",
    eyebrow: "Product classification",
    description:
      "Create governed item families for reporting, defaults and future workflows.",
    group: "Products",
    managePermission: PERMISSIONS.itemsManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "parentId", label: "Parent", optionsKey: "itemGroups" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      {
        name: "parentId",
        label: "Parent group",
        type: "select",
        optionsKey: "itemGroups",
      },
      { name: "code", label: "Group code", type: "text", required: true },
      { name: "name", label: "Group name", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  items: {
    key: "items",
    title: "Items and services",
    singular: "item",
    eyebrow: "Product master",
    description:
      "Maintain sellable, purchasable, stock, service and asset master records.",
    group: "Products",
    managePermission: PERMISSIONS.itemsManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "itemType", label: "Type" },
      { key: "uomId", label: "Unit", optionsKey: "uoms" },
      { key: "salesPrice", label: "Sales price", format: "currency" },
      { key: "trackInventory", label: "Stock item", format: "boolean" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      {
        name: "companyId",
        label: "Company scope",
        type: "select",
        optionsKey: "companies",
      },
      { name: "code", label: "Item code", type: "text", required: true },
      { name: "name", label: "Item name", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      {
        name: "itemType",
        label: "Item type",
        type: "select",
        required: true,
        options: [
          { value: "product", label: "Product" },
          { value: "service", label: "Service" },
          { value: "consumable", label: "Consumable" },
          { value: "asset", label: "Asset" },
        ],
      },
      {
        name: "groupId",
        label: "Item group",
        type: "select",
        optionsKey: "itemGroups",
      },
      {
        name: "uomId",
        label: "Default unit",
        type: "select",
        optionsKey: "uoms",
        required: true,
      },
      { name: "hsnSacCode", label: "HSN / SAC code", type: "text" },
      { name: "barcode", label: "Barcode", type: "text" },
      {
        name: "trackInventory",
        label: "Track inventory",
        type: "checkbox",
      },
      {
        name: "allowNegativeStock",
        label: "Allow negative stock",
        type: "checkbox",
      },
      {
        name: "valuationMethod",
        label: "Valuation method",
        type: "select",
        options: [
          { value: "moving_average", label: "Moving average" },
          { value: "fifo", label: "FIFO" },
          { value: "standard", label: "Standard cost" },
        ],
      },
      {
        name: "standardCost",
        label: "Standard cost",
        type: "number",
        step: "0.0001",
      },
      {
        name: "salesPrice",
        label: "Default sales price",
        type: "number",
        step: "0.0001",
      },
      {
        name: "purchasePrice",
        label: "Default purchase price",
        type: "number",
        step: "0.0001",
      },
      {
        name: "taxCategoryId",
        label: "Tax category",
        type: "select",
        optionsKey: "taxCategories",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  "tax-categories": {
    key: "tax-categories",
    title: "Tax categories",
    singular: "tax category",
    eyebrow: "Finance setup",
    description:
      "Classify taxable, exempt and out-of-scope supplies before transaction processing.",
    group: "Finance",
    managePermission: PERMISSIONS.financeSetupManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  "tax-rates": {
    key: "tax-rates",
    title: "Tax rates",
    singular: "tax rate",
    eyebrow: "Finance setup",
    description:
      "Maintain effective-dated GST and other tax rates by company and category.",
    group: "Finance",
    managePermission: PERMISSIONS.financeSetupManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "taxType", label: "Type" },
      { key: "rate", label: "Rate %" },
      { key: "effectiveFrom", label: "Effective from", format: "date" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      {
        name: "companyId",
        label: "Company",
        type: "select",
        optionsKey: "companies",
      },
      {
        name: "taxCategoryId",
        label: "Tax category",
        type: "select",
        optionsKey: "taxCategories",
        required: true,
      },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "code", label: "Code", type: "text", required: true },
      {
        name: "taxType",
        label: "Tax type",
        type: "select",
        required: true,
        options: [
          { value: "gst", label: "GST" },
          { value: "igst", label: "IGST" },
          { value: "cgst", label: "CGST" },
          { value: "sgst", label: "SGST" },
          { value: "cess", label: "Cess" },
          { value: "vat", label: "VAT" },
          { value: "sales_tax", label: "Sales tax" },
          { value: "other", label: "Other" },
        ],
      },
      { name: "rate", label: "Rate %", type: "number", step: "0.0001" },
      { name: "effectiveFrom", label: "Effective from", type: "date" },
      { name: "effectiveTo", label: "Effective to", type: "date" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  warehouses: {
    key: "warehouses",
    title: "Warehouses",
    singular: "warehouse",
    eyebrow: "Inventory setup",
    description:
      "Maintain company and branch warehouses for stock ownership and movement.",
    group: "Inventory",
    managePermission: PERMISSIONS.inventorySetupManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "companyId", label: "Company", optionsKey: "companies" },
      { key: "branchId", label: "Branch", optionsKey: "branches" },
      { key: "warehouseType", label: "Type" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      {
        name: "companyId",
        label: "Company",
        type: "select",
        optionsKey: "companies",
        required: true,
      },
      {
        name: "branchId",
        label: "Branch",
        type: "select",
        optionsKey: "branches",
      },
      { name: "name", label: "Warehouse name", type: "text", required: true },
      { name: "code", label: "Warehouse code", type: "text", required: true },
      {
        name: "warehouseType",
        label: "Warehouse type",
        type: "select",
        required: true,
        options: [
          { value: "stores", label: "Stores" },
          { value: "raw_material", label: "Raw material" },
          { value: "work_in_progress", label: "Work in progress" },
          { value: "finished_goods", label: "Finished goods" },
          { value: "transit", label: "Transit" },
          { value: "returns", label: "Returns" },
          { value: "virtual", label: "Virtual" },
        ],
      },
      {
        name: "allowNegativeStock",
        label: "Allow negative stock",
        type: "checkbox",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  "warehouse-locations": {
    key: "warehouse-locations",
    title: "Warehouse locations",
    singular: "warehouse location",
    eyebrow: "Inventory setup",
    description:
      "Create zones, aisles, racks, bins, staging and quality locations.",
    group: "Inventory",
    managePermission: PERMISSIONS.inventorySetupManage,
    columns: [
      { key: "warehouseId", label: "Warehouse", optionsKey: "warehouses" },
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "locationType", label: "Type" },
      { key: "capacity", label: "Capacity" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      {
        name: "warehouseId",
        label: "Warehouse",
        type: "select",
        optionsKey: "warehouses",
        required: true,
      },
      {
        name: "parentLocationId",
        label: "Parent location",
        type: "select",
        optionsKey: "warehouseLocations",
      },
      { name: "name", label: "Location name", type: "text", required: true },
      { name: "code", label: "Location code", type: "text", required: true },
      {
        name: "locationType",
        label: "Location type",
        type: "select",
        required: true,
        options: [
          { value: "zone", label: "Zone" },
          { value: "aisle", label: "Aisle" },
          { value: "rack", label: "Rack" },
          { value: "bin", label: "Bin" },
          { value: "staging", label: "Staging" },
          { value: "quality", label: "Quality" },
          { value: "other", label: "Other" },
        ],
      },
      {
        name: "capacity",
        label: "Capacity",
        type: "number",
        step: "0.0001",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  "payment-terms": {
    key: "payment-terms",
    title: "Payment terms",
    singular: "payment term",
    eyebrow: "Finance setup",
    description:
      "Maintain standard due-date rules for receivables and payables.",
    group: "Finance",
    managePermission: PERMISSIONS.financeSetupManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "defaultDueDays", label: "Due days" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      {
        name: "defaultDueDays",
        label: "Default due days",
        type: "number",
        step: "1",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  "price-lists": {
    key: "price-lists",
    title: "Price lists",
    singular: "price list",
    eyebrow: "Commercial setup",
    description:
      "Maintain governed sales and purchase price-list headers and validity.",
    group: "Finance",
    managePermission: PERMISSIONS.financeSetupManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "priceListType", label: "Type" },
      { key: "currencyCode", label: "Currency" },
      { key: "taxInclusive", label: "Tax inclusive", format: "boolean" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      {
        name: "priceListType",
        label: "Price-list type",
        type: "select",
        options: [
          { value: "sales", label: "Sales" },
          { value: "purchase", label: "Purchase" },
        ],
        required: true,
      },
      {
        name: "currencyCode",
        label: "Currency",
        type: "select",
        optionsKey: "currencies",
        required: true,
      },
      { name: "taxInclusive", label: "Prices include tax", type: "checkbox" },
      { name: "validFrom", label: "Valid from", type: "date" },
      { name: "validTo", label: "Valid to", type: "date" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  "fiscal-periods": {
    key: "fiscal-periods",
    title: "Fiscal periods",
    singular: "fiscal period",
    eyebrow: "Finance controls",
    description:
      "Maintain company accounting periods and their open, closed or locked state.",
    group: "Finance",
    managePermission: PERMISSIONS.financeSetupManage,
    columns: [
      { key: "companyId", label: "Company", optionsKey: "companies" },
      { key: "name", label: "Name" },
      { key: "fiscalYear", label: "Fiscal year" },
      { key: "startDate", label: "Start", format: "date" },
      { key: "endDate", label: "End", format: "date" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      {
        name: "companyId",
        label: "Company",
        type: "select",
        optionsKey: "companies",
        required: true,
      },
      { name: "name", label: "Period name", type: "text", required: true },
      {
        name: "fiscalYear",
        label: "Fiscal year",
        type: "text",
        required: true,
      },
      { name: "startDate", label: "Start date", type: "date", required: true },
      { name: "endDate", label: "End date", type: "date", required: true },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "open", label: "Open" },
          { value: "closed", label: "Closed" },
          { value: "locked", label: "Locked" },
        ],
      },
    ],
  },
  currencies: {
    key: "currencies",
    title: "Currencies",
    singular: "currency",
    eyebrow: "Finance setup",
    description:
      "Enable transaction currencies and identify the organisation base currency.",
    group: "Finance",
    managePermission: PERMISSIONS.financeSetupManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "symbol", label: "Symbol" },
      { key: "decimalPlaces", label: "Decimals" },
      { key: "isBase", label: "Base", format: "boolean" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      { name: "code", label: "ISO code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "symbol", label: "Symbol", type: "text" },
      {
        name: "decimalPlaces",
        label: "Decimal places",
        type: "number",
        step: "1",
      },
      { name: "isBase", label: "Base currency", type: "checkbox" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
  "exchange-rates": {
    key: "exchange-rates",
    title: "Exchange rates",
    singular: "exchange rate",
    eyebrow: "Finance setup",
    description:
      "Maintain effective-dated manual or sourced currency conversion rates.",
    group: "Finance",
    managePermission: PERMISSIONS.financeSetupManage,
    columns: [
      { key: "companyId", label: "Company", optionsKey: "companies" },
      { key: "fromCurrencyCode", label: "From" },
      { key: "toCurrencyCode", label: "To" },
      { key: "rateDate", label: "Date", format: "date" },
      { key: "rate", label: "Rate" },
      { key: "source", label: "Source" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      {
        name: "companyId",
        label: "Company",
        type: "select",
        optionsKey: "companies",
      },
      {
        name: "fromCurrencyCode",
        label: "From currency",
        type: "select",
        optionsKey: "currencies",
        required: true,
      },
      {
        name: "toCurrencyCode",
        label: "To currency",
        type: "select",
        optionsKey: "currencies",
        required: true,
      },
      { name: "rateDate", label: "Rate date", type: "date", required: true },
      { name: "rate", label: "Rate", type: "number", step: "0.0000000001" },
      { name: "source", label: "Source", type: "text" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: statusOptions,
      },
    ],
  },
};

export const businessDataGroups = [
  {
    name: "Partners" as const,
    title: "Customers and suppliers",
    description:
      "Shared business parties, named contacts and operating addresses.",
  },
  {
    name: "Products" as const,
    title: "Items and measurement",
    description:
      "Item masters, classifications and units used across commercial flows.",
  },
  {
    name: "Inventory" as const,
    title: "Warehouses and locations",
    description:
      "Physical and virtual stock ownership, storage and movement structure.",
  },
  {
    name: "Finance" as const,
    title: "Commercial and accounting setup",
    description:
      "Taxes, currencies, periods, price lists and payment defaults.",
  },
];

export function isBusinessDataDefinition(
  value: string,
): value is BusinessDataResourceKey {
  return value in businessDataDefinitions;
}

export function businessDataContext(
  session: SessionContext,
): BusinessDataContext {
  return {
    organizationId: session.organizationId as string,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies:
      session.roleSlugs.includes("organization_owner") ||
      session.roleSlugs.includes("system_administrator"),
  };
}

export function rethrowBusinessDataError(error: unknown): never {
  if (error instanceof BusinessDataError) {
    throw new HttpError(error.status, error.message);
  }
  throw error;
}
