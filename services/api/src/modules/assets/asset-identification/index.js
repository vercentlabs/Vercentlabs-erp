// Assets — Asset Identification and Code: one permanent identity per asset (UUID and AST-… code), the manufacturer's serial, the Company's
// tag and a previous code under controlled correction with history, QR and Code 128 labels, a lookup that lists rather than guesses.
export { IDENT as ASSET_IDENTIFICATION_PERMISSIONS, IDENT_MESSAGES as ASSET_IDENTIFICATION_MESSAGES, normalizeIdentifier as normalizeAssetIdentifier } from "./ident-rules.js";
export { attachLegacyCode as attachAssetLegacyCode, correctAssetSerial, markAssetLabelsPrinted, replaceAssetTag, setAssetLegacyCode } from "./ident-commands.js";
export {
  IDENT_REPORTS as ASSET_IDENTIFICATION_REPORTS, exportAssetIdentifiers, getAssetIdentification, getAssetIdentifierHistory, getAssetLabels, getIdentificationExceptions, getIdentificationReport,
  resolveAssetIdentifier, searchAssetsForPicker,
} from "./ident-read.js";
export { code128Svg } from "./code128.js";
