import { decimal, div } from "./decimal.js";

// Shared authoritative tax-rate/component resolution, extracted verbatim
// (same SQL, same intra/inter-state CGST+SGST vs IGST split, same
// fall-through for non-GST tax types) from Sales' calculateLine
// (services/api/src/modules/sales/index.js) so POS (F278) can reuse the
// exact same tax authority instead of forking a second one, per the
// session brief's explicit instruction not to implement two divergent
// business calculators. Sales' own call site was refactored to call this
// function; services/api/tests/sales-*.test.mjs is the regression gate
// that proves the extraction changed no Sales behavior.
//
// Deliberately pure/side-effect-free beyond the one SELECT: callers own
// the taxable-base computation (this only resolves WHICH rate/components
// apply, not the amount) so POS's discount-before-tax base and Sales'
// discount-before-tax base (line and header discounts, F039) can both use
// it without this function taking a position on that policy.
export async function resolveTaxRateComponents(
  client,
  { organizationId, companyId, taxCategoryId, sellerStateCode, buyerStateCode, exempt = false },
) {
  let taxRate = decimal(0);
  let components = [];
  if (taxCategoryId && !exempt) {
    const rateResult = await client.query(
      `SELECT tax_type,rate,name,code FROM tenant.tax_rates WHERE organization_id=$1 AND tax_category_id=$2 AND (company_id=$3 OR company_id IS NULL) AND status='active' AND (effective_from IS NULL OR effective_from<=current_date) AND (effective_to IS NULL OR effective_to>=current_date) ORDER BY company_id NULLS LAST,effective_from DESC NULLS LAST,rate DESC LIMIT 1`,
      [organizationId, taxCategoryId, companyId],
    );
    const rate = rateResult.rows[0];
    if (rate) {
      taxRate = decimal(rate.rate);
      const sellerState = String(sellerStateCode || "").trim();
      const buyerState = String(buyerStateCode || "").trim();
      const intra = sellerState && buyerState && sellerState === buyerState;
      if (rate.tax_type === "gst" && intra)
        components = [
          { type: "cgst", label: "CGST", rate: div(taxRate, 2) },
          { type: "sgst", label: "SGST", rate: div(taxRate, 2) },
        ];
      else if (rate.tax_type === "gst") components = [{ type: "igst", label: "IGST", rate: taxRate }];
      else components = [{ type: rate.tax_type, label: rate.name, rate: taxRate }];
    }
  }
  return { taxRate, components };
}

// exempt=true for any of Sales' three existing "no tax" supplyType values,
// so POS callers can reuse the identical exemption vocabulary without
// hardcoding the three strings a second time.
export function isExemptSupplyType(supplyType) {
  return supplyType === "exempt" || supplyType === "non_gst" || supplyType === "export";
}
