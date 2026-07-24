export type StructuredFieldKind =
  | "list"
  | "key-value"
  | "actions"
  | "schedule"
  | "value";

export type StructuredFieldConfig = Readonly<{
  kind: StructuredFieldKind;
  label: string;
  helpText: string;
  optionsKey?: string;
}>;

export const STRUCTURED_FIELD_KINDS: readonly StructuredFieldKind[];
export const STRUCTURED_FIELD_CONFIG: Readonly<
  Record<string, StructuredFieldConfig>
>;

export function stripTechnicalJsonLabel(label: string): string;
export function getStructuredFieldConfig(
  name: string,
  label?: string,
): StructuredFieldConfig | null;
export function isStructuredField(name: string, label?: string): boolean;
export function emptyStructuredValue(kind: StructuredFieldKind): unknown;
export function parseStructuredValue(
  value: unknown,
  kind?: StructuredFieldKind,
): unknown;
export function stringifyStructuredValue(value: unknown): string;
export function structuredValueSummary(value: unknown, label?: string): string;
