// Taxes: the shared tax layer. Configuration (categories, dated rates,
// company registrations, defaults, audit) and the one calculation every
// module uses.
export {
  GST_STATES, SUPPLY_TYPES, TAX_APPLIES_TO, TAX_PERMISSIONS, TAX_TREATMENTS, TAX_TYPES, TaxError, gstStateCode, gstStateName, supplyTypeForCustomer, treatmentOfSupply,
} from "./constants.js";
export { UTGST_TERRITORIES, classifyTax, computeTax, derivePlaceOfSupply, loadTaxContext, resolveLineTax, sellerSnapshot, summarizeTax } from "./engine.js";
export {
  changeTaxRate, createTaxCategory, createTaxRegistration, getTaxCategory, getTaxOptions, getTaxSettings, listTaxCategories, listTaxCategoryChoices, listTaxHistory, listTaxRegistrations,
  setTaxCategoryStatus, updateTaxCategory, updateTaxRegistration, updateTaxSettings,
} from "./configuration.js";
export { deleteTdsCertificate, effectiveWithholdingRate, listTdsCertificates, listWithholdingSections, saveTdsCertificate, saveWithholdingSection } from "./withholding.js";
export { previewTaxCalculation, validateTaxConfiguration } from "./validation.js";
export { REGISTRATION_TYPES } from "./configuration.js";
export { GST_UQC, isGstUqc, uqcForUnitCode, unitUqcMap } from "./uqc.js";
