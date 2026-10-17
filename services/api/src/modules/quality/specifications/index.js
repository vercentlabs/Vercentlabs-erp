// Quality — Inspection Specifications (MVP 29): controlled, versioned inspection standards and their deterministic resolution.
export * from "./qs-commands.js";
export * from "./qs-read.js";
export { activateDueVersions, ensureMirrorPlan, resolveApplicableInspectionSpecification, resolveSpecification, specificationForSource } from "./qs-resolver.js";
export {
  QS as QUALITY_SPEC, QualitySpecError, aggregateOutcome as aggregateInspectionOutcome, criterionText as inspectionCriterionText, evaluateCharacteristic as evaluateInspectionCharacteristic,
  sampleSize as inspectionSampleSize, samplingSentence as inspectionSamplingSentence,
} from "./qs-rules.js";
