// GST unit quantity codes (UQC, Shared Platform plan 7): the code GSTR-1's HSN summary, e-invoices and e-way bills use for a unit. Every
// unit of measure names one (units.uqc); a unit with none reports OTH.
export const GST_UQC = Object.freeze([
  ["BAG", "Bags"], ["BAL", "Bale"], ["BDL", "Bundles"], ["BKL", "Buckles"], ["BOU", "Billion of units"], ["BOX", "Box"], ["BTL", "Bottles"], ["BUN", "Bunches"],
  ["CAN", "Cans"], ["CBM", "Cubic metres"], ["CCM", "Cubic centimetres"], ["CMS", "Centimetres"], ["CTN", "Cartons"], ["DOZ", "Dozens"], ["DRM", "Drums"],
  ["GGK", "Great gross"], ["GMS", "Grammes"], ["GRS", "Gross"], ["GYD", "Gross yards"], ["KGS", "Kilograms"], ["KLR", "Kilolitre"], ["KME", "Kilometre"],
  ["LTR", "Litres"], ["MLT", "Millilitre"], ["MTR", "Metres"], ["MTS", "Metric ton"], ["NOS", "Numbers"], ["OTH", "Others"], ["PAC", "Packs"], ["PCS", "Pieces"],
  ["PRS", "Pairs"], ["QTL", "Quintal"], ["ROL", "Rolls"], ["SET", "Sets"], ["SQF", "Square feet"], ["SQM", "Square metres"], ["SQY", "Square yards"],
  ["TBS", "Tablets"], ["TGM", "Ten grams"], ["THD", "Thousands"], ["TON", "Tonnes"], ["TUB", "Tubes"], ["UGS", "US gallons"], ["UNT", "Units"], ["YDS", "Yards"],
].map(([code, label]) => Object.freeze({ code, label })));
const CODES = new Set(GST_UQC.map((entry) => entry.code));
export const isGstUqc = (value) => CODES.has(String(value ?? "").toUpperCase());

// The usual UQC of a unit code (for new and seeded units); null when there is no obvious one.
const BY_UNIT = Object.freeze({
  EA: "NOS", NO: "NOS", NOS: "NOS", UNIT: "UNT", UNT: "UNT", PC: "PCS", PCS: "PCS", KG: "KGS", KGS: "KGS", G: "GMS", GM: "GMS", GMS: "GMS", T: "TON", TON: "TON", MT: "MTS",
  QTL: "QTL", L: "LTR", LTR: "LTR", ML: "MLT", KL: "KLR", M: "MTR", MTR: "MTR", CM: "CMS", KM: "KME", SQM: "SQM", M2: "SQM", SQF: "SQF", SQFT: "SQF", CBM: "CBM", M3: "CBM",
  CCM: "CCM", BOX: "BOX", BAG: "BAG", BDL: "BDL", BTL: "BTL", BOTTLE: "BTL", CAN: "CAN", CTN: "CTN", CARTON: "CTN", DOZ: "DOZ", DZ: "DOZ", DRM: "DRM", DRUM: "DRM",
  PAC: "PAC", PACK: "PAC", PKT: "PAC", PAIR: "PRS", PRS: "PRS", ROL: "ROL", ROLL: "ROL", SET: "SET", TBS: "TBS", TUB: "TUB", YDS: "YDS",
});
export function uqcForUnitCode(code, category = null) {
  const known = BY_UNIT[String(code ?? "").trim().toUpperCase()];
  if (known) return known;
  return category === "time" || category === "other" ? "OTH" : null;
}

// The company's units by code -> UQC, for documents and returns.
export async function unitUqcMap(client, organizationId) {
  const rows = (await client.query(`SELECT code, uqc, category FROM tenant.units_of_measure WHERE organization_id = $1`, [organizationId])).rows;
  return new Map(rows.map((row) => [String(row.code).toUpperCase(), row.uqc ?? uqcForUnitCode(row.code, row.category) ?? "OTH"]));
}
