type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string };

export type ConfigurationDefinition = Readonly<{
  namespace: string;
  key: string;
  kind: "setting" | "flag";
  audience: "tenant" | "operator";
  label: string;
  unit?: string;
  description: string;
  risk: "low" | "medium" | "high";
  input: { type: "integer"; minimum: number; maximum: number } | { type: "boolean" };
  defaultValue: unknown;
  validate(value: unknown): unknown;
  consumedBy: string;
}>;
export const CONFIGURATION_DEFINITIONS: readonly ConfigurationDefinition[];
export function getConfigurationDefinition(namespace: string, key: string): ConfigurationDefinition | null;

export class ConfigurationError extends Error {
  status: number;
  code: string;
}
export function getConfigurationValue(client: Client, organizationId: string, namespace: string, key: string, at?: Date): Promise<any>;
export function isFeatureFlagEnabled(client: Client, organizationId: string, namespace: string, key: string): Promise<boolean>;
export function setTenantConfiguration(client: Client, session: Session, input: { namespace: string; key: string; value: unknown; effectiveFrom?: string | null }): Promise<{ version: number; effectiveFrom: string; value: unknown }>;
export function setOperatorConfiguration(client: Client, actor: Session, input: { namespace: string; key: string; value: unknown; effectiveFrom?: string | null }): Promise<{ version: number; effectiveFrom: string; value: unknown }>;
export function cancelScheduledConfiguration(client: Client, session: Session, input: { namespace: string; key: string; version: number }): Promise<{ cancelled: true }>;
export type TenantConfigurationEntry = {
  namespace: string;
  key: string;
  kind: "setting" | "flag";
  label: string;
  description: string;
  unit: string | null;
  input: ConfigurationDefinition["input"];
  risk: string;
  defaultValue: unknown;
  effectiveValue: unknown;
  isDefault: boolean;
  scheduled: Array<{ version: number; value: unknown; effectiveFrom: string }>;
  history: Array<{ version: number; value: unknown; status: string; effectiveFrom: string; effectiveTo: string | null; createdAt: string; createdByName: string | null }>;
};
export function listTenantConfiguration(client: Client, organizationId: string): Promise<TenantConfigurationEntry[]>;
